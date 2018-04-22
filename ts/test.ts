import fdb from './index'

process.on('unhandledRejection', err => { throw err })

const db = fdb.openSync()

for (let i = 0; i < 100; i++) {
  (async () => {
    await db.transact(async tn => {
      // console.log(await tn.getStr('hi'))
      await tn.get('hi')
      tn.set('hi', ''+Math.floor(Math.random() * 100))
      console.log(i)
    })
  })()
}