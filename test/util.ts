// We'll tuck everything behind this prefix and delete it all when the tests finish running.
export const prefix = '__test_data__/'
export const prefixBuf = (key: Buffer) => Buffer.concat([Buffer.from(prefix), key])

// Using big endian numbers because they're lexographically sorted correctly.
export const bufToNum = (b: Buffer | null, def: number = 0) => b ? b.readInt32BE(0) : def
export const numToBuf = (n: number) => {
  const b = new Buffer(4)
  b.writeInt32BE(n, 0)
  return b
}

export const prefixKeyToNum = (key: Buffer) => key.readInt32BE(prefix.length)

export const prefixKey = (key: Buffer | number | string) => (
  typeof key === 'string' ? prefix + key
  : typeof key === 'number' ? prefixBuf(numToBuf(key))
  : prefixBuf(key)
)

export const unprefix = (k: string) => k.slice(prefix.length)
export const unwrapKey = (k: Buffer) => unprefix(k.toString())
