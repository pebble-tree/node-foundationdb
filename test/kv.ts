import 'mocha'
import fdb = require('../lib')
import assert = require('assert')

process.on('unhandledRejection', err => { throw err.stack })

// We'll tuck everything behind this prefix and delete it all when the tests finish running.
const prefix = '__test_data__/'
const prefixBuf = (key: Buffer) => Buffer.concat([Buffer.from(prefix), key])

// Using big endian numbers because they're lexographically sorted correctly.
const bufToNum = (b: Buffer | null, def: number = 0) => b ? b.readInt32BE(0) : def
const numToBuf = (n: number) => {
  const b = new Buffer(4)
  b.writeInt32BE(n, 0)
  return b
}

const prefixKeyToNum = (key: Buffer) => key.readInt32BE(prefix.length)

const prefixKey = (key: Buffer | number | string) => (
  typeof key === 'string' ? prefix + key
  : typeof key === 'number' ? prefixBuf(numToBuf(key))
  : prefixBuf(key)
)

const unprefix = (k: string) => k.slice(prefix.length)
const unwrapKey = (k: Buffer) => unprefix(k.toString())

// These tests just use a single shared database instance which is reset
// between tests. It would be cleaner if we used beforeEach to close & reopen
// the database but its probably fine like this.
const db = fdb.openSync()

beforeEach(() => db.clearRangeStartsWith(prefix))
afterEach(() => db.clearRangeStartsWith(prefix))

describe('key value functionality', () => {
  it('reads its writes inside a txn', async () => {
    await db.doTransaction(async tn => {
      const key = prefix + 'xxx'
      const val = Buffer.from('hi there')

      tn.set(key, val)

      const result = await tn.get(key)
      assert.deepStrictEqual(result, val)
    })
  })

  it('reads its writes in separate transactions', async () => {
    const key = prefix + 'xxx'
    const val = Buffer.from('hi there')

    await db.doTransaction(async tn => {
      tn.set(key, val)
    })

    await db.doTransaction(async tn => {
      const result = await tn.get(key)
      assert.deepStrictEqual(result, val)
    })
  })

  it('lets you read and write via the database directly', async () => {
    const key = prefix + 'xxx'
    const val = Buffer.from('hi there')
    await db.set(key, val)
    const result = await db.get(key)
    assert.deepStrictEqual(result, val)
  })

  it('returns the user value from db.doTransaction', async () => {
    const val = {}
    const result = await db.doTransaction(async tn => val)
    assert.strictEqual(val, result)
  })

  it('lets you cancel a txn')

  it('retries conflicts', async function() {
    this.slow(2000)
    const concurrentWrites = 30
    const key = prefix + 'num'

    await db.set(key, numToBuf(0))

    let txnAttempts = 0
    await Promise.all(new Array(concurrentWrites).fill(0).map((_, i) => (
      db.doTransaction(async tn => {
        const val = bufToNum(await tn.get(key))
        tn.set(key, numToBuf(val + 1))
        txnAttempts++
      })
    )))

    const result = bufToNum(await db.get(key))
    assert.strictEqual(result, concurrentWrites)

    // This doesn't necessarily mean there's an error, but if there weren't
    // more attempts than there were increments, the database is running
    // serially and this test is doing nothing.
    assert(txnAttempts > concurrentWrites)
  })

  describe('ranges', () => {
    const batchToStrUnprefix = (batch: [Buffer, Buffer][]) => (
      batch.map(([k,v]) => [unprefix(k.toString()), v.toString()])
    )

    it('returns all values through getRange iteration', async () => {
      await db.doTransaction(async tn => {
        for (let i = 0; i < 100; i++) tn.set(prefixKey(i), numToBuf(i))
      })

      await db.doTransaction(async tn => {
        let i = 0
        for await (const [keyRaw, valRaw] of tn.getRange(prefix, prefixKey(1000))) {
          const key = prefixKeyToNum(keyRaw)
          assert.strictEqual(key, i)
          const val = bufToNum(valRaw)
          assert.strictEqual(val, i)

          i++
        }
        assert.strictEqual(i, 100)
      })
    })

    it('returns all values through getRangeBatch', async () => {
      await db.doTransaction(async tn => {
        for (let i = 0; i < 100; i++) tn.set(prefixKey(i), numToBuf(i))
      })

      await db.doTransaction(async tn => {
        let i = 0
        for await (const batch of tn.getRangeBatch(prefix, prefixKey(1000))) {
          for (let k = 0; k < batch.length; k++) {
            const [keyRaw, valRaw] = batch[k]
            const key = prefixKeyToNum(keyRaw)
            assert.strictEqual(key, i)
            const val = bufToNum(valRaw)
            assert.strictEqual(val, i)

            i++
          }
        }
        assert.strictEqual(i, 100)
      })
    })

    describe('selectors', () => {
      const data = [['a', 'A'], ['b', 'B'], ['c', 'C']]
      beforeEach(async () => {
        await db.doTransaction(async tn => {
          data.forEach(([k, v]) => tn.set(prefix+k, v))
        })
      })

      it('raw string range queries get [start,end)', async () => {
        const result = batchToStrUnprefix(await db.getRangeAll(prefix+'a', prefix+'c'))
        assert.deepEqual(result, data.slice(0, 2)) // 'a', 'b'.
      })

      it('returns [start, end) with firstGreaterThanEq selectors', async () => {
        const result = batchToStrUnprefix(
          await db.getRangeAll(
            fdb.keySelector.firstGreaterOrEqual(prefix+'a'),
            fdb.keySelector.firstGreaterOrEqual(prefix+'c')))
        
        assert.deepEqual(result, data.slice(0, 2)) // 'a', 'b'.
      })

      it('returns (start, end] with firstGreaterThan selectors', async () => {
        const result = batchToStrUnprefix(
          await db.getRangeAll(
            fdb.keySelector.firstGreaterThan(prefix+'a'),
            fdb.keySelector.firstGreaterThan(prefix+'c')))
        
        assert.deepEqual(result, data.slice(1)) // 'b', 'c'.
      })
    })
  })

  describe('tuple', () => {
    it('roundtrips expected values', () => {
      const data = ['hi', null, '👾', 321, 0, -100]
      assert.deepStrictEqual(fdb.tuple.unpack(fdb.tuple.pack(data)), data)
    })
  })
})