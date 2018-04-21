/*
 * FoundationDB Node.js API
 * Copyright (c) 2012 FoundationDB, LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

"use strict";

const KeySelector = require('./keySelector')
const Cluster = require('./cluster')
// const future = require('./future')
const Transactional = require('./retryDecorator')
const tuple = require('./tuple')
// const buffer = require('./bufferConversion')
const fdb = require('./fdbModule')
const FDBError = require('./error')
const locality = require('./locality')
const directory = require('./directory')
const Subspace = require('./subspace')
const apiVersion = require('./apiVersion')
const {eachOption} = require('./fdbUtil')

const fdbModule = {}

// The API version is static to the module, so we'll hold it here.
fdb.apiVersion(apiVersion)

let initCalled = false
const init = () => {
  if (initCalled) return
  initCalled = true

  fdb.startNetwork()

  process.on('exit', function() {
    //Clearing out the caches makes memory debugging a little easier
    // dbCache = null
    // clusterCache = null

    fdb.stopNetwork()
  })
}

const createCluster = (clusterFile) => {
  init()

  return new Cluster(fdb.createCluster(clusterFile))
}

module.exports = {
  FDBError,
  KeySelector,
  // skipping future
  transactional: Transactional,
  tuple,
  // buffer,
  locality,
  directory,
  DirectoryLayer,
  Subspace,
  streamingMode,

  // This must be called before
  configNetwork(netOpts) {
    if (initCalled) throw Error('configNetwork must be called before any FDB connections are opened')
    fdbUtil.eachOption('NetworkOption', opts, (code, val) => fdb.setNetworkOption(code, val))
  },

  // Note if you need to you must configure your network before creating a cluster.
  createCluster,

  open(clusterFile, dbOpts) {
    // TODO: Caching disabled for now. Is this the right call? I think so.
    // You should structure your app so it doesn't need to depend on a cache here.
    const cluster = createCluster(clusterFile)
    return cluster.openDatabase(dbOpts)
  },

  // TODO: Should I expose a method here for stopping the network for clean shutdown?
  // I feel like I should.. but I'm not sure when its useful. Will the network thread
  // keep the process running?
}
