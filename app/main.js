const process = require("process");
const util = require("util");

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

function decodeBencode(data) {
  let index = 0;

  // Helper function to consume a portion of the data
  function consume(length) {
      const result = data.slice(index, index + length);
      index += length;
      return result;
  }

  // Decoding a string (format: length:number:number of bytes)
  function decodeString() {
      let colonIndex = data.indexOf(':', index);
      let length = parseInt(data.slice(index, colonIndex), 10);
      index = colonIndex + 1;
      return consume(length);
  }

  // Decoding an integer (format: i<number>e)
  function decodeInteger() {
      index++; // Skip 'i'
      let endIndex = data.indexOf('e', index);
      let integer = parseInt(data.slice(index, endIndex), 10);
      index = endIndex + 1;
      return integer;
  }

  // Decoding a list (format: l<values>e)
  function decodeList() {
      index++; // Skip 'l'
      const list = [];
      while (data[index] !== 'e') {
          list.push(decodeNext());
      }
      index++; // Skip 'e'
      return list;
  }

  // Decoding a dictionary (format: d<key-value pairs>e)
  function decodeDictionary() {
      index++; // Skip 'd'
      const dictionary = {};
      while (data[index] !== 'e') {
          const key = decodeString();
          const value = decodeNext();
          dictionary[key] = value;
      }
      index++; // Skip 'e'
      return dictionary;
  }

  // Main function to decode next item (string, integer, list, or dictionary)
  function decodeNext() {
      const char = data[index];
      if (char === 'i') {
          return decodeInteger();
      } else if (char === 'l') {
          return decodeList();
      } else if (char === 'd') {
          return decodeDictionary();
      } else if (/\d/.test(char)) {
          return decodeString();
      } else {
          throw new Error(`Unknown type: ${char}`);
      }
  }

  // Start decoding the data
  return decodeNext();
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
    console.log(JSON.stringify(decodeBencode(bencodedValue)));
  } else {
    throw new Error(`Unknown command ${command}`);
  }
}

main();
