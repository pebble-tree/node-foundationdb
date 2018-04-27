// Stuff that hasn't been ported over:

// const Transactional = require('./retryDecorator')
// const tuple = require('./tuple')
// const buffer = require('./bufferConversion')
// const locality = require('./locality')
// const directory = require('./directory')
// const Subspace = require('./subspace')

import apiVersion from './apiVersion'
import FDBError from './error'
import nativeMod, * as fdb from './native'
import Database from './database'
import keySelector, {KeySelector} from './keySelector'
import * as util from './util'
import {eachOption} from './opts'
import {NetworkOptions, DatabaseOptions, networkOptionData, StreamingMode} from './opts.g'
import * as tuple from './tuple'

let initCalled = false
const init = () => {
  if (initCalled) return
  initCalled = true

  nativeMod.apiVersion(apiVersion)
  nativeMod.startNetwork()

  process.on('exit', () => nativeMod.stopNetwork())
}

const wrapCluster = (cluster: fdb.NativeCluster) => ({
  async openDatabase(dbName: 'DB', opts?: DatabaseOptions) {
    const db = new Database(await cluster.openDatabase(dbName))
    if (opts) db.setNativeOptions(opts)
    return db
  },
  openDatabaseSync(dbName: 'DB', opts?: DatabaseOptions) {
    const db = new Database(cluster.openDatabaseSync(dbName))
    if (opts) db.setNativeOptions(opts)
    return db
  },
})

const createCluster = (clusterFile?: string) => {
  init()
  return nativeMod.createCluster(clusterFile).then(c => wrapCluster(c))
}
const createClusterSync = (clusterFile?: string) => {
  init()
  return wrapCluster(nativeMod.createClusterSync(clusterFile))
}

export = {
  apiVersion, // The fdb API version that this build is paired to
  FDBError,
  keySelector,
  StreamingMode,
  tuple,

  // transactional: Transactional,
  // locality,
  // directory,
  // DirectoryLayer,
  // Subspace,

  // This must be called before
  configNetwork(netOpts: NetworkOptions) {
    if (initCalled) throw Error('configNetwork must be called before FDB connections are opened')
    eachOption(networkOptionData, netOpts, (code, val) => nativeMod.setNetworkOption(code, val))
  },

  // Note if you need to you must configure your network before creating a cluster.
  createCluster,
  createClusterSync,

  // Returns a promise to a database.
  open(clusterFile?: string, dbOpts?: DatabaseOptions) {
    return createCluster(clusterFile).then(c => c.openDatabase('DB', dbOpts))
  },

  openSync(clusterFile?: string, dbOpts?: DatabaseOptions) {
    return createClusterSync(clusterFile).openDatabaseSync('DB', dbOpts)
  },

  // TODO: Should I expose a method here for stopping the network for clean shutdown?
  // I feel like I should.. but I'm not sure when its useful. Will the network thread
  // keep the process running?
}

// TODO: Figure out a way to export the library for both node
// require('foundationdb') and import from foundationdb.
