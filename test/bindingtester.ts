#!/usr/bin/env node

// This file implements the foundationdb binding API tester fuzzer backend
// described here:
// 
// https://github.com/apple/foundationdb/blob/master/bindings/bindingtester/spec/bindingApiTester.md

import fdb = require('../lib')
import assert = require('assert')

import Database from '../lib/database'
import Transaction from '../lib/transaction'

import {TupleItem} from '../lib/tuple'
import * as util from '../lib/util'
import {StreamingMode, TransactionOption, MutationType} from '../lib/opts.g'
import nodeUtil = require('util')

const {keySelector, tuple} = fdb

// The string keys are all buffers, encoded as hex.
// This is shared between all threads.
const transactions: {[k: string]: Transaction} = {}

const toUpperCamelCase = (str: string) => str.replace(/(^\w|_\w)/g, c =>
  c.length == 1 ? c.toUpperCase() : c[1].toUpperCase()
)

const makeMachine = (db: Database, initialName: Buffer) => {
  type StackItem = {instrId: number, data: any}
  const stack: StackItem[] = []
  let tnName = initialName
  let instrId = 0
  let lastVersion: Buffer = Buffer.alloc(8) // null / empty last version.

  const tnNameKey = () => tnName.toString('hex')

  const popValue = () => {
    assert(stack.length, 'popValue when stack is empty')
    const item = stack.pop()!
    return item.data
  }
  const chk = async <T>(pred: (item: any) => boolean, typeLabel: string): Promise<T> => {
    let val = await popValue()
    if (val == null) val = 'RESULT_NOT_PRESENT'
    assert(pred(val), `Value does not match (${nodeUtil.inspect(val)}) is not a ${typeLabel}`)
    return val as T
  }
  const popStr = () => chk<string>(val => typeof val === 'string', 'string')
  const popBool = () => chk<boolean>(val => val === 0 || val === 1, 'bool').then(x => !!x)
  const popInt = () => chk<number>(Number.isInteger, 'int')
  const popBuffer = () => chk<Buffer>(Buffer.isBuffer, 'buf')
  const popStrBuf = () => chk<string | Buffer>(val => typeof val === 'string' || Buffer.isBuffer(val), 'buf|str')
  const popSelector = async () => {
    const key = await popBuffer()
    const orEqual = await popBool()
    const offset = await popInt()
    return keySelector(key, orEqual, offset)
  }
  const popNValues = async () => {
    const n = await popInt()
    const result = []
    for (let i = 0; i < n; i++) result.push(await popValue())
    return result
  }

  const pushValue = (data: any) => {
    stack.push({instrId, data})
  }
  const maybePush = (data: Promise<void> | void) => {
    if (data) pushValue(data)
  }

  const orNone = (val: Buffer | null) => val == null ? 'RESULT_NOT_PRESENT' : val
  const bufBeginsWith = (buf: Buffer, prefix: Buffer) => (
    prefix.length <= buf.length && buf.compare(prefix, 0, prefix.length, 0, prefix.length) === 0
  )

  const operations: {[op: string]: (operand: Database | Transaction, ...args: TupleItem[]) => any} = {
    // Stack operations
    push(_, data: any) { pushValue(data) },
    pop() { stack.pop() },
    dup() { stack.push(stack[stack.length-1]) },
    empty_stack() { stack.length = 0 },
    async swap() {
      // TODO: Should this wait for the promises in question to resolve?
      const depth = await popInt()
      assert(depth < stack.length)
      const a = stack[stack.length - depth - 1]
      const b = stack[stack.length - 1]

      stack[stack.length - depth - 1] = b
      stack[stack.length - 1] = a
    },
    async sub() {
      const a: number = await popInt()
      const b: number = await popInt()
      assert(typeof a === 'number' && typeof b === 'number')
      pushValue(a - b)
    },
    async concat() {
      const a = await popValue() // both strings or both bytes.
      const b = await popValue()
      assert(typeof a === typeof b)
      if (typeof a === 'string') pushValue(a + b)
      else pushValue(Buffer.concat([a, b]))
    },
    async log_stack() {
      const prefix = await popBuffer()
      let i = 0
      while (i < stack.length) {
        await db.doTransaction(async tn => {
          for (let k = 0; k < 100 && i < stack.length; k++) {
            const {instrId, data} = stack[i]
            let packedData = fdb.tuple.pack(await data)
            if (packedData.length > 40000) packedData = packedData.slice(0, 40000)

            tn.set(Buffer.concat([prefix, fdb.tuple.pack([i, instrId])]), packedData)
            i++
          }
        })
      }
    },

    // Transactions
    new_transaction() {
      transactions[tnNameKey()] = db.rawCreateTransaction()
    },
    async use_transaction() {
      tnName = await popValue() // I think these are bytes? ???
      console.log('using tn', tnName)
      if (transactions[tnNameKey()] == null) transactions[tnNameKey()] = db.rawCreateTransaction()
    },
    async on_error(tn) {
      const code = await popInt()
      pushValue((<Transaction>tn).rawOnError(code))
    },

    // Transaction read functions
    async get(oper) {
      const key = await popBuffer()
      pushValue(oper.get(key).then(orNone))
    },
    async get_key(oper) {
      const keySel = await popSelector()
      const prefix = await popBuffer()

      const result = await oper.getKey(keySel)
      // result starts with prefix.
      const cmp = result!.compare(prefix, 0, prefix.length, 0, result!.length)
      if (cmp === 0) pushValue(result)
      else if (cmp > 0) pushValue(prefix) // RESULT < PREFIX
      else pushValue(util.strInc(prefix)) // RESULT > PREFIX
    },
    async get_range(oper) {
      const beginKey = await popBuffer()
      const endKey = await popBuffer()
      const limit = await popInt()
      const reverse = await popBool()
      const streamingMode = await popInt() as StreamingMode
      const results = await oper.getRangeAll(
        keySelector.from(beginKey), keySelector.from(endKey),
        {streamingMode, limit, reverse}
      )
      // const results = await oper.getRangeRaw(keySelector.from(beginKey), keySelector.from(endKey),
      //   limit, 0, streamingMode, 0, reverse)

      // Flatten [[k,v], [k,v], ...] results into [k,v,k,v,...].
      // pushValue(Array.prototype.concat.apply([], results.results))
      pushValue(tuple.pack(Array.prototype.concat.apply([], results)))
    },
    async get_range_starts_with(oper) {
      const prefix = await popBuffer()
      const limit = await popInt()
      const reverse = await popBool()
      const streamingMode = await popInt() as StreamingMode
      const results = await oper.getRangeAllStartsWith(prefix, {streamingMode, limit, reverse})
      pushValue(tuple.pack(Array.prototype.concat.apply([], results)))
    },
    async get_range_selector(oper) {
      const beginSel = await popSelector()
      const endSel = await popSelector()
      const limit = await popInt()
      const reverse = await popBool()
      const streamingMode = await popInt() as StreamingMode
      const prefix = await popBuffer()

      const results = (await oper.getRangeAll(beginSel, endSel, {streamingMode, limit, reverse}))
        .filter(([k]) => bufBeginsWith(k, prefix))

      pushValue(tuple.pack(Array.prototype.concat.apply([], results)))
    },
    async get_read_version(oper) {
      lastVersion = await (<Transaction>oper).getReadVersion()
      pushValue("GOT_READ_VERSION")
    },
    async get_versionstamp(oper) {
      pushValue(await (<Transaction>oper).getVersionStamp())
    },

    // Transaction set operations
    async set(oper) {
      maybePush(oper.set(await popStrBuf(), await popStrBuf()))
    },
    set_read_version(oper) {
      (<Transaction>oper).setReadVersion(lastVersion)
    },
    async clear(oper) {
      maybePush(oper.clear(await popStrBuf()))
    },
    async clear_range(oper) {
      maybePush(oper.clearRange(await popStrBuf(), await popStrBuf()))
    },
    async clear_range_starts_with(oper) {
      maybePush(oper.clearRangeStartsWith(await popStrBuf()))
    },
    async atomic_op(oper) {
      const codeStr = toUpperCamelCase(await popStr()) as keyof typeof MutationType
      const code: MutationType = MutationType[codeStr]
      maybePush(oper.atomicOp(code, await popStrBuf(), await popStrBuf()))
    },
    async read_conflict_range(oper) {
      (<Transaction>oper).addReadConflictRange(await popStrBuf(), await popStrBuf())
      pushValue("SET_CONFLICT_RANGE")
    },
    async write_conflict_range(oper) {
      (<Transaction>oper).addWriteConflictRange(await popStrBuf(), await popStrBuf())
      pushValue("SET_CONFLICT_RANGE")
    },
    async read_conflict_key(oper) {
      (<Transaction>oper).addReadConflictKey(await popStrBuf())
      pushValue("SET_CONFLICT_KEY")
    },
    async write_conflict_key(oper) {
      (<Transaction>oper).addWriteConflictKey(await popStrBuf())
      pushValue("SET_CONFLICT_KEY")
    },
    disable_write_conflict(oper) {
      (<Transaction>oper).setOption(TransactionOption.NextWriteNoWriteConflictRange)
    },

    commit(oper) {pushValue((<Transaction>oper).rawCommit())},
    reset(oper) {(<Transaction>oper).rawReset()},
    cancel(oper) {(<Transaction>oper).rawCancel()},

    get_committed_version(oper) {
      lastVersion = (<Transaction>oper).getCommittedVersion()
      pushValue('GOT_COMMITTED_VERSION')
    },
    async wait_future() {
      pushValue(await popValue())
    },


    // Tuple operations
    async tuple_pack() {
      pushValue(tuple.pack(await popNValues()))
    },
    async tuple_pack_with_versionstamp() {
      throw Error('Not implemented')
      // const prefix = await popBuffer()

    },
    async tuple_unpack() {
      const packed = await popBuffer()
      for (const item of tuple.unpack(packed, true)) {
        pushValue(tuple.pack([item]))
      }
    },
    async tuple_range() {
      const {begin, end} = tuple.range(await popNValues())
      pushValue(begin)
      pushValue(end)
    },
    async tuple_sort() {
      throw Error('not implemented')
      // const items = await popNValues()
      // items.forEach(buf => assert(Buffer.isBuffer(buf)))
      // items.map(buf => tuple.unpack(buf as Buffer))
    },
    async encode_float() {
      const val = await popBuffer()
      pushValue({type: 'singlefloat', value: val.readFloatBE(0)})
    },
    async encode_double() {
      pushValue((await popBuffer()).readDoubleBE(0))
    },
    async decode_float() {
      const val = await popValue()
      assert(typeof val === 'object' && val.type === 'singlefloat')
      const buf = Buffer.alloc(4)
      pushValue(buf.writeFloatBE(val.value as number, 0))
    },
    async decode_double() {
      const val = await popValue()
      assert(typeof val === 'number')
      const buf = Buffer.alloc(8)
      pushValue(buf.writeDoubleBE(val, 0))
    },

    // Thread Operations
    async start_thread() {
      // Note we don't wait here - this is run concurrently.
      const prefix = await popBuffer()
      runFromPrefix(db, prefix)
      .catch(e => {
        console.error('Error running in prefix ' + prefix.toString())
        throw e
      })
    },
    async wait_empty() {
      const prefix = await popBuffer()
      await db.doTransaction(async tn => {
        const nextKey = await tn.getKey(keySelector.firstGreaterOrEqual(prefix))
        if (nextKey && bufBeginsWith(nextKey, prefix)) {
          throw new fdb.FDBError('wait_empty', 1020)
        }
      })
      pushValue('WAITED_FOR_EMPTY')
    },
  }

  return {
    async run(instruction: TupleItem[]) {
      let [opcode, ...oper] = instruction as [string, TupleItem[]]
      try {
        let operand: Transaction | Database = transactions[tnNameKey()]
        if (opcode.endsWith('_SNAPSHOT')) {
          opcode = opcode.slice(0, -'_SNAPSHOT'.length)
          operand = (operand as Transaction).snapshot()
        } else if (opcode.endsWith('_DATABASE')) {
          opcode = opcode.slice(0, -'_DATABASE'.length)
          operand = db
        }

        await operations[opcode.toLowerCase()](operand, ...oper)
      } catch (e) {
        if (e instanceof fdb.FDBError) {
          console.log('got fdb error', e)
          pushValue(fdb.tuple.pack(['ERROR', e.code]))
        } else throw e
      }
      instrId++

      console.log('STATE', instrId, tnName.toString('ascii'))
      console.log(`stack length ${stack.length}:`)
      console.log('  Stack top:', stack[stack.length-1])
      console.log('  stack t-1:', stack[stack.length-2])
    }
  }
}

async function runFromPrefix(db: Database, prefix: Buffer) {
  const machine = makeMachine(db, prefix)

  const {begin, end} = fdb.tuple.range([prefix])
  const instructions = await db.getRangeAll(begin, end)
  console.log(`Executing ${instructions.length} instructions`)
  for (const [key, value] of instructions) {
    const instruction = fdb.tuple.unpack(value)
    console.log(instruction)
    await machine.run(instruction)
  }
}

if (require.main === module) {
  process.on('unhandledRejection', err => { throw err.stack })

  const prefixStr = process.argv[2]
  const requestedAPIVersion = +process.argv[3]
  const clusterFile = process.argv[4]

  // This library only works with a single fdb API version.
  assert.strictEqual(requestedAPIVersion, fdb.apiVersion,
    `Only API version ${fdb.apiVersion} supported. Run with --api-version ${fdb.apiVersion}`
  )

  const db = fdb.openSync(clusterFile)

  runFromPrefix(db, Buffer.from(prefixStr, 'ascii'))
}