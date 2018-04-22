#include <cstdio>
#include <cassert>

#include <node.h>
#include <nan.h>
// #include <v8.h>

// #include "Version.h"
// #include <foundationdb/fdb_c.h>

#include "FdbError.h"
#include "future.h"

using namespace v8;

template<class T> struct Ctx {
  FDBFuture *future;
  void (*fn)(FDBFuture *f, T *);
  uv_async_t async;
};
template<class T> void resolveFutureInMainLoop(FDBFuture *f, T* ctx, void (*fn)(FDBFuture *f, T*)) {
  // Ctx *ctx = new Ctx;
  ctx->future = f;
  ctx->fn = fn;

  // uv_async_t async;
  ctx->async.data = ctx;
  // TODO: Handle error on async_init failing. Probably just assert.
  assert(0 == uv_async_init(uv_default_loop(), &ctx->async, [](uv_async_t *async) {
    T* ctx = static_cast<T*>(async->data);
    ctx->fn(ctx->future, ctx);

    fdb_future_destroy(ctx->future);
    uv_close((uv_handle_t *)async, NULL);
    delete ctx;
  }));

  assert(0 == fdb_future_set_callback(f, [](FDBFuture *f, void *_ctx) {
    T* ctx = static_cast<T*>(_ctx);
    uv_async_send(&ctx->async);
  }, ctx));
}


Local<Promise> fdbFutureToJSPromise(FDBFuture *f, ExtractValueFn *extractFn) {
  // Using inheritance here because Persistent doesn't seem to like being
  // copied, and this avoids another allocation & indirection.
  struct Ctx2: Ctx<Ctx2> {
    Nan::Persistent<Promise::Resolver> persistent;
    ExtractValueFn *extractFn;
  };
  Ctx2 *ctx = new Ctx2;

  Isolate *isolate = Isolate::GetCurrent();
  auto resolver = Promise::Resolver::New(isolate);
  ctx->persistent.Reset(resolver);
  ctx->extractFn = extractFn;

  resolveFutureInMainLoop<Ctx2>(f, ctx, [](FDBFuture *f, Ctx2 *ctx) {
    Nan::HandleScope scope;
    auto resolver = Nan::New(ctx->persistent);

    fdb_error_t err = 0;
    auto value = ctx->extractFn(f, &err);
    if (err != 0) resolver->Reject(FdbError::NewInstance(err));
    else resolver->Resolve(value);

    ctx->persistent.Reset();
  });

  return resolver->GetPromise();
}

void fdbFutureToCallback(FDBFuture *f, Local<Function> cbFunc, ExtractValueFn *extractFn) {
  struct Ctx2: Ctx<Ctx2> {
    Nan::Persistent<Function> cbFunc;
    ExtractValueFn *extractFn;
  };
  Ctx2 *ctx = new Ctx2;

  ctx->cbFunc.Reset(cbFunc);
  ctx->extractFn = extractFn;

  resolveFutureInMainLoop<Ctx2>(f, ctx, [](FDBFuture *f, Ctx2 *ctx) {
    Nan::HandleScope scope;

    v8::Isolate *isolate = v8::Isolate::GetCurrent();

    fdb_error_t errorCode = 0;
    Local<Value> jsValue = ctx->extractFn(ctx->future, &errorCode);

    Local<v8::Value> jsNull = v8::Null(isolate);
    Local<Value> jsError = (errorCode == 0)
      ? jsNull : FdbError::NewInstance(errorCode, fdb_get_error(errorCode));

    Local<Value> args[2] = { jsError, jsValue };

    Local<Function> callback = Local<Function>::New(isolate, ctx->cbFunc);

    // If this throws it'll bubble up to the node uncaught exception handler, which is what we want.
    callback->Call(isolate->GetCurrentContext()->Global(), 2, args);

    ctx->cbFunc.Reset();
  });
}

Local<Value> futureToJS(FDBFuture *f, Local<Value> cbOrNull, ExtractValueFn *extractFn) {
  if (cbOrNull->IsUndefined() || cbOrNull->IsNull()) {
    return fdbFutureToJSPromise(f, extractFn);
  } else if (cbOrNull->IsFunction()) {
    fdbFutureToCallback(f, Local<Function>::Cast(cbOrNull), extractFn);
  } else {
    Nan::ThrowTypeError("Invalid callback argument call");
  }
  return v8::Undefined(Isolate::GetCurrent());
}
