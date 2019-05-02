// This file provides some utilities for wrapping FDB future objects with javascript.

#ifndef _FUTURE_H_
#define _FUTURE_H_

#include "utils.h"

typedef v8::Local<v8::Value> ExtractValueFn(FDBFuture* f, fdb_error_t* errOut);

v8::Local<v8::Promise> fdbFutureToJSPromise(FDBFuture* f, ExtractValueFn* extractValueFn);
void fdbFutureToCallback(FDBFuture *f, v8::Local<v8::Function> cbFunc, ExtractValueFn *extractFn);

v8::Local<v8::Value> futureToJS(FDBFuture *f, v8::Local<v8::Value> cbOrNull, ExtractValueFn *extractFn);

void initWatch();
v8::Local<v8::Object> watchFuture(FDBFuture *f, bool ignoreStandardErrors);

#endif