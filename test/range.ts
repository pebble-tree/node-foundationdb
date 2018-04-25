import 'mocha'
import fdb = require('../lib')
import assert = require('assert')
import {
  prefix,
  numToBuf,
  bufToNum,
  unprefix,
  prefixKey,
  prefixKeyToNum,
} from './util'


const db = fdb.openSync()

beforeEach(() => db.clearRangeStartsWith(prefix))
afterEach(() => db.clearRangeStartsWith(prefix))

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