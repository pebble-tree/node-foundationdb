# HEAD

- Pulled out database / transaction scope information (prefix and key value transformers) into a separate class 'subspace' to more closely match the other bindings. This is currently internal-only but it will be exposed when I'm more confident about the API.
- Added support in the tuple encoder for non-array values, which are functionally equivalent to their array-wrapped versions. Eg this will now work:

```javascript
db.withKeyEncoding(fdb.tuple).at('index').set('hi', 'yo') // <-- 'index' and 'hi' no longer need to be wrapped in arrays
```

Note that `db.at(['prefix']).set(['key'], 'value')` is equivalent to `db.at(['prefix', 'key']).set([] (or undefined), 'value')` but *not* equivalent to `db.at(['prefix', 'key']).set(null, 'value')` because `null` is treated like `[null]` which is not the same as `[]`.

(The mental model is that tuple.pack(arr1) + tuple.pack(arr2) is always equivalent to tuple.pack(arr1 + arr2), so `[]` encodes to an empty byte string, but `[null]` encodes to `[0]`).

- Removed support for the older nan-based native module. The newer napi code works on all officially supported versions of nodejs, as well as node 8.16. So this should be pretty safe at this point.
- Updated API to support foundationdb 620
- Updated the binding tester to conform to version 620's changes
- Fixed a spec conformance bug in the tuple encoder's handling of extremely large negative integers

# 0.10.7

- Fixed another [critical bug](https://github.com/josephg/node-foundationdb/issues/41) which can cause nodejs to hang (deadlock) under heavy load.
- Started moving some documentation into doc comment style, so hovering over methods can now show information.
- Updated transaction options and network options to match upstream foundationdb @ 6.2.19

# 0.10.6

- Fixed a really bad [bug](https://github.com/josephg/node-foundationdb/issues/40) enabled by version 0.10.4 which can cause data corruption in some cases
- Improved the behaviour in `getRange` methods when fetching a range with a tuple key prefix. (`getRangeAll` / `getRangeStartsWith` / etc all do the right thing by default now when using tuple keys).

# 0.10.4

- Fixed [a bug](https://github.com/josephg/node-foundationdb/pull/39) involving range queries when a prefix wasn't applied to the database. Thanks @kristate!
- Removed compiled nan-based prebuilds for node 8 and node 11, since those versions have left the nodejs LTS window. Napi artifacts should still work on recent point releases.
- Added bigint support in tuple encoding

# 0.10.3

- Fixed behaviour when setAPIVersion is called multiple times. Thanks @ex3ndr! [Issue](https://github.com/josephg/node-foundationdb/issues/30) / [PR](https://github.com/josephg/node-foundationdb/pull/31)
- Added .modType to exported library artifact to help with debugging (its 'nan' or 'napi' depending on the build used).

# 0.10.2

- Fixed a bug causing node-gyp-build to stall when running `npm install`

# 0.10.1

(Tweaked testing infrastructure, but made no user / package level changes)

# 0.10.0

- Moved to n-api, which should improve performance and fix the build on node 12. It should also work on all future nodejs versions without code change. This breaks compatibility between the bundled prebuilds and most older point releases of node 8, 10 and 11. The latest point releases of each version of nodejs (v8.16.0+, 10.15.3+, 11.14.0+ or node 12) all support napi v4. The fallback build process should still build correct & usable binaries using the old C code path, but at some point I'll remove this code entirely.

# 0.9.0

- Fixed [issue using baked versionstamps in scoped transactions](https://github.com/josephg/node-foundationdb/issues/24). Thanks @aikoven!
- Added an extra optional argument to `fdb.setAPIVerion(version, headerVersion?)` to work around issues where the `#define FDB_API_VERSION` header version is newer than the installed `libfdb_c` library. Its a hack, but [its a decent work around until we work out best practices](https://forums.foundationdb.org/t/header-version-in-bindings/1113/8).


# 0.8.2

- Fixed a bug where if you called `tn.getVersionstamp` inside a transaction
  which conflicted, it would crash your whole node process.

# 0.8.1

- Fixed type information on `tn.scopedTo`
- Added support for explicit `cluster.close()` / `db.close()` calls
- Added support for `set/getVersionstampPrefixedValue` with no value


# 0.8.0

- Removed prebuild for node 9 and electron.
- Added prebuild for node 11
- Added proper versionstamp API
- Added versionstamp support to tuple
- Wrapped getVersionstamp in a {promise} object


# 0.7.0

- Added support for protocol versions 520 and 600, testing with fdb 6.0.15
- Added support for versionstamp values at an offset
- Added support for decoding tuple values with versionstamps. No support for encoding versionstamps yet
- Removed a bunch of unnecessary files from the bundle
- Added binding build for FreeBSD

