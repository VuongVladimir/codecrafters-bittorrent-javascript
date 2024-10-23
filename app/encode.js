const INTEGER_START = "i";
const STRING_DELIM = ":";
const DICTIONARY_START = "d";
const LIST_START = "l";
const END_OF_TYPE = "e";
const encodeInteger = (value) => {
  const bencodedInteger = INTEGER_START + value.toString() + END_OF_TYPE;
  const buffer = Buffer.from(bencodedInteger);
  return buffer;
};
const encodeString = (value) => {
  if (!Buffer.isBuffer(value)) {
    value = Buffer.from(value);
  }
  const lengthBuffer = Buffer.from(value.length.toString() + STRING_DELIM);
  const buffer = Buffer.concat([lengthBuffer, value]);
  return buffer;
};
const encodeList = (value) => {
  const bufferStart = Buffer.from(LIST_START);
  const bufferEnd = Buffer.from(END_OF_TYPE);
  const bufferValue = value.map((element) => encode(element));
  const buffer = Buffer.concat([bufferStart, ...bufferValue, bufferEnd]);
  return buffer;
};
const encodeDictionary = (value) => {
  const bufferStart = Buffer.from(DICTIONARY_START);
  const bufferEnd = Buffer.from(END_OF_TYPE);
  const keys = Object.keys(value).sort();
  const bufferValue = Object.keys(value)
    .sort()
    .map((key) => {
      const bufferKey = encodeString(key);
      const bufferVal = encode(value[key]);
      return Buffer.concat([bufferKey, bufferVal]);
    });
  const buffer = Buffer.concat([bufferStart, ...bufferValue, bufferEnd]);
  return buffer;
};
const encode = (value) => {
  if (ArrayBuffer.isView(value))
    return encodeString(new Uint8Array(value, 0, value.length));
  if (typeof value === "number") return encodeInteger(value);
  else if (typeof value === "string") return encodeString(value);
  else if (Array.isArray(value)) return encodeList(value);
  else if (typeof value === "object") return encodeDictionary(value);
  else throw new Error("Invalid type");
};
1
module.exports = encode;