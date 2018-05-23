// String increment. Find the next string (well, buffer) after this buffer.
export const strInc = (val: string | Buffer): Buffer => {
  const buf = typeof val === 'string' ? Buffer.from(val) : val

  let lastNonFFByte
  for(lastNonFFByte = buf.length-1; lastNonFFByte >= 0; --lastNonFFByte) {
    if(buf[lastNonFFByte] != 0xFF) break;
  }

  if(lastNonFFByte < 0) {
    throw new Error(`invalid argument '${val}': prefix must have at least one byte not equal to 0xFF`)
  }

  const result = Buffer.alloc(lastNonFFByte + 1)
  buf.copy(result, 0, 0, result.length)
  ++result[lastNonFFByte]

  return result;
}

const byteZero = Buffer.alloc(1)
byteZero.writeUInt8(0, 0)

// This appends \x00 to a key to get the next key.
export const strNext = (val: string | Buffer): Buffer => {
  const buf = Buffer.from(val)
  return Buffer.concat([buf, byteZero], buf.length + 1)
}
