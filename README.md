# FoundationDB NodeJS bindings

These bindings are currently in the process of being revived and renewed from some very old code.

This is not yet production ready. The APIs will drift slightly over the next few weeks. But please give it a try and file issues against anything that isn't working yet.

## Usage

```
npm install --save foundationdb
```

And in your code:

```javascript
const fdb = require('foundationdb')

const db = fdb.openSync('fdb.cluster')

db.transact(async tn => {
	console.log(await tn.getStr('hi'))
	tn.set('hi', 'yo')
})
```

Or from typescript:

```typescript
import fdb from 'foundationdb'
// ... Same as above but everything has types!
```

The bindings currently support all the standard KV operations except range reads. They should be added over the next week or so.

The bindings do not currently support the `Directory` and `Tuple` layers. We have code, it just hasn't been ported to typescript. If someone wants to take a stab at it, raise an issue so we don't repeat work.

## Revival progress

- [x] Get it building on modern node / v8
- [x] Make all transaction primitives support promises
- [x] Native code works
- [x] Core rewritten in TS
- [x] Primitive transactions working from node
- [x] Transaction retry loop working
- [ ] Documentation
- [ ] Basic read range support
- [ ] Read range callback iterator support
- [ ] Read range async iterator
- [ ] Figure out a decent way to bundle the native `libfdb_c` code so users don't need to download their own copy
- [ ] Tuple support
- [ ] Directory support
- [ ] Basic local testing
- [ ] Testing integrated with the harness for the other bindings
- [ ] Cut 1.0


## History

These bindings are currently based on an old version of FDB's bindings from years ago. The plan is to resurrect them over the next few weeks and get them production ready.

Patches welcome!