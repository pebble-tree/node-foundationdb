const dbOptions = require('../options.g.json')

export type OptVal = string | number | Buffer | null
export type Opts = {
  [name: string]: OptVal
}
export type OptionIter = (code: number, val: OptVal) => void
export const eachOption = (optType: 'NetworkOption' | 'DatabaseOption' | 'TransactionOption', opts: Opts, iterfn: OptionIter) => {
  const validOptions = dbOptions[optType]

  for (const k in opts) {
    const details = validOptions[k]
    if (details == null) {
      console.warn('Warning: Ignoring unknown option', k)
      continue
    }

    const {code, type} = details
    const userVal = opts[k]

    switch (type) {
      case 'none':
        if (userVal !== 'true' && userVal !== 1) console.warn('Ignoring value for key', k)
        iterfn(details.code, null)
        break
      case 'string': case 'bytes':
        iterfn(details.code, Buffer.from(userVal as any))
        break
      case 'int':
        if (typeof userVal !== 'number') console.warn('unexpected value for key', k, 'expected int')
        iterfn(details.code, (userVal as number)|0)
        break
    }
  }
}

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

  const result = new Buffer(lastNonFFByte + 1)
  buf.copy(result, 0, 0, result.length)
  ++result[lastNonFFByte]

  return result;
}

const byteZero = new Buffer(1)
byteZero.writeUInt8(0, 0)

// This appends \x00 to a key to get the next key.
export const strNext = (val: string | Buffer): Buffer => {
  const buf = Buffer.from(val)
  return Buffer.concat([buf, byteZero], buf.length + 1)
}
