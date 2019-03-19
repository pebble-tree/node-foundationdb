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
