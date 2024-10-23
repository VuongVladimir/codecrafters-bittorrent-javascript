const process = require("process");
const util = require("util");
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('crypto');
const { encode, decode } = require("./bencode");

// Examples:
// - decodeBencode("5:hello") -> "hello"
// - decodeBencode("10:hello12345") -> "hello12345"

const readFile = (pathStr) => {
  const d = fs.readFileSync(path.resolve('.', pathStr), { encoding: 'ascii', flag: 'r' }).trim();
  //console.log(d);
  return d;
}


// // Function to calculate the SHA-1 hash
function calculateInfoHash(infoDict) {
  const bencodedInfo = encode(infoDict); // Re-bencode the info dictionary
  //console.log('Bencoded Info:', bencodedInfo);
  const sha1Hash = crypto.createHash('sha1').update(Buffer.from(bencodedInfo, 'binary')).digest('hex'); // Use binary buffer
  return sha1Hash;
}


function main() {
  const command = process.argv[2];

  // You can use print statements as follows for debugging, they'll be visible when running tests.
  //console.log("Logs from your program will appear here!");

  // Uncomment this block to pass the first stage
  if (command === "decode") {
    const bencodedValue = process.argv[3];

    // In JavaScript, there's no need to manually convert bytes to string for printing
    // because JS doesn't distinguish between bytes and strings in the same way Python does.
    console.log(JSON.stringify(decode(bencodedValue)));
  }
  else if (command === 'info') {
    const pathStr = process.argv[3];
    const data = decode(readFile(pathStr));
    
    //console.log('Tracker URL:', data.announce);
    //console.log('Length:', data.info.length);
    // info-hash
    const infoHash = calculateInfoHash(data.info);
    console.log('Info Hash:', infoHash);
  }
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
