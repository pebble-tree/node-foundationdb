import fdb = require('./index')
import {StreamingMode} from './opts.g'
import * as ks from './keySelector'

process.on('unhandledRejection', err => { throw err.stack })

const db = fdb.openSync()

const fromBuf = (b: Buffer | null) => b ? b.readInt32LE(0) : 0
const toBuf = (n: number) => {
  const b = new Buffer(4)
  b.writeInt32LE(n, 0)
  return b
}

const conflictWrites = async () => {
  console.log('Setting val to 0')
  await db.set('val', toBuf(0))
  let txnAttempts = 0

  await Promise.all(new Array(100).fill(0).map((_, i) => (
    db.doTransaction(async tn => {
      const val = fromBuf(await tn.get('val'))
      tn.set('val', toBuf(val + 1))
      txnAttempts++
    }).then(() => process.stdout.write('.'))
  )))

  console.log('\nValue is now', fromBuf(await db.get('val')), 'after', txnAttempts, 'commit attempts')
}

const rangeTest = async () => {
  await db.clearRangeStartsWith('x')
  await db.doTransaction(async tn => {
    for (let i = 0; i < 100; i++) {
      tn.set('x' + i, 'hi '+i)
    }
  })

  //   for await (const batch of tn.getRangeBatch('x', 'y')) {
  //     console.log(batch.length)
  //     // console.log(key.toString(), 'is', val)
  //   }
  // })

  // await db.doTransaction(async tn => {
  //   for await (const {key, value} of tn.getRange('x', 'y')) {
  //     console.log(key.toString(), 'is', value.toString())
  //   }
  // })

  console.log(await db.getRangeAll('x', 'y'))
}

rangeTest()