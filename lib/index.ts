// Stuff that hasn't been ported over:

// const Transactional = require('./retryDecorator')
// const locality = require('./locality')
// const directory = require('./directory')

import nativeMod, * as fdb from './native'
import Database, {createDatabase} from './database'
import {eachOption} from './opts'
import {NetworkOptions, networkOptionData, DatabaseOptions} from './opts.g'
import {Transformer} from './transformer'

import * as apiVersion from './apiVersion'

// Must be called before fdb is initialized. Eg setAPIVersion(510).
export {set as setAPIVersion} from './apiVersion'

let initCalled = false

// This is called implicitly when the first cluster / db is opened.
const init = () => {
  if (apiVersion.get() == null) {
    throw Error('You must specify an API version to connect to FoundationDB. Eg: fdb.setAPIVersion(510);')
  }

  if (initCalled) return
  initCalled = true

  nativeMod.startNetwork()

  process.on('exit', () => nativeMod.stopNetwork())
}


export {default as FDBError} from './error'
export {default as keySelector, KeySelector} from './keySelector'

// These are exported to give consumers access to the type. Databases must
// always be constructed using open or via a cluster object.
export {default as Database} from './database'
export {default as Transaction} from './transaction'

export {
  NetworkOptions,
  NetworkOptionCode,
  DatabaseOptions,
  DatabaseOptionCode,
  TransactionOptions,
  TransactionOptionCode,
  StreamingMode,
  MutationType,
  ConflictRangeType,
  ErrorPredicate,
} from './opts.g'

import {strInc} from './util'
export const util = {strInc}

// TODO: Remove tuple from the root API. Tuples should be in a separate module.
import * as tuple from './tuple'
import {TupleItem} from './tuple'
// import * as tuple from './tuple'

export {TupleItem, tuple}


const id = (x: any) => x
export const encoders = {
  int32BE: {
    pack(num) {
      const b = Buffer.alloc(4)
      b.writeInt32BE(num, 0)
      return b
    },
    unpack(buf) { return buf.readInt32BE(0) }
  } as Transformer<number, number>,

  json: {
    pack(obj) { return JSON.stringify(obj) },
    unpack(buf) { return JSON.parse(buf.toString('utf8')) }
  } as Transformer<any, any>,

  string: {
    pack(str) { return Buffer.from(str, 'utf8') },
    unpack(buf) { return buf.toString('utf8') }
  } as Transformer<string, string>,

  buf: {
    pack: id,
    unpack: id
  } as Transformer<Buffer, Buffer>,

  // TODO: Move this into a separate library
  tuple: tuple as Transformer<TupleItem[], TupleItem[]>,
}

const wrapCluster = (cluster: fdb.NativeCluster) => ({
  async openDatabase(dbName: 'DB', opts?: DatabaseOptions) {
    const db = createDatabase(await cluster.openDatabase(dbName))
    if (opts) db.setNativeOptions(opts)
    return db
  },
  openDatabaseSync(dbName: 'DB', opts?: DatabaseOptions) {
    const db = createDatabase(cluster.openDatabaseSync(dbName))
    if (opts) db.setNativeOptions(opts)
    return db
  },
})

export const createCluster = (clusterFile?: string) => {
  init()
  return nativeMod.createCluster(clusterFile).then(c => wrapCluster(c))
}
export const createClusterSync = (clusterFile?: string) => {
  init()
  return wrapCluster(nativeMod.createClusterSync(clusterFile))
}

// Can only be called before open() or openSync().
export function configNetwork(netOpts: NetworkOptions) {
  if (initCalled) throw Error('configNetwork must be called before FDB connections are opened')
  eachOption(networkOptionData, netOpts, (code, val) => nativeMod.setNetworkOption(code, val))
}

// Returns a promise to a database.
// Note any network configuration must preceed this call.
export function open(clusterFile?: string, dbOpts?: DatabaseOptions) {
  return createCluster(clusterFile).then(c => c.openDatabase('DB', dbOpts))
}

export function openSync(clusterFile?: string, dbOpts?: DatabaseOptions) {
  return createClusterSync(clusterFile).openDatabaseSync('DB', dbOpts)
}

// TODO: Should I expose a method here for stopping the network for clean shutdown?
// I feel like I should.. but I'm not sure when its useful. Will the network thread
// keep the process running?