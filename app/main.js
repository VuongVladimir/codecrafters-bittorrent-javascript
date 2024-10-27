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

    client.connect(peer.port, peer.ip, () => {
      console.log(`Connected to peer ${peer.ip}:${peer.port}`);
      const handshakeMsg = createHandshake(infoHash, peerId.toString('hex'));
      client.write(handshakeMsg);
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

    client.on('data', (data) => {
      console.log(`Received data of length: ${data.length}`);
      if (!handshakeReceived) {
        if (data.length >= 68 && data.toString('utf8', 1, 20) === 'BitTorrent protocol') {
          handshakeReceived = true;
          console.log('Handshake received');
        } else {
          console.log('Invalid handshake received');
        }
        return;
      }

      let offset = 0;
      while (offset < data.length) {
        if (data.length - offset < 4) break;
        const messageLength = data.readUInt32BE(offset);
        if (data.length - offset < 4 + messageLength) break;

        const messageId = messageLength > 0 ? data.readUInt8(offset + 4) : -1;
        const payload = data.slice(offset + 5, offset + 4 + messageLength);

        console.log(`Received message: id=${messageId}, length=${messageLength}`);

        switch (messageId) {
          case 5: // Bitfield
            bitfieldReceived = true;
            console.log('Bitfield received');
            const interestedMsg = Buffer.from([0, 0, 0, 1, 2]);
            client.write(interestedMsg);
            console.log('Sent interested message');
            break;
          case 1: // Unchoke
            unchokeReceived = true;
            console.log('Unchoke received');
            for (let i = 0; i < 5 && requestsSent * blockSize < currentPieceLength; i++) {
              const begin = requestsSent * blockSize;
              const length = Math.min(blockSize, currentPieceLength - begin);
              sendRequest(begin, length);
            }
            break;
          case 7: // Piece
            const blockIndex = payload.readUInt32BE(0);
            const blockBegin = payload.readUInt32BE(4);
            const blockData = payload.slice(8);
            blockData.copy(pieceData, blockBegin);
            receivedLength += blockData.length;
            blocksReceived++;
            console.log(`Received block: index=${blockIndex}, begin=${blockBegin}, length=${blockData.length}`);

            if (receivedLength === currentPieceLength) {
              const pieceHash = crypto.createHash('sha1').update(pieceData).digest('hex');
              const expectedHash = torrentData.info.pieces.slice(pieceIndex * 20, pieceIndex * 20 + 20).toString('hex');

              if (pieceHash === expectedHash) {
                fs.writeFileSync(outputPath, pieceData);
                console.log(`Piece ${pieceIndex} downloaded successfully`);
                client.destroy();
                resolve();
              } else {
                reject(new Error(`Piece ${pieceIndex} hash mismatch`));
              }
            } else if (requestsSent * blockSize < currentPieceLength) {
              const begin = requestsSent * blockSize;
              const length = Math.min(blockSize, currentPieceLength - begin);
              sendRequest(begin, length);
            }
            break;
          default:
            console.log(`Unhandled message type: ${messageId}`);
        }

        offset += 4 + messageLength;
      }
    });

    client.on('error', (error) => {
      console.error('Connection error:', error);
      reject(error);
    });

    client.on('close', () => {
      console.log('Connection closed');
      if (receivedLength !== currentPieceLength) {
        reject(new Error(`Incomplete download: received ${receivedLength} out of ${currentPieceLength} bytes`));
      }
    });

    // Add a timeout to prevent hanging indefinitely
    setTimeout(() => {
      if (receivedLength !== currentPieceLength) {
        client.destroy();
        reject(new Error('Download timeout'));
      }
    }, 30000); // 30 seconds timeout
  });
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
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
