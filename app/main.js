const process = require("process");
const util = require("util");
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('crypto');
const bencode = require('bencode');
const http = require('http');
const { URL } = require('url');
const { decode } = require('./bencode');
const net = require('net');
const os = require('os');


function generatePeerId() {
  return crypto.randomBytes(20);
}

const readFile = (pathStr) => {
  try {
    const data = fs.readFileSync(path.resolve('.', pathStr));
    return data;
  } catch (error) {
    console.error("Error reading file:", error);
    throw error;
  }
}

function calculateInfoHash(infoDict) {
  if (!infoDict) {
    throw new Error("Info dictionary is undefined.");
  }
  const bencodedInfo = bencode.encode(infoDict);
  const sha1Hash = crypto.createHash('sha1').update(bencodedInfo).digest('hex');
  return sha1Hash;
}


function getTrackerPeers(trackerURL, infoHash, fileLength, peerId) {
  return new Promise((resolve, reject) => {
    let infoHashUrlEncoded = "";
    for (let i = 0; i < infoHash.length; i += 2) {
      infoHashUrlEncoded += "%" + infoHash.substring(i, i + 2);
    }

    let peerIdUrlEncoded = "";
    for (let i = 0; i < peerId.length; i++) {
      peerIdUrlEncoded += "%" + peerId[i].toString(16).padStart(2, '0');
    }

    const params = new URLSearchParams({
      port: 6881,
      uploaded: 0,
      downloaded: 0,
      left: fileLength,
      compact: 1
    });

    const url = `${trackerURL}?info_hash=${infoHashUrlEncoded}&peer_id=${peerIdUrlEncoded}&${params.toString()}`;

    http.get(url, (response) => {
      let data = [];
      response.on('data', (chunk) => data.push(chunk));
      response.on('end', () => {
        try {
          const decodedResponse = bencode.decode(Buffer.concat(data));

          if (decodedResponse['failure reason']) {
            const failureReason = Buffer.from(decodedResponse['failure reason']).toString('utf-8');
            console.error("Tracker Failure Reason:", failureReason);
            reject(failureReason);
            return;
          }

          const peers = decodedResponse.peers;
          if (!peers) {
            throw new Error("Peers field is missing in the tracker response");
          }

          const peerList = [];
          for (let i = 0; i < peers.length; i += 6) {
            const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`;
            const port = (peers[i + 4] << 8) + peers[i + 5];
            peerList.push({ ip, port });
          }
          resolve(peerList);
        } catch (error) {
          console.error("Error decoding tracker response:", error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.error("Error with tracker request:", error);
      reject(error);
    });
  });
}


// Function to construct the handshake message
function createHandshake(infoHash, peerId) {
  const protocol = 'BitTorrent protocol';
  const reserved = Buffer.alloc(8, 0); // 8 reserved bytes all set to zero

  return Buffer.concat([
    Buffer.from([protocol.length]),              
    Buffer.from(protocol, 'utf-8'),              
    reserved,                                    
    Buffer.from(infoHash, 'hex'),                
    Buffer.from(peerId, 'hex')                   
  ]);
}

// Function to perform the handshake with the peer
function performHandshake(peerAddress, infoHash, peerId) {
  const [peerIP, peerPort] = peerAddress.split(':');
  
  const client = net.createConnection({ host: peerIP, port: peerPort }, () => {
    console.log(`Connected to peer at ${peerIP}:${peerPort}`);

    const handshakeMessage = createHandshake(infoHash, peerId);
    client.write(handshakeMessage);
  });

  let timeoutId = setTimeout(() => {
    console.log('Handshake timeout');
    client.end();
  }, 10000);

  client.on('data', (data) => {
    if (data.length >= 68 && data.toString('utf8', 1, 20) === 'BitTorrent protocol') {
      clearTimeout(timeoutId);  
      const receivedPeerId = data.subarray(48, 68).toString('hex');
      console.log(`Peer ID: ${receivedPeerId}`);
      
    } else {
      console.log('Received invalid handshake response');
    }
  });

  client.on('end', () => {
    console.log('Disconnected from peer');
  });

  client.on('error', (error) => {
    console.error("Connection error:", error);
  });
}




async function downloadPiece(torrentFile, pieceIndex, outputPath) {
  const fileContent = readFile(torrentFile);
  const torrentData = bencode.decode(fileContent);
  const infoHash = calculateInfoHash(torrentData.info);
  const peerId = generatePeerId();
  
  const trackerURL = String(torrentData.announce);
  const peers = await getTrackerPeers(trackerURL, infoHash, torrentData.info.length, peerId);
  
  if (peers.length === 0) {
    throw new Error("No peers available");
  }

  const peer = peers[0]; // Use the first peer for simplicity
  const pieceLength = torrentData.info['piece length'];
  const lastPieceLength = torrentData.info.length % pieceLength || pieceLength;
  const currentPieceLength = pieceIndex === Math.floor(torrentData.info.length / pieceLength) ? lastPieceLength : pieceLength;

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let keepAliveInterval;
    let overallTimeout;

    function cleanup() {
      if (client) {
        client.destroy();
      }
      clearInterval(keepAliveInterval);
      clearTimeout(overallTimeout);
    }

    // Chỉ giữ một event handler cho 'close'
    client.on('close', () => {
      console.log('Connection closed');
      cleanup();
      if (receivedLength !== currentPieceLength && !client.destroyed) {
        reject(new Error(`Incomplete download: received ${receivedLength} out of ${currentPieceLength} bytes`));
      }
    });

    client.on('error', (error) => {
      console.error('Connection error:', error);
      cleanup();
      reject(error);
    });

    client.on('timeout', () => {
      console.error('Connection timed out');
      cleanup();
      reject(new Error('Connection timed out'));
    });

    client.setTimeout(60000); // 60 seconds timeout

    client.connect(peer.port, peer.ip, () => {
      console.log(`Connected to peer ${peer.ip}:${peer.port}`);
      const handshakeMsg = createHandshake(infoHash, peerId.toString('hex'));
      client.write(handshakeMsg);

      // Set up keep-alive messages
      keepAliveInterval = setInterval(() => {
        client.write(Buffer.alloc(4));
      }, 120000); // Send keep-alive every 2 minutes
    });

    let handshakeReceived = false;
    let bitfieldReceived = false;
    let unchokeReceived = false;
    const pieceData = Buffer.alloc(currentPieceLength);
    let receivedLength = 0;
    const blockSize = 16 * 1024; // 16 KiB
    let requestsSent = 0;
    let blocksReceived = 0;

    function sendRequest(begin, length) {
      const requestMsg = Buffer.alloc(17);
      requestMsg.writeUInt32BE(13, 0); // Message length
      requestMsg.writeUInt8(6, 4); // Message ID (6 for request)
      requestMsg.writeUInt32BE(pieceIndex, 5);
      requestMsg.writeUInt32BE(begin, 9);
      requestMsg.writeUInt32BE(length, 13);
      client.write(requestMsg);
      requestsSent++;
      console.log(`Sent request for block: begin=${begin}, length=${length}`);
    }

    let buffer = Buffer.alloc(0);

    client.on('data', (data) => {
      console.log(`Received data of length: ${data.length}`);
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 4) {
        if (!handshakeReceived) {
          if (buffer.length >= 68 && buffer.toString('utf8', 1, 20) === 'BitTorrent protocol') {
            handshakeReceived = true;
            console.log('Handshake received');
            buffer = buffer.slice(68);
            const interestedMsg = Buffer.from([0, 0, 0, 1, 2]);
            client.write(interestedMsg);
            console.log('Sent interested message');
          } else {
            break;
          }
        } else {
          const messageLength = buffer.readUInt32BE(0);
          if (messageLength === 0) {
            console.log('Received keep-alive message');
            buffer = buffer.slice(4);
            continue;
          }
          if (buffer.length < 4 + messageLength) break;

          const messageId = buffer.readUInt8(4);
          const payload = buffer.slice(5, 4 + messageLength);

          console.log(`Received message: id=${messageId}, length=${messageLength}`);

          switch (messageId) {
            case 0: // Choke
              console.log('Choke received');
              break;
            case 1: // Unchoke
              unchokeReceived = true;
              console.log('Unchoke received');
              requestPieces();
              break;
            case 4: // Have
              const havePieceIndex = payload.readUInt32BE(0);
              console.log(`Have message for piece ${havePieceIndex}`);
              break;
            case 5: // Bitfield
              bitfieldReceived = true;
              console.log('Bitfield received');
              break;
            case 7: // Piece
              handlePieceMessage(payload);
              break;
            default:
              console.log(`Unhandled message type: ${messageId}`);
          }

          buffer = buffer.slice(4 + messageLength);
        }
      }
    });

    function requestPieces() {
      while (requestsSent * blockSize < currentPieceLength) {
        const begin = requestsSent * blockSize;
        const length = Math.min(blockSize, currentPieceLength - begin);
        sendRequest(begin, length);
      }
    }

    function handlePieceMessage(payload) {
      const blockIndex = payload.readUInt32BE(0);
      const blockBegin = payload.readUInt32BE(4);
      const blockData = payload.slice(8);
      blockData.copy(pieceData, blockBegin);
      receivedLength += blockData.length;
      blocksReceived++;
      console.log(`Received block: index=${blockIndex}, begin=${blockBegin}, length=${blockData.length}`);
      console.log(`Download progress: ${(receivedLength / currentPieceLength * 100).toFixed(2)}%`);

      if (receivedLength === currentPieceLength) {
        const pieceHash = crypto.createHash('sha1').update(pieceData).digest('hex');
        const expectedHash = torrentData.info.pieces.slice(pieceIndex * 20, pieceIndex * 20 + 20).toString('hex');

        if (pieceHash === expectedHash) {
          fs.writeFileSync(outputPath, pieceData);
          console.log(`Piece ${pieceIndex} downloaded successfully`);
          cleanup(); // Call cleanup before resolving
          resolve();
        } else {
          cleanup(); // Call cleanup before rejecting
          reject(new Error(`Piece ${pieceIndex} hash mismatch`));
        }
      } else if (requestsSent * blockSize < currentPieceLength) {
        const begin = requestsSent * blockSize;
        const length = Math.min(blockSize, currentPieceLength - begin);
        sendRequest(begin, length);
      }
    }

    client.on('timeout', () => {
      console.error('Connection timed out');
      client.destroy();
      reject(new Error('Connection timed out'));
    });

    client.on('error', (error) => {
      console.error('Connection error:', error);
      reject(error);
    });

    // Increase timeout
    overallTimeout = setTimeout(() => {
      if (receivedLength !== currentPieceLength) {
        client.destroy();
        reject(new Error('Download timeout'));
      }
    }, 300000); // 5 minutes timeout

    client.on('close', () => {
      console.log('Connection closed');
      clearInterval(keepAliveInterval);
      clearTimeout(overallTimeout);
      if (receivedLength !== currentPieceLength) {
        reject(new Error(`Incomplete download: received ${receivedLength} out of ${currentPieceLength} bytes`));
      }
    });

    client.on('error', (error) => {
      console.error('Connection error:', error);
      cleanup();
      reject(error);
    });

    client.on('timeout', () => {
      console.error('Connection timed out');
      cleanup();
      reject(new Error('Connection timed out'));
    });

    client.on('close', () => {
      console.log('Connection closed');
      cleanup();
      if (receivedLength !== currentPieceLength) {
        reject(new Error(`Incomplete download: received ${receivedLength} out of ${currentPieceLength} bytes`));
      }
    });
  });
}

class WorkQueue {
  constructor(totalPieces) {
    this.pendingPieces = new Set([...Array(totalPieces).keys()]);
    this.inProgressPieces = new Set();
    this.completedPieces = new Set();
    this.totalPieces = totalPieces;
    this.lastProgressUpdate = Date.now();
  }

  getNextPiece() {
    // Check for stalled downloads
    const now = Date.now();
    if (now - this.lastProgressUpdate > 5 * 60 * 1000) { // 5 minutes
      console.warn('No progress detected for 5 minutes, possible stall');
    }
    
    if (this.pendingPieces.size === 0 && 
        this.inProgressPieces.size === 0 && 
        this.completedPieces.size < this.totalPieces) {
      throw new Error('Download deadlock detected');
    }
    
    for (const piece of this.pendingPieces) {
      this.pendingPieces.delete(piece);
      this.inProgressPieces.add(piece);
      return piece;
    }
    return null;
  }

  markPieceComplete(pieceIndex) {
    this.inProgressPieces.delete(pieceIndex);
    this.completedPieces.add(pieceIndex);
    this.lastProgressUpdate = Date.now();
  }

  markPieceFailed(pieceIndex) {
    this.inProgressPieces.delete(pieceIndex);
    if (!this.completedPieces.has(pieceIndex)) {
      this.pendingPieces.add(pieceIndex);
    }
  }

  isComplete() {
    return this.completedPieces.size === this.totalPieces;
  }
}

async function downloadFile(torrentFile, outputPath, maxConnections = 5) {
  const fileContent = readFile(torrentFile);
  const torrentData = bencode.decode(fileContent);
  const fileLength = torrentData.info.length;
  const pieceLength = torrentData.info['piece length'];
  const totalPieces = Math.ceil(fileLength / pieceLength);
  
  console.log(`Starting download of ${totalPieces} pieces`);
  
  const workQueue = new WorkQueue(totalPieces);
  const downloadedPieces = new Map();
  
  const infoHash = calculateInfoHash(torrentData.info);
  const peerId = generatePeerId();
  const trackerURL = String(torrentData.announce);
  
  const peers = await getTrackerPeers(trackerURL, infoHash, fileLength, peerId);
  if (peers.length === 0) throw new Error("No peers available");

  const actualConnections = Math.min(peers.length, maxConnections);
  console.log(`Starting download with ${actualConnections} connections`);

  const downloadTimeout = 30 * 60 * 1000; // 30 minutes
  let progressInterval;
  let downloadTimeoutId;
  
  const downloadPromise = new Promise(async (resolve, reject) => {
    try {
      const workers = peers.slice(0, actualConnections).map(peer => 
        downloadWorker(peer, torrentFile, torrentData, infoHash, peerId, workQueue, downloadedPieces)
      );
      
      progressInterval = setInterval(() => {
        const progress = (workQueue.completedPieces.size / totalPieces) * 100;
        console.log(`Download progress: ${progress.toFixed(2)}%`);
      }, 5000);

      try {
        await Promise.all(workers);
      } finally {
        clearInterval(progressInterval);
      }

      if (downloadedPieces.size !== totalPieces) {
        throw new Error(`Download incomplete: ${downloadedPieces.size}/${totalPieces} pieces downloaded`);
      }
      
      console.log('All pieces downloaded, assembling file...');
      
      const finalBuffer = Buffer.concat(
        [...downloadedPieces.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([_, data]) => data)
      );

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, finalBuffer);
      console.log(`Download completed: ${outputPath}`);
      resolve();
    } catch (error) {
      clearInterval(progressInterval);
      reject(error);
    }
  });

  try {
    const timeoutPromise = new Promise((_, reject) => {
      downloadTimeoutId = setTimeout(() => {
        clearInterval(progressInterval);
        reject(new Error('Download timeout'));
      }, downloadTimeout);
    });

    await Promise.race([downloadPromise, timeoutPromise]);
  } catch (error) {
    clearInterval(progressInterval);
    console.error("Download failed:", error);
    throw error;
  } finally {
    clearTimeout(downloadTimeoutId);
  }
}

async function downloadWorker(peer, torrentFile, torrentData, infoHash, peerId, workQueue, downloadedPieces) {
  const maxRetries = 3;
  const maxRetriesPerPiece = new Map(); // Track retries per piece
  
  while (!workQueue.isComplete()) {
    const pieceIndex = workQueue.getNextPiece();
    if (pieceIndex === null) {
      console.log('No more pieces to download');
      break;
    }

    // Get retry count for this piece
    const retryCount = maxRetriesPerPiece.get(pieceIndex) || 0;
    if (retryCount >= maxRetries) {
      console.error(`Max retries reached for piece ${pieceIndex}, marking as failed`);
      workQueue.markPieceFailed(pieceIndex);
      continue;
    }

    try {
      const tempPath = path.join(os.tmpdir(), `piece_${pieceIndex}_${Date.now()}_${Math.random()}`);
      
      console.log(`Worker downloading piece ${pieceIndex} (attempt ${retryCount + 1}/${maxRetries})`);
      await downloadPiece(torrentFile, pieceIndex, tempPath);
      
      if (fs.existsSync(tempPath)) {
        const pieceData = fs.readFileSync(tempPath);
        downloadedPieces.set(pieceIndex, pieceData);
        
        try {
          fs.unlinkSync(tempPath);
        } catch (err) {
          console.warn(`Failed to delete temp file ${tempPath}:`, err);
        }
        
        workQueue.markPieceComplete(pieceIndex);
        console.log(`Piece ${pieceIndex} downloaded successfully`);
        maxRetriesPerPiece.delete(pieceIndex); // Reset retries on success
      } else {
        throw new Error(`Temp file ${tempPath} not found`);
      }
    } catch (error) {
      console.error(`Failed to download piece ${pieceIndex}:`, error);
      maxRetriesPerPiece.set(pieceIndex, retryCount + 1);
      workQueue.markPieceFailed(pieceIndex);
      
      // Add delay between retries
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
    }
  }
}

async function main() {
  const command = process.argv[2];
  let dataTorrent;
  const peerID = generatePeerId();
  if (command != "decode") {
    // Decode file input
    
    try {
      
    } catch (error) {
      console.error("Error decoding file content:", error);
      throw error;
    }
  }


  if (command === "decode") {
    const bencodedValue = process.argv[3];
    try {
      //console.log(JSON.stringify(bencode.decode(bencodedValue)));
      console.log(JSON.stringify(decode(bencodedValue)));
    } catch (error) {
      console.error("Error decoding bencoded value:", error);
    }
  }
  else if (command === 'info') {
    const pathStr = process.argv[3];
    const fileContent = readFile(pathStr);
    dataTorrent = bencode.decode(fileContent);
    if (dataTorrent && dataTorrent.info) {
      const trackerURL = String(dataTorrent.announce);
      console.log('Tracker URL:', trackerURL);
      console.log('Length:', dataTorrent.info.length);
      const infoHash = calculateInfoHash(dataTorrent.info);
      console.log('Info Hash:', infoHash);

      const pieceLength = dataTorrent.info['piece length'];
      console.log("Piece Length:", pieceLength);

      const piecesBuffer = dataTorrent.info.pieces;
      const pieces = [];
      for (let i = 0; i < piecesBuffer.length; i += 20) {
        pieces.push(piecesBuffer.slice(i, i + 20).toString('hex'));
      }
      console.log("Piece Hashes:");
      pieces.forEach((hash, index) => {
        console.log(hash);
      });
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }
  }
  else if (command == "peers") {
    const pathStr = process.argv[3];
    const fileContent = readFile(pathStr);
    dataTorrent = bencode.decode(fileContent);
    if (dataTorrent) {
      const trackerURL = String(dataTorrent.announce);
      const infoHash = calculateInfoHash(dataTorrent.info);
      const peersList = await getTrackerPeers(trackerURL, infoHash, dataTorrent.info.length, peerID);
      peersList.forEach(({ ip, port }) => {
        console.log(`${ip}:${port}`);
      });
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }

  }
  else if (command == "handshake") {
    const pathStr = process.argv[3];
    const fileContent = readFile(pathStr);
    dataTorrent = bencode.decode(fileContent);
    if (dataTorrent) {
      const peerAddress = process.argv[4];
      const infoHash = calculateInfoHash(dataTorrent.info);
      performHandshake(peerAddress, infoHash, peerID);
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }

  }
  else if(command == "download_piece") {
    const outputPath = process.argv[4];
    const torrentFile = process.argv[5];
    const pieceIndex = parseInt(process.argv[6]);
    
    try {
      await downloadPiece(torrentFile, pieceIndex, outputPath);
      console.log(`Piece ${pieceIndex} downloaded to ${outputPath}`);
    } catch (error) {
      console.error('Error downloading piece:', error);
    }
  }
  else if(command == "download") {
    const outputPath = process.argv[4];
    const torrentFile = process.argv[5];
    try {
      await downloadFile(torrentFile, outputPath);
    } catch (error) {
      console.error('Error downloading file:', error);
      process.exit(1);
    }
  }
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();

