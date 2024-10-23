const process = require("process");
const util = require("util");
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('crypto');
const { encode, decode } = require("./bencode");

// Examples:
// - decodeBencode("5:hello") -> "hello"
// - decodeBencode("10:hello12345") -> "hello12345"

// function decodeBencode(bencodedValue) {
//   // Check if the first character is a digit
//   if (bencodedValue[0] === "l" && bencodedValue[bencodedValue.length - 1] === "e") {
//     if (bencodedValue.length === 2) {
//       return [];
//     }
//     if (bencodedValue[1] === "l" && bencodedValue[2] === "i" && bencodedValue[bencodedValue.length - 2] === "e") {
//       const parts = bencodedValue.split(":");
//       const string_length = parseInt(parts[0].substr(parts[0].length - 1, parts[0].length - 1), 10);
//       const string_text = parts[1].substr(0, string_length);
//       const number_text = parseInt(parts[0].substr(3, parts[0].length - 3), 10);
//       const list = [];
//       list.push(number_text);
//       list.push(string_text);
//       const return_list = [];
//       return_list.push(list)
//       return return_list;
//     }
//     const parts = bencodedValue.split(":");
//     const string_length = parseInt(parts[0].substr(1, 1), 10);
//     const string_text = parts[1].substr(0, string_length);
//     const number_text = parseInt(parts[1].substr(string_length + 1, parts[1].length - 3), 10);
//     const list = [];
//     list.push(string_text);
//     list.push(number_text);
//     return list;
//   }
//   if (!isNaN(bencodedValue[0])) {
//     const firstColonIndex = bencodedValue.indexOf(":");
//     if (firstColonIndex === -1) {
//       throw new Error("Invalid encoded value");
//     }
//     return bencodedValue.substr(firstColonIndex + 1);
//   }
//   else if (bencodedValue[0] === "i" && bencodedValue[bencodedValue.length - 1] === "e") {
//     return +bencodedValue.slice(1, -1);
//   }
//   else {
//     throw new Error("Only strings are supported at the moment");
//   }
// }



const readFile = (pathStr) => {
  const d = fs.readFileSync(path.resolve('.', pathStr), { encoding: 'ascii', flag: 'r' }).trim();
  //console.log(d);
  return d;
}




// // Function to calculate the SHA-1 hash
// function calculateInfoHash(infoDict) {
//   const bencodedInfo = encodeBencode(infoDict); // Re-bencode the info dictionary
//   const sha1Hash = crypto.createHash('sha1').update(Buffer.from(bencodedInfo, 'binary')).digest('hex'); // Use binary buffer
//   return sha1Hash;
// }

function calculateSHA1(inputString) {
  const sha1Hash = crypto.createHash("sha1");
  sha1Hash.update(inputString);
  return sha1Hash.digest("hex");
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
    
    console.log('Tracker URL:', data.announce);
    console.log('Length:', data.info.length);
    // info-hash
    //const infoHash = calculateInfoHash(data.info);
    //console.log('Info Hash:', infoHash);
  }
  else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
