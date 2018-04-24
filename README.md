# FoundationDB NodeJS bindings

These bindings are currently in the process of being revived and renewed from some very old code.

This is not yet production ready. The APIs will drift slightly over the next few weeks. But please give it a try and file issues against anything that isn't working yet.

## Usage

**You need to have the FDB client library on your machine before you can use this node module**. This is also true on any machines you deploy to. I'm sorry about that. We've been [discussing it](https://github.com/apple/foundationdb/issues/129).

#### Step 1

[Install foundationdb](https://www.foundationdb.org/download/). At a minimum you need the client library + C bindings.

#### Step 2

```
npm install --save foundationdb
```

#### Step 3

```javascript
const fdb = require('foundationdb')

const db = fdb.openSync('fdb.cluster') // or just openSync() if the database is local.

db.doTransaction(async tn => {
  console.log('key hi has value', await tn.getStr('hi'))
  tn.set('hi', 'yo')
})
```

# API

## Connecting to your cluster

FoundationDB servers and clients use a [cluster file](https://apple.github.io/foundationdb/api-general.html#cluster-file) (typically named `fdb.cluster`) to connect to a cluster.

The easiest way to connect to your foundationdb cluster is:

```javascript
const fdb = require('foundationdb')

const db = fdb.openSync()
```

This will look for a cluster file in the location specified by the `FDB_CLUSTER_FILE` environment variable, then the current working directory, then the [default file](https://apple.github.io/foundationdb/administration.html#default-cluster-file). You can also manually specify a cluster file location:

```javascript
const fdb = require('foundationdb')
const db = fdb.openSync('fdb.cluster')
```

Alternately, you can use the async API:

```javascript
const fdb = require('foundationdb')

(async () => {
  const cluster = await fdb.createCluster()
  const db = await cluster.openDatabase('DB')
})()
```

## Configuration

> This is working, but documentation needs to be written. TODO.


## Database transactions

Transactions are the core unit of atomicity in FoundationDB.

You almost always want to create transactions via `db.doTransaction(async tn => {...})`. doTransaction takes a body function in which you do the work you want to do to the database.

The transaction will automatically be committed when the function's promise resolves. If the transaction had conflicts, it will be retried with exponential backoff.

> **Note:** This function may be called multiple times in the case of conflicts.

db.doTransaction will return whatever your promise returned when the transaction succeeded.

Example:

```javascript
const result = await db.doTransaction(async tn => {
  const val = await tn.get('key1')
  tn.set('key2', 'val3')
  // ... etc.

  return val
})

doWork(result)
```

*Danger:* **DO NOT DO THIS**:

```javascript
await db.doTransaction(async tn => {
  const val = await tn.get('key1')
  doWork(val) // ! DANGER ! - doWork may be called multiple times
})

```

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

```
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

## Caveats

The bindings currently support standard KV operations.

The bindings do not currently support the `Directory` and `Tuple` layers. We have code, it just hasn't been ported to typescript. If someone wants to take a stab at it, raise an issue so we don't repeat work.

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
- [ ] Document passing options
- [ ] Document other transaction methods (get, set, getKey, etc)
- [ ] Figure out a decent way to bundle the native `libfdb_c` code so users don't need to download their own copy
- [ ] Tuple support
- [ ] Directory support
- [ ] Add testing harness
- [ ] Port basic tests
- [ ] Testing integrated with the harness for the other bindings
- [ ] Add leveldown compatibilty (?)
- [ ] Cut 1.0


## History

These bindings are currently based on an old version of FDB's bindings from years ago. The plan is to resurrect them over the next few weeks and get them production ready.

Patches welcome!
