import 'mocha'
import fdb = require('../lib')
import Database from '../lib/database'

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

export const withEachDb = (fn: (db: Database) => void) => {

  // These tests just use a single shared database instance which is reset
  // between tests. It would be cleaner if we used beforeEach to close & reopen
  // the database but its probably fine like this.
  const db = fdb.openSync()

  // We need to do this both before and after tests run to clean up any mess
  // that a previously aborted test left behind.
  beforeEach(() => db.clearRangeStartsWith(prefix))
  afterEach(() => db.clearRangeStartsWith(prefix))

  describe('raw database', () => fn(db))

  const subspace = db.at('__subspace__')
  describe('inside subspace', () => fn(db))
  // TODO: It would be nice to check that nothing was written outside of the prefix.
}