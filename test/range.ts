import 'mocha'
import fdb = require('../lib')
import assert = require('assert')
import {
  numXF,
  withEachDb,
} from './util'


withEachDb(db => describe('key value functionality', () => {
  const batchToStrUnprefix = (batch: [string | Buffer, string | Buffer][]) => (
    batch.map(([k,v]) => [k.toString(), v.toString()])
  )

  it('returns all values through getRange iteration', async () => {
    const _db = db.at(null, numXF, numXF)
    await _db.doTransaction(async tn => {
      for (let i = 0; i < 100; i++) tn.set(i, i)
    })

    await _db.doTransaction(async tn => {
      let i = 0
      for await (const [key, val] of tn.getRange(0, 1000)) {
        assert.strictEqual(key, i)
        assert.strictEqual(val, i)

        i++
      }
      assert.strictEqual(i, 100)
    })
  })

  it('returns all values through getRangeBatch', async () => {
    const _db = db.at(null, numXF, numXF)
    await _db.doTransaction(async tn => {
      for (let i = 0; i < 100; i++) tn.set(i, i)
    })

    await _db.doTransaction(async tn => {
      let i = 0
      for await (const batch of tn.getRangeBatch(0, 1000)) {
        for (let k = 0; k < batch.length; k++) {
          const [key, val] = batch[k]
          assert.strictEqual(key, i)
          assert.strictEqual(val, i)

          i++
        }
      }
      assert.strictEqual(i, 100)
    })
  })

  it('supports raw string ranges against the root database', async () => {
    // Regression - https://github.com/josephg/node-foundationdb/pull/39
    
    // This regression requires that we run a naked query without a prefix,
    // which is difficult to do with the current API
    await db.getRoot().doTransaction(async tn => {
      for await (const batch of tn.getRange( 'a', 'b' )) {}
    });
  })

  it('fetches tuple ranges using a prefix correctly', async () => {
    const _db = db.withKeyEncoding(fdb.tuple)

    await _db.set(['a\x00'], 'no')
    await _db.set(['a', 'b'], 'yes')

    assert.deepStrictEqual(await _db.getRangeAllStartsWith(['a']),
      [[['a', 'b'], Buffer.from('yes')]]
    )
  })

  it('clears tuple ranges using a prefix correctly', async () => {
    const _db = db.withKeyEncoding(fdb.tuple)

    await _db.set(['a\x00'], 'no')
    await _db.set(['a', 'b'], 'yes')

    await _db.clearRangeStartsWith('a')
    // That should have deleted yes, but not no.

    assert.equal(await _db.get(['a', 'b']), null)
    assert.deepStrictEqual(await _db.get(['a\x00']), Buffer.from('no'))
  })

  it('getRange without a specified end uses start as a prefix')

  describe('selectors', () => {
    const data = [['a', 'A'], ['b', 'B'], ['c', 'C']]
    beforeEach(async () => {
      await db.doTransaction(async tn => {
        data.forEach(([k, v]) => tn.set(k, v))
      })
    })

    it('raw string range queries get [start,end)', async () => {
      const result = batchToStrUnprefix(await db.getRangeAll('a', 'c'))
      assert.deepEqual(result, data.slice(0, 2)) // 'a', 'b'.
    })

    it('returns [start, end) with firstGreaterThanEq selectors', async () => {
      const result = batchToStrUnprefix(
        await db.getRangeAll(
          fdb.keySelector.firstGreaterOrEqual('a'),
          fdb.keySelector.firstGreaterOrEqual('c')))
      
      assert.deepEqual(result, data.slice(0, 2)) // 'a', 'b'.
    })

    it('returns (start, end] with firstGreaterThan selectors', async () => {
      const result = batchToStrUnprefix(
        await db.getRangeAll(
          fdb.keySelector.firstGreaterThan('a'),
          fdb.keySelector.firstGreaterThan('c')))
      
      assert.deepEqual(result, data.slice(1)) // 'b', 'c'.
    })
  })
}))