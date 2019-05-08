# Build

So for now we need napi support for node 12 (the old code is broken on newer versions of v8).

Also I want to maintain the older nan-based code for a few months because lots of people are using versions of nodejs too old to support napi. We need napi api 4, which was only [added to node 8 in version 8.16](https://github.com/nodejs/node/blob/master/doc/changelogs/CHANGELOG_V8.md#8.16.0), which came out in April 2019. And at the time of writing, node 8 was still the [most popular version of nodejs](https://nodejs.org/metrics/summaries/version.png).

There's unfortunately [no way find out the napi version from gyp](https://github.com/nodejs/node-gyp/issues/1745). Or at least, I couldn't figure it out. So instead of pointing the node-gyp file's sources list at 2 different directories of source files, for now I'm going to use the C preprocessor at build time to select the right version of the source files. This is pretty awful, but its functional, has no runtime cost, and will be pulled out in late 2019.

## Compatibility

The n-api code requires napi API v4 or greater. Its compatible with:

- Node 8.16.0 or newer (released April 2019
- Node 10.7 or newer (released mid 2018)
- Node 11, 12, or anything newer.

It might be compatible with node 9, but thats fallen out of the support window so I'm not fused.

The older nan / v8 based code is compatible with:

- Maybe earlier versions of node
- Node 8.0.0
- Node 9.0.0
- Node 10.0.0
- Node 11.0.0
- **NOT** node 12.

