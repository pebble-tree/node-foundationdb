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

template<class T> struct CtxBase {
  FDBFuture *future;
  void (*fn)(FDBFuture*, T*);
  uv_async_t async;
};

template<class T> void resolveFutureInMainLoop(FDBFuture *f, T* ctx, void (*fn)(FDBFuture *f, T*)) {
  // printf("resolveFutureInMainLoop called\n");
  ctx->future = f;
  ctx->fn = fn;

  // TODO: Handle error on async_init failing. Probably just assert.
  assert(0 == uv_async_init(uv_default_loop(), &ctx->async, [](uv_async_t *async) {
    // raise(SIGTRAP);
    T* ctx = static_cast<T*>(async->data);
    ctx->fn(ctx->future, ctx);

    fdb_future_destroy(ctx->future);
    uv_close((uv_handle_t *)async, [](uv_handle_t *handle) {
      T* ctx = static_cast<T*>(handle->data);
      delete ctx;
    });
  }));
  // uv_async_t async;
  ctx->async.data = ctx;

  assert(0 == fdb_future_set_callback(f, [](FDBFuture *f, void *_ctx) {
    // raise(SIGTRAP);
    T* ctx = static_cast<T*>(_ctx);
    uv_async_send(&ctx->async);
  }, ctx));
}


Local<Promise> fdbFutureToJSPromise(FDBFuture *f, ExtractValueFn *extractFn) {
  // Using inheritance here because Persistent doesn't seem to like being
  // copied, and this avoids another allocation & indirection.
  struct Ctx: CtxBase<Ctx> {
    Nan::Persistent<Promise::Resolver> persistent;
    ExtractValueFn *extractFn;
  };
  Ctx *ctx = new Ctx;

  Isolate *isolate = Isolate::GetCurrent();
  auto resolver = Promise::Resolver::New(isolate->GetCurrentContext()).ToLocalChecked();
  ctx->persistent.Reset(resolver);
  ctx->extractFn = extractFn;

  resolveFutureInMainLoop<Ctx>(f, ctx, [](FDBFuture *f, Ctx *ctx) {
    Nan::HandleScope scope;
    Isolate *isolate = Isolate::GetCurrent();
    auto context = isolate->GetCurrentContext();

    auto resolver = Nan::New(ctx->persistent);

    fdb_error_t err = 0;
    auto value = ctx->extractFn(f, &err);

    // These methods both return Maybe<bool> if the reject / resolve happened.
    // It'd probably be better to assert that the Reject / Resolve applied.
    if (err != 0) (void)resolver->Reject(context, FdbError::NewInstance(err));
    else (void)resolver->Resolve(context, value);

    // Needed to work around a bug where the promise doesn't actually resolve.
    isolate->RunMicrotasks();

    ctx->persistent.Reset();
  });

  return resolver->GetPromise();
}

void fdbFutureToCallback(FDBFuture *f, Local<Function> cbFunc, ExtractValueFn *extractFn) {
  struct Ctx: CtxBase<Ctx> {
    Nan::Persistent<Function> cbFunc;
    ExtractValueFn *extractFn;
  };
  Ctx *ctx = new Ctx;

  ctx->cbFunc.Reset(cbFunc);
  ctx->extractFn = extractFn;

  resolveFutureInMainLoop<Ctx>(f, ctx, [](FDBFuture *f, Ctx *ctx) {
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


// *** Watch

// This seems overcomplicated, and I'd love to be able to use the functions
// above to do all this work. The problem is that fdb_future_cancel causes an
// abort() if the future has already resolved. So the JS object needs to
// somehow know that the promise has resolved. So I really want to hold a
// reference to the JS object. And its hard to strongarm the functions above
// into doing that. Doing it the way I am here is fine, but it means the API
// we expose to javascript either works with promises or callbacks but not
// both. I might end up redesigning some of this once I've benchmarked how
// promises perform in JS & C.
static Nan::Persistent<v8::Function> watchConstructor;

static void Cancel(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  Local<Object> t = info.This();
  FDBFuture *future = (FDBFuture *)(t->GetAlignedPointerFromInternalField(0));
  if (future) fdb_future_cancel(future);
}

void initWatch() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>();

  tpl->SetClassName(Nan::New<v8::String>("Watch").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "cancel", Cancel);

  watchConstructor.Reset(tpl->GetFunction());
}

Local<Object> watchFuture(FDBFuture *f, bool ignoreStandardErrors, Local<Function> callback) {
  struct Ctx: CtxBase<Ctx> {
    Nan::Persistent<Function> callback;
    Nan::Persistent<Object> jsWatch;
    bool ignoreStandardErrors;
  };
  Ctx *ctx = new Ctx;

  ctx->callback.Reset(callback);

  v8::Isolate *isolate = v8::Isolate::GetCurrent();
  Local<Function> localCon = Local<Function>::New(isolate, watchConstructor);
  Local<Object> jsWatch = Nan::NewInstance(localCon).ToLocalChecked();
  jsWatch->SetAlignedPointerInInternalField(0, f);
  ctx->jsWatch.Reset(jsWatch);
  ctx->ignoreStandardErrors = ignoreStandardErrors;

  resolveFutureInMainLoop<Ctx>(f, ctx, [](FDBFuture *f, Ctx *ctx) {
    Nan::HandleScope scope;

    v8::Isolate *isolate = v8::Isolate::GetCurrent();

    fdb_error_t errorCode = fdb_future_get_error(ctx->future);
    bool success = true;

    // You can no longer cancel the watcher. Remove the reference to the
    // future, which is about to be destroyed.
    Local<Object> jsWatch = Local<Object>::New(isolate, ctx->jsWatch);
    jsWatch->SetAlignedPointerInInternalField(0, NULL);

    // There's a bunch of standard errors which we want to suppress by default
    // here. The suppression is happening in C because making JS error objects is
    // expensive. But watch out - the callback will always be called!
    if (errorCode && ctx->ignoreStandardErrors && (
        errorCode == 1101 // operation_cancelled
        || errorCode != 1025 // transaction_cancelled
        || errorCode != 1020)) { // not_committed (tn conflict)
      // Suppress the error
      success = false;
      errorCode = 0;
    }

    Local<v8::Value> jsNull = v8::Null(isolate);
    Local<Value> jsError = (errorCode == 0)
      ? jsNull : FdbError::NewInstance(errorCode, fdb_get_error(errorCode));

    Local<Value> args[] = { jsError, Boolean::New(isolate, success) };

    // If this throws it'll bubble up to the node uncaught exception handler, which is what we want.
    Local<Function> callback = Local<Function>::New(isolate, ctx->callback);
    callback->Call(isolate->GetCurrentContext()->Global(), 2, args);

    // Needed to kick promises resolved in the callback.
    isolate->RunMicrotasks();

    ctx->callback.Reset();
    ctx->jsWatch.Reset();
  });

  return jsWatch;
}
