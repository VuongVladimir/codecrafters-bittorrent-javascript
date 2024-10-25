const process = require("process");
const util = require("util");
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('crypto');
const bencode = require('bencode');
const http = require('http');
const { URL } = require('url');
const { decode } = require('./bencode');


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

const querystring = require('querystring');
function getTrackerPeers(trackerURL, infoHash, fileLength) {
  const peerId = crypto.randomBytes(20).toString('hex').slice(0, 20);
  let infoHashUrlEncoded = "";
    for (let i = 0; i < infoHash.length; i += 2) {
      infoHashUrlEncoded += "%" + infoHash.substring(i, i + 2);
    }

  const params = new URLSearchParams({
    peer_id: peerId,
    port: 6881,
    uploaded: 0,
    downloaded: 0,
    left: fileLength,
    compact: 1
  });

  //const url = `${trackerURL}?${params.toString()}`;

  const url = trackerURL + "?info_hash=" + infoHashUrlEncoded + "&" + params.toString().toLowerCase();
 

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
        for (let i = 0; i < peers.length; i += 6) {
          const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`;
          const port = (peers[i + 4] << 8) + peers[i + 5];
          console.log(`${ip}:${port}`);
        }
      } catch (error) {
        console.error("Error decoding tracker response:", error);
      }
    });
  }).on('error', (error) => {
    console.error("Error with tracker request:", error);
  });
}



function main() {
  const command = process.argv[2];

  if(command != "decode") {
    // Decode file input
  const pathStr = process.argv[3];
  const fileContent = readFile(pathStr);
  let data;
  try {
    data = bencode.decode(fileContent);
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
    if (data && data.info) {
      const trackerURL = String(data.announce);
      console.log('Tracker URL:', trackerURL);
      console.log('Length:', data.info.length);
      const infoHash = calculateInfoHash(data.info);
      console.log('Info Hash:', infoHash);

      const pieceLength = data.info['piece length'];
      console.log("Piece Length:", pieceLength);

      const piecesBuffer = data.info.pieces;
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
    if (data) {
      const trackerURL = String(data.announce);
      const infoHash = calculateInfoHash(data.info);
      getTrackerPeers(trackerURL, infoHash, data.info.length);
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }

  }
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
