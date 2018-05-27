import 'mocha'
import assert = require('assert')
import {
  strXF,
  numToBuf,
  bufToNum,
  withEachDb,
} from './util'
import {MutationType} from '../lib'

process.on('unhandledRejection', err => { throw err })

withEachDb(db => describe('key value functionality', () => {
  it('reads its writes inside a txn', async () => {
    await db.doTransaction(async tn => {
      const val = Buffer.from('hi there')
      tn.set('xxx', val)

      const result = await tn.get('xxx')
      assert.deepStrictEqual(result, val)
    })
  })

  it('reads its writes in separate transactions', async () => {
    const val = Buffer.from('hi there')

    await db.doTransaction(async tn => {
      tn.set('xxx', val)
    })

    await db.doTransaction(async tn => {
      const result = await tn.get('xxx')
      assert.deepStrictEqual(result, val)
    })
  })

  it('lets you read and write via the database directly', async () => {
    const val = Buffer.from('hi there')
    await db.set('xxx', val)
    const result = await db.get('xxx')
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
      tn.set('x', 'hi there')
      assert.equal(await tn.get('x'), null)
    }, {read_your_writes_disable: true})
  })

  it('retries conflicts', async function() {
    // Transactions do exponential backoff when they conflict, so the time
    // this test takes to run is super variable based on how unlucky we get
    // with concurrency.
    this.slow(3000)
    const concurrentWrites = 30
    const key = 'num'

    await db.set(key, numToBuf(0))

    let txnAttempts = 0
    await Promise.all(new Array(concurrentWrites).fill(0).map((_, i) => (
      db.doTransaction(async tn => {
        const val = bufToNum((await tn.get(key)) as Buffer)
        tn.set(key, numToBuf(val + 1))
        txnAttempts++
      })
    )))

    const result = bufToNum((await db.get(key)) as Buffer)
    assert.strictEqual(result, concurrentWrites)

    // This doesn't necessarily mean there's an error, but if there weren't
    // more attempts than there were increments, the database is running
    // serially and this test is doing nothing.
    assert(txnAttempts > concurrentWrites)
  })

  it('handles setVersionstampedKey correctly', async () => {
    const keyPrefix = Buffer.from('hi there')

    await db.setVersionstampedKeyPrefix(keyPrefix, Buffer.from('yo yo'))
    const result = await db.getRangeAllStartsWith(keyPrefix)
    assert.strictEqual(result.length, 1)
    const [keyResult, valResult] = result[0]
    assert.strictEqual(keyResult.slice(0, keyPrefix.length).toString(), 'hi there')
    assert.strictEqual(keyResult.length, keyPrefix.length + 10)
    assert.strictEqual(valResult.toString(), 'yo yo')
  })

  it('handles setVersionstampedValue', async () => {
    const db_ = db.withValueEncoding(strXF)
    await db_.setPackedVersionstampedValue('hi there', 'yooo')
    
    const result = await db_.getPackedVersionstampedValue('hi there')
    assert(result != null)

    const {stamp, val} = result!
    assert.strictEqual(stamp.length, 10) // Opaque.
    assert.strictEqual(val, 'yooo')
  })
}))
