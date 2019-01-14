import * as apiVersion from './apiVersion'

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
  // Buffer.from does support taking a string but @types/node has overly
  // strict type definitions for the function.
  const buf = Buffer.from(val as any)
  return Buffer.concat([buf, byteZero], buf.length + 1)
}

export const packVersionstampedValue = (val: Buffer, pos: number = 0) => {
  const writeOffset = apiVersion.get()! >= 520
  if (!writeOffset && pos !== 0) throw Error('Cannot write versionstamped value at non-zero offset before API version 520')

  const result = Buffer.alloc(val.length + 10 + (writeOffset ? 4 : 0))
  // if (vs) vs.copy(result, pos)

  if (pos > 0) val.copy(result, 0, 0, pos)
  val.copy(result, pos + 10, pos)
  if (writeOffset) result.writeUInt32LE(pos, result.length - 4)

  return result
}

export const unpackVersionstampedValue = (rawVal: Buffer) => ({
  stamp: rawVal.slice(0, 10),
  val: rawVal.slice(10)
})

export const asBuf = (val: Buffer | string): Buffer => (
  typeof val === 'string' ? Buffer.from(val, 'utf8') : val
)
