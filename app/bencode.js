function decodeBencode(data) {
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


function bencode(input) {
    if (Number.isFinite(input)) {
        return `i${input}e`;
    } else if (typeof input === "string") {
        const s = Buffer.from(input, "binary");
        return `${s.length}:` + s.toString("binary");
    } else if (Array.isArray(input)) {
        return `l${input.map((i) => bencode(i)).join("")}e`;
    } else {
        const d = Object.entries(input)
            .sort(([k1], [k2]) => k1.localeCompare(k2))
            .map(([k, v]) => `${bencode(k)}${bencode(v)}`);
        return `d${d.join("")}e`;
    }
}

exports.decodeBencode = decodeBencode;
exports.bencode = bencode;