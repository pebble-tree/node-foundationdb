# Build

The native library here previously supported nan (an older cross-version way to communicate with v8 for native modules.). This is no longer the case - to keep the maintenance burden down, the module now only works with [n-api](https://nodejs.org/api/n-api.html) version 4+.

This should be fine anyway:

- Node 8 has exited its [LTS window](https://github.com/nodejs/Release)
- N-api version 4 has been backported all the way back to node 8 anyway.

So *nobody* is still using old point releases of node 8, *right??*


## Compatibility

The n-api code requires napi API v4 or greater. Its [compatible with](https://nodejs.org/api/n-api.html#n_api_n_api_version_matrix):

- Node 8.16.0 or newer (released April 2019)
- Node 10.16 or newer
- Node 11, 12, or anything newer.
