const process = require("process");
const util = require("util");
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('crypto');
const bencode = require('bencode');

const readFile = (pathStr) => {
  try {
    const data = fs.readFileSync(path.resolve('.', pathStr));
    return data; // Return raw buffer data
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

function main() {
  const command = process.argv[2];

  if (command === "decode") {
    const bencodedValue = process.argv[3];
    try {
      console.log(JSON.stringify(bencode.decode(bencodedValue)));
    } catch (error) {
      console.error("Error decoding bencoded value:", error);
    }
  }
  else if (command === 'info') {
    const pathStr = process.argv[3];
    const fileContent = readFile(pathStr);
    let data;
    try {
      data = bencode.decode(fileContent);
    } catch (error) {
      console.error("Error decoding file content:", error);
      throw error;
    }
    
    if (data && data.info) {
      const infoHash = calculateInfoHash(data.info);
      console.log('Info Hash:', infoHash);
    } else {
      console.error("Invalid data structure, 'info' field missing.");
    }
  }
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
