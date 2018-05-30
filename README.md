# FoundationDB NodeJS bindings

Node bindings for [FoundationDB](https://foundationdb.org)!

These bindings are currently in the process of being revived and renewed from some very old code. This library will not be entirely API-stable pre 1.0. Expect some slight API drift over the next few weeks before 1.0 lands.

- [Getting started](#usage)
- [Connecting to your database cluster](#connecting-to-your-cluster)
- [Database Transactions](#database-transactions)
- [Getting and setting values](#getting-and-setting-values)
- [Range reads](#range-reads)
- [Key selectors](#key-selectors)
- [Watches](#watches)


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
fdb.setAPIVersion(510) // Must be called before database is opened

const db = fdb.openSync('fdb.cluster') // or just openSync() if the database is local.
  .at('myapp.') // Use the 'myapp.' database prefix for all operations
  .withValueEncoding(fdb.encoders.json) // automatically encode & decode values using JSON

db.doTransaction(async tn => {
  console.log('key hi has value', await tn.get('hi'))
  tn.set('hi', [1, 2, 3, 'echidna'])
}) // returns a promise.
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

Databases can be scoped to work out of a prefix, with specified key & value encoders. [See scoping section below](#scoping--key--value-transformations) for more information.


## Configuration

> This is working, but documentation needs to be written. TODO.


## Database transactions

Transactions are the core unit of atomicity in FoundationDB.

You almost always want to create transactions via `db.doTransaction(async tn => {...})`. doTransaction takes a body function in which you interact with the database.

> `db.doTransaction` is aliased as `db.doTn`. Both forms are used interchangably in this document.

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
  const val = await tn.get('key')
  doWork(val) // doWork may be called multiple times!
})

```

To cut down on work, most simple operations have helper functions on the database object:

```javascript
const val = await db.get('key')

// .. Is a shorthand for:
const val = db.doTransaction(async tn => return await tn.get('key'))
```

The db helper functions always return a promise, wheras many of the transaction functions are syncronous (eg *set*, *clear*, etc).


## Getting and setting values

To **read** key/value pairs in a transaction, call `get`:

```javascript
const valueBytes = await db.doTransaction(async tn => {
  return await tn.get(mykey)
})
```

If you don't need a transaction you can call `get` on the database object directly:

```javascript
const valueBytes = await db.get(mykey)
```

`get(key: string | Buffer) => Promise<Buffer>` fetches the named key and returns the bytes via a Promise. If the key is specified via a string it will be encoded to bytes in UTF8.

To **store**, use `Transaction#set(key, value)` or `Database#set(key, value) => Promise`, eg:

```javascript
await db.doTransaction(async tn => {
  tn.set(mykey, value)
  // ...
})
```

or

```javascript
await db.set(mykey, value)
```

The transaction version is synchronous. All set operations are immediately visible to subsequent get operations inside the transaction, and visible to external users only after the transaction has been committed.

By default the key and value must be either node Buffer objects or strings. You can use [key and value transformers](#key-and-value-transformation) to make these functions accept and return whatever you want. If you want to embed numbers, UUIDs, or multiple fields in your keys we strongly recommend using the [tuple layer for encoding keys](https://apple.github.io/foundationdb/data-modeling.html#tuples):

```javascript
const fdb = require('fdb')

const db = fdb.openSync()
  .withKeyEncoding(fdb.encoders.tuple)
  .withValueEncoding(fdb.encoders.json)

await db.set(['class', 6], {teacher: 'fred', room: '101a'})

// ...

await db.get(['class', 6]) // returns {teacher: 'fred', room: '101a'}
```


## Range reads

There are several ways to read a range of values. Note that large transactions give poor performance in foundationdb, and are considered [an antipattern](https://apple.github.io/foundationdb/known-limitations.html#large-transactions). If your transaction reads more than 1MB of data or is held open for 5+ seconds, consider rethinking your design.

All range read functions also support key selectors and range options. These features are described below.

### Async iteration

The best way to iterate through a range is using an async iterator with **getRange(start, end, [opts])**:

```javascript
db.doTransaction(async tn => {
  for await (const [key, value] of tn.getRange('x', 'y')) {
    console.log(key, 'is', value)
  }
})
```

[Async iterators](https://github.com/tc39/proposal-async-iteration) are a new javascript feature. They are available in NodeJS 10+, Typescript or Babel, or node 8 and 9 with the `node --harmony-async-iteration` flag. Or you can [iterate through them manually](#manual-async-iteration).

*Danger 💣:* Remember that the body of the transaction may be executed multiple times. This can especially be a problem for range reads because they can easily overflow the transaction read limit (default 1M) or time limit (default 5s). Bulk operations need to be more complex than a loop in a transaction. [More information here](https://apple.github.io/foundationdb/known-limitations.html#large-transactions)

Internally `getRange` fetches the data over the network itself in batches, with a gradually increasing size.


Range reads work really well with tuple keys:

```javascript
const db = fdb.openSync().withKeyEncoding(fdb.encoders.tuple)

db.doTransaction(async tn => {
  for await (const [key, studentId] of tn.getRange(
    ['students', 'byrank', 0],
    ['students', 'byrank', 10]
  )) {
    const rank = key[2]
    console.log(rank + 1, ': ', studentId)
  }
})
```


### Manual async iteration

If `for await` isn't available for your platform, you can manually iterate through the iterator like this:

```javascript
db.doTransaction(async tn => {
  const iter = tn.getRange('x', 'y')
  while (true) {
    const item = await iter.next()
    if (item.done) break

    const [key, value] = item.value
    console.log(key, 'is', value)
  }
})
```

This is completely equivalent to the logic above. Its just more verbose.

### Batch iteration

You can process range results in batches for better nodejs performance:

```javascript
db.doTransaction(async tn => {
  for await (const batch of tn.getRangeBatch('x', 'y')) {
    for (let i = 0; i < batch.length; i++) {
      const [key, value] = batch[i]
      console.log(key, 'is', value)
    }
  }
})
```

This performs better because it doesn't thrash the event loop as much.


### Get an entire range to an array

If you're going to load the range into an array, you can do that directly:

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

The entire range is loaded in in a single network request using the `StreamingMode.WantAll` option, described below.


### Range Options

All range read functions take an optional `options` argument with the following properties:

- **limit** (*number*): If specified and non-zero, indicates the maximum number of key-value pairs to return. If you call `getRangeRaw` with a specified limit, and this limit was reached before the end of the specified range, `getRangeRaw` will specify `{more: true}` in the result. In other range read modes, the returned range (or range iterator) will stop after the specified limit.
- **reverse** (*boolean*): If specified, key-value pairs will be returned in reverse lexicographical order beginning at the end of the range.
- **targetBytes** (*number*): If specified and non-zero, this indicates a (soft) cap on the combined number of bytes of keys and values to return. If you call `getRangeRaw` with a specified limit, and this limit was reached before the end of the specified range, `getRangeRaw` will specify `{more: true}` in the result. Specifying targetBytes is currently not supported by other range read functions. Please file a ticket if support for this feature is important to you.
- **streamingMode**: This defines the policy for fetching data over the network. Options are:
	- `fdb.StreamingMode.`**WantAll**: Client intends to consume the entire range and would like it all transferred as early as possible. *This is the default for `getRangeAll`*
	- `fdb.StreamingMode.`**Iterator**: The client doesn't know how much of the range it is likely to used and wants different performance concerns to be balanced. Only a small portion of data is transferred to the client initially (in order to minimize costs if the client doesn't read the entire range), and as the caller iterates over more items in the range larger batches will be transferred in order to minimize latency. *This is the default mode for all range functions except getRangeAll.*
	- `fdb.StreamingMode.`**Exact**: Infrequently used. The client has passed a specific row limit and wants that many rows delivered in a single batch. Consider `WantAll` StreamingMode instead. A row limit must be specified if this mode is used.
	- `fdb.StreamingMode.`**Small**: Infrequently used. Transfer data in batches small enough to not be much more expensive than reading individual rows, to minimize cost if iteration stops early.
	- `fdb.StreamingMode.`**Medium**: Infrequently used. Transfer data in batches sized in between small and large.
	- `fdb.StreamingMode.`**Large**: Infrequently used. Transfer data in batches large enough to be, in a high-concurrency environment, nearly as efficient as possible. If the client stops iteration early, some disk and network bandwidth may be wasted. The batch size may still be too small to allow a single client to get high throughput from the database, so if that is what you need consider the SERIAL StreamingMode.
	- `fdb.StreamingMode.`**Serial**: Transfer data in batches large enough that an individual client can get reasonable read bandwidth from the database. If the client stops iteration early, considerable disk and network bandwidth may be wasted.

Example:

```javascript
// Get 10 key value pairs from 'z' backwards.
await db.getRange('a', 'z', {reverse: true, limit: 10})
```

## Key selectors

All range read functions and `getKey` let you specify keys using [key selectors](https://apple.github.io/foundationdb/developer-guide.html#key-selectors). Key selectors are created using methods in `fdb.keySelector`:

- `fdb.keySelector.`**lastLessThan(key)**
- `fdb.keySelector.`**lastLessOrEqual(key)**
- `fdb.keySelector.`**firstGreaterThan(key)**
- `fdb.keySelector.`**firstGreaterOrEqual(key)**

For example, to get a range not including the start but including the end:

```javascript
const ks = require('foundationdb').keySelector

// ...
tn.getRange(
  ks.firstGreaterThan(start),
  ks.firstGreaterThan(end)
)
```

> The naming is weird at the end of the range. Remember range queries are always non-inclusive of the end of their range. In the above example FDB will find the next key greater than `end`, then *not include this key in the results*.

You can add or subtract an offset from a key selector using `fdb.keySelector.add(sel, offset)`. This counts *in keys*. For example, to find the key thats exactly 10 keys from key `'a'`:

```javascript
const ks = require('foundationdb').keySelector

await db.getKey(ks.add(ks.firstGreaterOrEqual('a'), 10))
```

You can also specify raw key selectors using `fdb.keySelector(key: string | Buffer, orEqual: boolean, offset: number)`. See [FDB documentation](https://apple.github.io/foundationdb/developer-guide.html#key-selectors) on how these are interpreted.

Key selectors work with scoped types. This will fetch all students with ranks 1-10, inclusive:

```javascript
const db = fdb.openSync().withKeyEncoding(fdb.encoders.tuple)
const index = db.at(['index'])

const students = index.getRangeAll(
  ['students', 'byrank', 1], // Defaults to firstGreaterOrEqual(...).
  fdb.firstGreaterThan(['students', 'byrank', 10])
)
```

## Watches

Foundationdb lets you watch a key and get notified when the key changes. A watch will only fire once - if you want to find out every time a key is changed, you will need to re-issue the watch once it has fired.

You can read more about working with watches in the [FDB developer guide](https://apple.github.io/foundationdb/developer-guide.html#watches).

The simplest way to use watches is to call one of the helper functions on the database object:

```javascript
const watch = await db.doTn(async tn => {
  tn.set('foo', 'bar')
  return tn.watch('foo')
})

watch.promise.then(changed => {
  if (changed) console.log('foo changed')
  else console.log('Watch was cancelled')
})

setTimeout(() => {
  watch.cancel()
}, 1000)
```

Or directly from the database object:

```javacript
const watch = db.getAndWatch('somekey')
console.log('value is currently', watch.value)
watch.then(() => console.log('and now it has changed'))
```

Watch objects have two properties:

- **promise**: A promise which will resolve when the watch fires, errors, or is cancelled. If the watch fires the promise will resolve with a value of *true*. If the watch is cancelled by the user, or if the containing transaction is aborted or conflicts, the watch will resolve to *false*.
- **cancel()**: Function to cancel the watch. When you cancel a watch it will immediately resolve the watch, passing a value of *false* to your function.

The promise resolves to a value of *true* (the watch succeeded normally) or *false* in any of these cases:

- The promise was cancelled by the user
- The transaction which created the promise was aborted due to a conflict
- The transaction was manually cancelled via `tn.rawCancel`

*Warning:* Watches won't fire until their transaction is committed. This will deadlock your program:

```javascript
db.doTn(async tn => {
  const watch = tn.watch('foo')
  await watch.promise // DO NOT DO THIS - This will deadlock your program
})
```

*Danger 💣:* **DO NOT DO THIS!** If you attach a listener to the watch inside your transaction, your resolver may fire multiple times because the transaction itself may run multiple times.

```javascript
db.doTn(async tn => {
  tn.watch('foo').then(changed => {
    // DO NOT DO THIS!
    doWork() // Function may be called multiple times
  })
})
```

There are two workarounds:

1. Check the value of `changed`. It will be *false* when the watch was aborted due to a conflict.
2. *Recommended*: Return the watch from the transaction, and wait for it to resolve outside of the transaction body:

```javascript
const watch = await db.doTn(async tn => {
  return tn.watch('foo')
})

await watch.promise
```

If you want to watch multiple values, return them all:

```javascript
const [watchFoo, watchBar] = await db.doTn(async tn => {
  return [
    tn.watch('foo'),
    tn.watch('bar'),
  ]
})
```

### Watch helpers

The easiest way to use watches is via helper functions on the database object:

- `db.`**getAndWatch(key)**: Get a value and watch it for changes. Because `get` is called in the same transaction which created the watch, this is safe from race conditions. Returns a watch with a `value` property containing the key's value.
- `db.`**setAndWatch(key, value)**: Set a value and watch it for changes within the same transaction.
- `db.`**clearAndWatch(key)**: Clear a value and watch it for changes within the same transaction.

```javascript
const watch = db.setAndWatch('highscore', '1000')
await watch.promise
console.log('Your high score has been usurped!')
```


## Scoping & Key / Value transformations

All database and transaction objects have a scope, which is configured by:

- A *prefix*, prepended to the start of all keys
- A *key transformer*, which is a `pack` & `unpack` function pair for interacting with keys
- A *value transformer*, which is a `pack` & `unpack` function pair for interacting with values

The idea is that some areas of your database will contain different data, which may be encoded using different schemes. To facilitate this you can create a bunch of database objects with different configuration. The scope is transparent to the application once the database has been configured - it is automatically prepended to all keys supplied to the API, and automatically removed from all keys returned via the API.

Prefixes are called [subspaces](https://apple.github.io/foundationdb/developer-guide.html#subspaces) in other parts of the documentation & through other frontends.

### Prefixes

To add an application-specific prefix.

```javascript
// Prepend 'myapp' to all keys
const db = fdb.openSync('fdb.cluster').at('myapp.')

// ... Then use the database as normal
await db.set('hello', 'there') // Actually sets 'myapp.hello' to 'there'
await db.get('hello') // returns 'there', encoded as a buffer
```

They can be nested arbitrarily:

```javascript
const root = fdb.openSync('fdb.cluster')
const app = db.at('myapp.')
const books = app.at('books.') // Equivalent to root.at('myapp.books.')
```

But beware of long prefixes. The byte size of prefixes is paid in every API call, so you should keep prefixes short. If you want complex subdivisions, consider using [directories](https://apple.github.io/foundationdb/developer-guide.html#directories) instead. (Note: Directories are not yet implemented in this layer).


### Key and Value transformation

By default, the Node FoundationDB library accepts key and value input as either strings or Buffer objects, and always returns Buffers. But this is usually not what you actually want in your application.

You can configure a database to always automatically transform keys and values via an encoder. The following encoders are built into the library:

- `fdb.encoders.`**int32BE**: Integer encoding using big-endian 32 bit ints. (Big endian is preferred because it preserves lexical ordering)
- `fdb.encoders.`**string**: UTF-8 string encoding
- `fdb.encoders.`**buffer**: Buffer encoding. This doesn't actually do anything, but it can be handy to suppress typescript warnings when you're dealing with binary data.
- `fdb.encoders.`**json**: JSON encoding using the built-in JSON.stringify. This is not suitable for key encoding.
- `fdb.encoders.`**tuple**: Encode values using FDB [tuple encoding](https://apple.github.io/foundationdb/data-modeling.html#tuples). [Spec here](https://github.com/apple/foundationdb/blob/master/design/tuple.md).

**Beware** JSON encoding is generally unsuitable as a key encoding method:

- JSON objects have no guaranteed encoding order. Eg `{a:4, b:3}` could be encoded as `{"a":4,"b":3}` or `{"b":3,"a":4}`. When fetching a key, FDB does an equality check on the encoded value, so you might find your data is gone when you go to fetch it again later.
- When performing range queries, the lexographical ordering is undefined in innumerable ways. For example, `2` is lexographically after `10`.

These problems are fixed by using [FDB tuple encoding](https://apple.github.io/foundationdb/data-modeling.html#tuples). Tuple encoding is supported by all FDB frontends, it formally (and carefully) defines ordering for all objects and it supports transparent concatenation (tuple.pack(`['a']`) + tuple.pack(`['b']`) === tuple.pack(`['a', 'b']`)).

These problems only apply for key encoding. JSON is fine for encoding values, if a little space-inefficient.


Examples:

#### Using a key encoding:

```javascript
const db = fdb.openSync('fdb.cluster').withKeyEncoding(fdb.encoders.int32BE)

await db.set(123, 'hi')
await db.get(123) // returns 'hi' as a buffer
```


#### Or a value encoding:

```javascript
const db = fdb.openSync('fdb.cluster').withValueEncoding(fdb.encoders.json)

await db.set('hi', [1,2,3])
await db.get('hi') // returns [1,2,3]
```

#### Custom encodings

You can define your own custom encoding by supplying your own `pack` & `unpack` function pair:

```javascript
const msgpack = require('msgpack-lite')

const db = fdb.openSync('fdb.cluster').withValueEncoding({
  pack: msgpack.encode,
  unpack: msgpack.decode,
})

await db.set('hi', ['x', 1.2, Buffer.from([1,2,3])])
await db.get('hi') // returns ['x', 1.2, Buffer.from([1,2,3])]
```


#### Chained prefixes

If you prefix a database which has a key encoding set, the prefix will be transformed by the encoding. This allows you to use the API like this:

```javascript
const rootDb = fdb.openSync('fdb.cluster').withKeyEncoding(fdb.encoders.tuple).at(['myapp'])
const books = rootDb.at(['data', 'books']) // Equivalent to .at(['myapp', 'data', 'books'])
```


#### Multi-scoped transactions

To update objects in multiple scopes within the same transaction, use `tn.scopedTo(db)` to create an alias of the transaction in the foreign scope:

```javascript
const root = fdb.openSync('fdb.cluster').withKeyEncoding(fdb.encoders.tuple).at(['myapp'])
const data = root.at(['schools'])
const index = root.at(['index'])

data.doTransaction(async tn => {
  // Update the data object itself
  tn.set('UNSW', 'some data ...')

  // Update the index. This will use the prefix, key and value encoding of index defined above.
  tn.scopedTo(index)
  .set(['bycountry', 'australia', 'UNSW'], '... cached index data')
})
```

Aliased transactions inherit their `isSnapshot` property from the object they were created from, and the prefix and encoders from the database parameter. They support the complete transaction API, including ranges, watches, etc.


## Snapshot Reads

By default, FoundationDB transactions guarantee [serializable isolation](https://apple.github.io/foundationdb/developer-guide.html#acid), resulting in a state that is *as if* transactions were executed one at a time, even if they were executed concurrently. Serializability has little performance cost when there are few conflicts but can be expensive when there are many. FoundationDB therefore also permits individual reads within a transaction to be done as *snapshot reads*.

Snapshot reads differ from ordinary (serializable) reads by permitting the values they read to be modified by concurrent transactions, whereas serializable reads cause conflicts in that case. Like serializable reads, snapshot reads see the effects of prior writes in the same transaction. For more information on the use of snapshot reads, see [Snapshot reads](https://apple.github.io/foundationdb/developer-guide.html#snapshot-isolation) in the foundationdb documentation.

Snapshot reads are done using the same set of read functions, but executed against a *snapshot transaction* instead of a normal transaction object:

```javascript
const val = await db.doTransaction(async tn => {
  return await tn.snapshot().get(someKey)
})
```

or

```javascript
const val = await db.doTransaction(async tn => {
  const tns = tn.snapshot()
  return await tns.get(someKey)
})
```

Internally snapshot transaction objects are just shallow clones of the original transaction object, but with a flag set. They share the underlying FDB transaction with their originator. Inside a `doTransaction` block you can use the original transaction and snapshot transaction objects interchangeably as desired.


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

The API also entirely depends on node Promises. The C part of the bindings supports doing almost everything via callbacks but a callback-oriented API hasn't been written. If this is important to you for some reason, I think the best architecture would be to split out the native C backend into a `foundationdb-native` library and have an alternate callback-oriented frontend. Raise an issue if this is important to you. I'd be particularly interested in benchmarks showing how promise- or callback- oriented APIs perform.

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
- [x] Configure prebuilds so users don't need a local development environment to `npm install` this library
- [ ] Move to NAPI
- [ ] API documentation for options (and TS types for them)
- [ ] API documentation for all transaction methods (get, set, getKey, etc)
- [ ] Directory layer support
- [ ] Cut 1.0
- [ ] Figure out a decent way to bundle the native `libfdb_c` code so users don't need to download their own copy


## History

These bindings are based on an old version of FDB's bindings from years ago, with contributions form @skozin and others.

- The native binding code has been updated to work with modern versions of v8, and return promises in all cases if a callback is not provided.
- The javascript code has been almost entirely rewritten. It has been modernized, ported from JS to Typescript and changed to use promises throughout.

## License

This project is published under the MIT License. See the [LICENSE file](LICENSE) for details.
