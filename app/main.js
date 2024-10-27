const process = require("process");
const util = require("util");
const fs = require('node:fs').promises;
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

const readFile = async (pathStr) => {
  try {
    const data = fs.readFile(path.resolve('.', pathStr));
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


function getTrackerPeers(trackerURL, infoHash, fileLength, peerId, callback) {
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

  http.get(url, async (response) => {
    let data = [];
    response.on('data', chunk => data.push(chunk));
    response.on('end', () => {
      try {
        const decodedResponse = bencode.decode(Buffer.concat(data));


        if (decodedResponse['failure reason']) {
          const failureReason = Buffer.from(decodedResponse['failure reason']).toString('utf-8');
          console.error("Tracker Failure Reason:", failureReason);
          return;
        }

        const peers = decodedResponse.peers;
        if (!peers) {
          throw new Error("Peers field is missing in the tracker response");
        }

        // Decode peers from compact format
        const peerList = [];
        for (let i = 0; i < peers.length; i += 6) {
          const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`;
          const port = (peers[i + 4] << 8) + peers[i + 5];
          peerList.push(`${ip}:${port}`);
        }
        callback(peerList);
      } catch (error) {
        console.error("Error decoding tracker response:", error);
        callback([]);
      }
    });
  }).on('error', (error) => {
    console.error("Error with tracker request:", error);
    callback([]);
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

async function downloadPiece(peerAddress, infoHash, peerId, pieceIndex, pieceLength, pieceHash) {
  return new Promise((resolve, reject) => {
    const [peerIP, peerPort] = peerAddress.split(':');
    const client = net.createConnection({ host: peerIP, port: parseInt(peerPort) }, async () => {
      console.log(`Connected to peer at ${peerIP}:${peerPort}`);

      const handshakeMessage = createHandshake(infoHash, peerId);
      client.write(handshakeMessage);

      let handshakeReceived = false;
      let bitfieldReceived = false;
      let unchokeReceived = false;
      let pieceData = Buffer.alloc(pieceLength);
      let receivedLength = 0;

      client.on('data', async (data) => {
        if (!handshakeReceived) {
          if (data.length >= 68 && data.toString('utf8', 1, 20) === 'BitTorrent protocol') {
            handshakeReceived = true;
            console.log('Handshake successful');
          } else {
            reject(new Error('Invalid handshake response'));
            client.end();
          }
        } else {
          while (data.length > 0) {
            if (data.length < 4) break;
            const messageLength = data.readUInt32BE(0);
            if (data.length < messageLength + 4) break;

            const messageId = data[4];
            const payload = data.subarray(5, messageLength + 4);

            switch (messageId) {
              case 5: // bitfield
                bitfieldReceived = true;
                client.write(Buffer.from([0, 0, 0, 1, 2])); // Interested message
                break;
              case 1: // unchoke
                unchokeReceived = true;
                sendRequests();
                break;
              case 7: // piece
                const index = payload.readUInt32BE(0);
                const begin = payload.readUInt32BE(4);
                const block = payload.subarray(8);
                block.copy(pieceData, begin);
                receivedLength += block.length;
                if (receivedLength === pieceLength) {
                  const calculatedHash = crypto.createHash('sha1').update(pieceData).digest('hex');
                  if (calculatedHash === pieceHash) {
                    resolve(pieceData);
                    client.end();
                  } else {
                    reject(new Error('Piece hash mismatch'));
                    client.end();
                  }
                }
                break;
            }

            data = data.subarray(messageLength + 4);
          }
        }
      });

      function sendRequests() {
        const blockSize = 16 * 1024;
        const numBlocks = Math.ceil(pieceLength / blockSize);
        for (let i = 0; i < numBlocks; i++) {
          const begin = i * blockSize;
          const length = Math.min(blockSize, pieceLength - begin);
          const requestMsg = Buffer.alloc(17);
          requestMsg.writeUInt32BE(13, 0);
          requestMsg.writeUInt8(6, 4);
          requestMsg.writeUInt32BE(pieceIndex, 5);
          requestMsg.writeUInt32BE(begin, 9);
          requestMsg.writeUInt32BE(length, 13);
          client.write(requestMsg);
        }
      }
    });

    client.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  const command = process.argv[2];
  let dataTorrent;
  const peerId = generatePeerId();

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
    const fileContent = await readFile(pathStr);
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
    const fileContent = await readFile(pathStr);
    dataTorrent = bencode.decode(fileContent);
    if (dataTorrent) {
      const trackerURL = String(dataTorrent.announce);
      const infoHash = calculateInfoHash(dataTorrent.info);
      getTrackerPeers(trackerURL, infoHash, dataTorrent.info.length, peerId);
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }

  }
  else if (command == "handshake") {
    const pathStr = process.argv[3];
    const fileContent = await readFile(pathStr);
    dataTorrent = bencode.decode(fileContent);
    if (dataTorrent) {
      const peerAddress = process.argv[4];
      const infoHash = calculateInfoHash(dataTorrent.info);
      performHandshake(peerAddress, infoHash, peerId);
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }

  }
  else if (command === 'download_piece') {
    const pathStr = process.argv[5];
    const fileContent = await readFile(pathStr);
    dataTorrent = bencode.decode(fileContent);
    if (dataTorrent) {
      const outputPath = process.argv[4];
      const pieceIndex = parseInt(process.argv[6]);
      const trackerURL = String(dataTorrent.announce);
      const infoHash = calculateInfoHash(dataTorrent.info);
      const pieceLength = dataTorrent.info['piece length'];
      const piecesBuffer = dataTorrent.info.pieces;
      const pieceHash = piecesBuffer.slice(pieceIndex * 20, pieceIndex * 20 + 20).toString('hex');

      // Get peers from tracker
      const peers = await new Promise((resolve) => {
        getTrackerPeers(trackerURL, infoHash, dataTorrent.info.length, peerId, resolve);
      });

      if (peers.length === 0) {
        throw new Error('No peers available');
      }

      // Try downloading from the first peer
      try {
        const pieceData = await downloadPiece(peers[0], infoHash, peerId, pieceIndex, pieceLength, pieceHash);
        await fs.writeFile(outputPath, pieceData);
        console.log(`Piece ${pieceIndex} downloaded successfully and saved to ${outputPath}`);
      } catch (error) {
        console.error('Error downloading piece:', error);
      }
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }
  }
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
