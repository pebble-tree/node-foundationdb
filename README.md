# FoundationDB NodeJS bindings

Node bindings for [FoundationDB](https://foundationdb.org)!

These bindings are currently in the process of being revived and renewed from some very old code. This library will not be entirely API-stable pre 1.0. Expect some slight API drift over the next few weeks before 1.0 lands.


## Usage

**You need to [download the FDB client library](https://www.foundationdb.org/download/) on your machine before you can use this node module**. This is also true on any machines you deploy to. I'm sorry about that. We've been [discussing it](https://forums.foundationdb.org/t/how-do-bindings-get-an-appropriate-copy-of-fdb-c/311/1).

#### Step 1

[Install foundationdb](https://www.foundationdb.org/download/). If you have a choice, you only need the client library.

#### Step 2

```
npm install --save foundationdb
```

#### Step 3

```javascript
const fdb = require('foundationdb')

fdb.setAPIVersion(510)
const db = fdb.openSync('fdb.cluster') // or just openSync() if the database is local.

db.doTransaction(async tn => {
  console.log('key hi has value', await tn.getStr('hi'))
  tn.set('hi', 'yo')
})
```

> Note: You must set the FDB API version before using this library. If in doubt, set to the version of FoundationDB you have installed.


# API

## Connecting to your cluster

FoundationDB servers and clients use a [cluster file](https://apple.github.io/foundationdb/api-general.html#cluster-file) (typically named `fdb.cluster`) to connect to a cluster.

The best way to connect to your foundationdb cluster is to just use:

```javascript
const fdb = require('foundationdb')
const db = fdb.openSync()
```

This will look for a cluster file in:

- The location specified by the `FDB_CLUSTER_FILE` environment variable
- The current working directory
- The [default file](https://apple.github.io/foundationdb/administration.html#default-cluster-file) location, which should *just work* for local development.

Alternately, manually specify a cluster file location:

```javascript
const fdb = require('foundationdb')
const db = fdb.openSync('fdb.cluster')
```

If you want you can instead use the async API:

```javascript
const fdb = require('foundationdb')

;(async () => {
  const db = await fdb.open()

  // ... Which is a shorthand for:
  //const cluster = await fdb.createCluster()
  //const db = await cluster.openDatabase('DB') // Database name must be 'DB'.
})()
```


## Configuration

> This is working, but documentation needs to be written. TODO.


## Database transactions

Transactions are the core unit of atomicity in FoundationDB.

You almost always want to create transactions via `db.doTransaction(async tn => {...})`. doTransaction takes a body function in which you do the work you want to do to the database.

The transaction will automatically be committed when the function's promise resolves. If the transaction had conflicts, it will be retried with exponential backoff.

`db.doTransaction` will pass your function's return value back to the caller.

Example:

```javascript
const val = await db.doTransaction(async tn => {
  const val = await tn.get('key1')
  tn.set('key2', 'val3')
  // ... etc.

  return val
})

doWork(val) // val is whatever your function returned above.
```

> **Note:** This function may be called multiple times in the case of conflicts.

*Danger 💣:* **DO NOT DO THIS!**:

```javascript
await db.doTransaction(async tn => {
  const val = await tn.get('key1')
  doWork(val) // doWork may be called multiple times!
})

```


## Getting and setting values

To read and write key/value pairs your application should call:

```javascript
const valueBytes = await tn.get(mykey)
```

If you don't need a transaction, you can call `get` on the database object directly:

```javascript
const valueBytes = await db.get(mykey)
```

`get(key: string | Buffer) => Promise<Buffer>` fetches the named key and returns the bytes via a Promise. If the key is specified via a string it will be encoded to bytes in UTF8.

To store data, use `Transaction#set(key: string | Buffer, value: string | Buffer)` or `Database#set(key: string | Buffer, value: string | Buffer) => Promise`, eg:

```javascript
tn.set(mykey, value)
```

or

```javascript
await db.set(mykey, value)
```

The transaction version is syncronous. All set operations are immediately visible to subsequent get operations inside the transaction, and visible to external users after the transaction has been committed.

If you want your key to embed numbers, UUIDs, or multiple fields we recommend using the [tuple layer](https://apple.github.io/foundationdb/data-modeling.html#tuples):

```javascript
const {tuple} = require('fdb')

// ...
await db.get(tuple.pack(['booksByAuthorPageCount', 'Pinker', 576.3]))
```

Unlike encoding fields using `JSON.stringify`, tuples maintain strict ordering constraints. This is useful for sorting data to make it easy to use range queries.


## Range reads

There are several ways to read a range of values. Note that [large transactions are an antipattern in foundationdb](https://apple.github.io/foundationdb/known-limitations.html#large-transactions). If you need to read more than 1MB of data or need to spend 5+ seconds iterating, you should [rethink your design](https://apple.github.io/foundationdb/known-limitations.html#long-transactions).


### Async iteration

In node 10+ or when compiling with Typescript or Babel, the best way to iterate through a range is using an [async iterator](https://github.com/tc39/proposal-async-iteration):

```javascript
db.doTransaction(async tn => {
  for await (const [key, value] of tn.getRange('x', 'y')) {
    console.log(key.toString(), 'is', value.toString())
  }
})
```

Async iterators are natively available in node 8 and 9 via the `node --harmony-async-iteration` flag.


### Manual async iteration

If `for await` isn't available yet, you can manually iterate through the iterator:

```javascript
db.doTransaction(async tn => {
  const iter = tn.getRange('x', 'y')
  while (true) {
    const item = await iter.next()
    if (item.done) break

    const [key, value] = item.value
    console.log(key.toString(), 'is', value.toString())
  }
})
```


### Batch iteration

If you want to process the results in batches, you can bulk iterate through the range. This has slightly better performance because it doesn't need to generate an iterator callback and promise for each key/value pair:

```javascript
db.doTransaction(async tn => {
  for await (const batch of tn.getRangeBatch('x', 'y')) {
    for (let i = 0; i < batch.length; i++) {
      const [key, value] = batch[i]
      console.log(key.toString(), 'is', value.toString())
    }
  }
})
```


### Get an entire range to an array

If you're going to load the range into an array anyway, its faster to bulk load the range into an array using:

```javascript
await db.getRangeAll('x', 'y')
```

or as part of a snapshot:

```javascript
db.doTransaction(async tn => {
  // ...
  await tn.getRangeAll('x', 'y')
}
```

This will load the entire range in a single network request, and its a simpler API to work with if you need to do bulk operations.


### Key selectors

All range read functions support ranges to be specified using [selectors](https://apple.github.io/foundationdb/developer-guide.html#key-selectors) instead of simple keys. For example, to get a range not including the start but including the end:

```javascript
tn.getRange(
  fdb.keySelector.firstGreater(start),
  fdb.keySelector.firstGreaterThan(end)
)
```

(Note you need to specify `keySelector.firstGreaterThan` and not simply `keySelector.lastLessOrEqual` because getRange is exclusive of the endpoint).

## Notes on API versions

Since the very first release, FoundationDB has kept full backwards compatibility for clients behind an explicit call to `setAPIVersion`. In effect, client applications select the API semantics they expect to use and then the operations team should be able to deploy any version of the database software, so long as its not older than the specified version.

From the point of view of a nodejs fdb client application, there are effectively two APIs you consume:

- The operation semantics of FoundationDB proper
- The API exposed by these javascript bindings

In this library we could tie both sets of versions together behind the semver version number of this library. Then with every new release of FoundationDB we would increment the major version number in npm. Unfortunately, new API versions depend on new versions of the database itself. Tying the latest version of `node-foundationdb` to the latest version of the FDB API would require users to either:

- Always deploy the latest version of FDB, or
- Stick to an older version of this library, which may be missing useful features and bug fixes.

Both of these options would be annoying.

So to deal with this, you need to manage both API versions:

- This package is versioned normally via package.json.
- The API version of foundationdb is managed via a call at startup to `fdb.setAPIVersion`.

You should be free to upgrade this library and your foundationdb database independantly. However, this library will only maintain support for FDB versions within a recent range. This is simply a constraint of development time & testing.

---

While all of your code should continue to work with new versions of the foundationdb database, to connect you will need a copy of the `fdb_c.s` / `fdb_c.dylib` / `fdb_c.dll` dynamic library file which matches version of the database that you are connecting to. Doing zero-downtime deployments of new versions of the foundationdb database is possible, but a little subtle. You need to:

1. Deploy your client application with both old and new copies of the `fdb_c` dynamic library file. You can point your application a directory containing copies of all versions of `fdb_c` that you want it to support connecting with via the `EXTERNAL_CLIENT_DIRECTORY` environment variable or the `external_client_directory` network option. When the client connects to your database it will try all versions of the fdb library found in this directory. [Read more here](https://apple.github.io/foundationdb/api-general.html#multi-version-client)
2. Upgrade your foundationdb database instance. The client should reconnect using the new library version.
3. Periodically remove old, unused copies of the `fdb_c` client library from your frontend machines as they may degrade performance.

Please consult [the foundationdb forum](https://forums.foundationdb.org/c/using-foundationdb) for help and more information.

## Caveats

The bindings do not currently support the `Directory` layer. We have code, it just hasn't been ported to the new typescript API. If someone wants to take a stab at it, raise an issue so we don't repeat work.

The API also entirely depends on node Promises. The C part of the bindings supports doing everything via callbacks but a callback-oriented API hasn't been written. If this is important to you for some reason, please raise an issue and we can discuss approaches.

## Revival progress

- [x] Get it building on modern node / v8
- [x] Make all transaction primitives support promises
- [x] Native code works
- [x] Core rewritten in TS
- [x] Primitive transactions working from node
- [x] Transaction retry loop working
- [x] Basic read range support
- [x] Read range callback iterator support
- [x] Read range async iterator
- [x] Test on linux (& fix any issues that arise)
- [x] Test on windows (& fix any issues that arise)
- [x] Tuple support
- [x] Add testing harness
- [x] Port basic tests
- [x] Testing integrated with the harness for the other bindings
- [x] Subspace support
- [ ] Move to NAPI
- [ ] Configure prebuilds so users don't need a local development environment to `npm install` this library
- [ ] API documentation for options (and TS types for them)
- [ ] API documentation for all transaction methods (get, set, getKey, etc)
- [ ] Directory layer support
- [ ] Cut 1.0
- [ ] Figure out a decent way to bundle the native `libfdb_c` code so users don't need to download their own copy
- [ ] Add leveldown compatibilty (?)


## History

These bindings are currently based on an old version of FDB's bindings from years ago. The plan is to resurrect them over the next few weeks and get them production ready.

Patches welcome!
