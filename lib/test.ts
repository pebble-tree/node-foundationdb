// This isn't part of the distribution. Its just some manual tests to exercise
// functionality locally.
// 
// This file should be removed for 1.0

import * as fdb from './index'
// import fdb = require('./index')
import * as ks from './keySelector'
import {StreamingMode} from './opts.g'

process.on('unhandledRejection', err => { throw err })

fdb.setAPIVersion(500)
const db = fdb.openSync()

const asBuf = (val: Buffer | string): Buffer => (
  typeof val === 'string' ? Buffer.from(val, 'utf8') : val
)
const fromBuf = (b: string | Buffer | null) => b == null ? 0 : asBuf(b).readInt32LE(0)
const toBuf = (n: number) => {
  const b = Buffer.alloc(4)
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

const batchToStr = (batch: [string | Buffer, string | Buffer][]) => batch.map(([k,v]) => [k.toString(), v.toString()])

const rangeTest = async () => {
  await db.clearRangeStartsWith('x')
  await db.doTransaction(async tn => {
    for (let i = 0; i < 100; i++) {
      tn.set('x' + i, 'hi '+i)
    }

    tn.set('z', 'zzzval')
  })

  //   for await (const batch of tn.getRangeBatch('x', 'y')) {
  //     console.log(batch.length)
  //     // console.log(key.toString(), 'is', val)
  //   }
  // })

  // await db.doTransaction(async tn => {
  //   for await (const [key, value] of tn.getRange('x', 'y')) {
  //     console.log(key.toString(), 'is', value.toString())
  //   }
  // })

  console.log(await db.getRangeAll('z', 'zz'))

  // console.log(await db.getRangeAll('x', 'y'))
}

const rangeTest2 = async () => {
  await db.doTransaction(async tn => {
    tn.set('a', 'A')
    tn.set('b', 'B')
    tn.set('c', 'C')
  })

  console.log(batchToStr(await db.getRangeAll('a', 'c'))) // 'a', 'b'.
  console.log(batchToStr(await db.getRangeAll(fdb.keySelector.firstGreaterThan('a'), 'c'))) // 'b'
  console.log(batchToStr(await db.getRangeAll(
    fdb.keySelector.firstGreaterThan('a'),
    fdb.keySelector.firstGreaterThan('c')
  ))) // 'b'
}

const rangeTest3 = async () => {
  // await db.doTransaction(async tn => {
  //   await tn.getRangeRaw(fdb.keySelector.from('a'), fdb.keySelector.from('b'), 0, 0, StreamingMode.Exact, 0, false)
  // })
  await db.getRangeAll('a', 'b', {
    limit: 0,
    streamingMode: StreamingMode.Exact
  })
}

const opts = async () => {
  await db.doTransaction(async tn => {
    tn.set('xyz', 'hidsffds')
    console.log(await tn.get('xyz'))
  }, {read_your_writes_disable:true})
}

const versions = async () => {
  // await db.doTransaction(async tn => {
  //   await tn.get('x')
  //   console.log(await tn.getReadVersion())
  // })

  const tn = db.rawCreateTransaction()
  // tn.set('x', 'y')
  tn.setVersionstampPrefixedValue('x', Buffer.from([1,2,3]))
  // await tn.rawCommit()
  // console.log(await tn.getCommittedVersion())
  const vstn = tn.getVersionStamp()
  await tn.rawCommit()
  console.log(await vstn)
  // setTimeout(() => {}, 1000)
}

const versions2 = async () => {
  const stamp = await db.doTransaction(async tn => {
    tn.setVersionstampPrefixedValue('x', Buffer.from([1,2,3]))
    return tn.getVersionStamp()
  })

  console.log(await stamp[0])
  
  console.log(await db.get('x'))
}

const crash = async () => {
  const tn1 = db.rawCreateTransaction()
  tn1.addReadConflictKey('conflict')
  tn1.addWriteConflictKey('conflict')

  const watch = tn1.watch('x')
  watch.promise.then(
    v => console.log('listener called', v), 
    err => console.error('listener err', err)
  )

  const tn2 = db.rawCreateTransaction()
  tn2.addWriteConflictKey('conflict')
  await tn2.rawCommit()

  await tn1.rawCommit().catch(e => {})

  watch.cancel()
}

// const c2 = async () => {
//   const tn1 = db.rawCreateTransaction()
//   tn1.addReadConflictKey('conflict')
//   tn1.addWriteConflictKey('conflict')

//   const watch = tn1.watch('x')
//   watch.listener.then(
//     v => console.log('listener called', v), 
//     err => console.error('listener err', err)
//   )
//   await tn1.rawCommit().catch(e => {})
//   watch.cancel()
//   watch.cancel()
// }

// conflictWrites()
// rangeTest3()
// opts()
// versions2()
crash()
// c2()