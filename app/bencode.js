function decode(data) {
    let index = 0;

    function consume(length) {
        const result = data.slice(index, index + length);
        index += length;
        return result;
    }

    function decodeString() {
        let colonIndex = data.indexOf(':', index);
        let length = parseInt(data.slice(index, colonIndex), 10);
        index = colonIndex + 1;
        return consume(length);
    }

    function decodeInteger() {
        index++; // Skip 'i'
        let endIndex = data.indexOf('e', index);
        let integer = parseInt(data.slice(index, endIndex), 10);
        index = endIndex + 1;
        return integer;
    }


    function decodeList() {
        index++; // Skip 'l'
        const list = [];
        while (data[index] !== 'e') {
            list.push(decodeNext());
        }
        index++; // Skip 'e'
        return list;
    }

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
    return decodeNext();
}


function encode(obj) {
    if (typeof obj === 'string') {
      return obj.length + ':' + obj;
    } else if (typeof obj === 'number') {
      return 'i' + obj + 'e';
    } else if (Array.isArray(obj)) {
      return 'l' + obj.map(encodeBencode).join('') + 'e';
    } else if (typeof obj === 'object') {
      let encoded = 'd';
      for (const [key, value] of Object.entries(obj)) {
        encoded += encode(key) + encode(value);
      }
      return encoded + 'e';
    }
    throw new Error('Unsupported data type');
  }

exports.decode = decode;
exports.encode = encode;