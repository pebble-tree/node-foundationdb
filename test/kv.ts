import 'mocha'
import assert = require('assert')
import {
  prefix,
  numToBuf,
  bufToNum,
  withEachDb,
} from './util'
import {MutationType} from '../lib'

process.on('unhandledRejection', err => { throw err })

withEachDb(db => describe('key value functionality', () => {
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

  it.skip('lets you cancel a txn', async () => {
    // So right now when you cancel a transaction db.doTransaction throws with
    // a transaction_cancelled error. I'm not sure if this API is what we want?
    await db.doTransaction(async tn => {
      tn.rawCancel()
    })
  })

  it('obeys transaction options', async function() {
    // We can't test all the options, but we can test at least one.
    await db.doTransaction(async tn => {
      const key = prefix + 'x'
      tn.set(key, 'hi there')
      assert.equal(await tn.get(key), null)
    }, {read_your_writes_disable: true})
  })

  it('retries conflicts', async function() {
    // Transactions do exponential backoff when they conflict, so the time
    // this test takes to run is super variable based on how unlucky we get
    // with concurrency.
    this.slow(3000)
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

  it('handles setVersionstampedKey correctly', async () => {
    // TODO: I need a helper for this.
    const keyPrefix = Buffer.from(prefix + 'hi there')
    const keyArg = Buffer.concat([keyPrefix, Buffer.alloc(12)])
    keyArg.writeInt16LE(keyPrefix.length, keyArg.length-2)

    await db.setVersionstampedKey(keyArg, Buffer.from('hi there'))
    const result = await db.getRangeAllStartsWith(keyPrefix)
    assert.strictEqual(result.length, 1)
    const [keyResult, valResult] = result[0]
    assert.strictEqual(keyResult.slice(0, keyPrefix.length).toString(), prefix + 'hi there')
    assert.strictEqual(keyResult.length, keyPrefix.length + 10)
    assert.strictEqual(valResult.toString(), 'hi there')
  })
}))