#include <atomic>
#include <thread>
#include <cstdio>
#include <cassert>

#include "utils.h"
#include <uv.h>
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

  // This is to work around a concurrency bug I still haven't figured out.
  // https://github.com/josephg/node-foundationdb/issues/28
  std::atomic_bool close_ready;
};

template<class T> static napi_status resolveFutureInMainLoop(napi_env env, FDBFuture *f, T* ctx, void (*fn)(FDBFuture *f, T*)) {
  // printf("resolveFutureInMainLoop called\n");
  ctx->future = f;
  ctx->fn = fn;
  ctx->close_ready.store(false, std::memory_order_relaxed);

  uv_loop_t *uvloop;
  NAPI_OK_OR_RETURN_STATUS(env, napi_get_uv_event_loop(env, &loop));

  // TODO: Handle error on async_init failing. Probably just assert.
  assert(0 == uv_async_init(uvloop, &ctx->async, [](uv_async_t *async) {
    // raise(SIGTRAP);
    T* ctx = static_cast<T*>(async->data);
    ctx->fn(ctx->future, ctx);

    fdb_future_destroy(ctx->future);

    // Simple spinlock. This works around this bug in libuv:
    // https://github.com/libuv/libuv/issues/2226
    while (ctx->close_ready.load(std::memory_order_acquire) == false) {
      std::this_thread::yield();
    }

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
    ctx->close_ready.store(true, std::memory_order_release);
  }, ctx));
}


Local<Promise> fdbFutureToJSPromise(napi_env env, FDBFuture *f, ExtractValueFn *extractFn) {
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

napi_status fdbFutureToCallback(napi_env env, FDBFuture *f, napi_value cbFunc, ExtractValueFn *extractFn) {
  struct Ctx: CtxBase<Ctx> {
    napi_ref cbFunc;
    ExtractValueFn *extractFn;
  };
  Ctx *ctx = new Ctx;

  NAPI_OK_OR_RETURN_STATUS(env, napi_create_reference(env, cbFunc, 1, &ctx->cbFunc));
  ctx->extractFn = extractFn;

  resolveFutureInMainLoop<Ctx>(f, ctx, [](FDBFuture *f, Ctx *ctx) {
    Nan::HandleScope scope;

    v8::Isolate *isolate = v8::Isolate::GetCurrent();

    fdb_error_t errorCode = 0;
    Local<Value> jsValue = ctx->extractFn(ctx->future, &errorCode);

    Local<v8::Value> jsNull = v8::Null(isolate);
    Local<Value> jsError = (errorCode == 0)
      ? jsNull : FdbError::NewInstance(errorCode, fdb_get_error(errorCode));

    napi_value args[2] = { jsError, jsValue };

    napi_value callback;
    napi_get_reference_value(env, ctx->cbFunc, &callback);

    // If this throws it'll bubble up to the node uncaught exception handler, which is what we want.
    napi_call_function(env, NULL, callback, 2, args, NULL);

    napi_reference_unref(env, ctx->cbFunc, NULL);
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

Local<Object> watchFuture(FDBFuture *f, bool ignoreStandardErrors) {
  struct Ctx: CtxBase<Ctx> {
    Nan::Persistent<Object> jsWatch;
    // I probably don't need to store a persistant reference here since it
    // can't be GCed anyway because its stored on jsWatch. But I think this is
    // *more* correct..?
    Nan::Persistent<Promise::Resolver> resolver;
    bool ignoreStandardErrors;
  };
  Ctx *ctx = new Ctx;

  v8::Isolate *isolate = v8::Isolate::GetCurrent();

  auto resolver = Promise::Resolver::New(isolate->GetCurrentContext()).ToLocalChecked();
  ctx->resolver.Reset(resolver);

  Local<Function> localCon = Local<Function>::New(isolate, watchConstructor);
  Local<Object> jsWatch = Nan::NewInstance(localCon).ToLocalChecked();

  jsWatch->SetAlignedPointerInInternalField(0, f);
  // I'm sure there's a better way to attach this, but I can figure that out when moving to N-API.
  jsWatch->Set(String::NewFromUtf8(isolate, "promise", String::kInternalizedString), resolver->GetPromise());

  ctx->jsWatch.Reset(jsWatch);
  ctx->ignoreStandardErrors = ignoreStandardErrors;

  resolveFutureInMainLoop<Ctx>(f, ctx, [](FDBFuture *f, Ctx *ctx) {
    // This is cribbed from fdbFutureToJSPromise above. Bleh.
    Nan::HandleScope scope;
    v8::Isolate *isolate = v8::Isolate::GetCurrent();
    auto context = isolate->GetCurrentContext();

    fdb_error_t err = fdb_future_get_error(ctx->future);
    bool success = true;

    auto resolver = Nan::New(ctx->resolver);

    // You can no longer cancel the watcher. Remove the reference to the
    // future, which is about to be destroyed.
    Local<Object> jsWatch = Local<Object>::New(isolate, ctx->jsWatch);
    jsWatch->SetAlignedPointerInInternalField(0, NULL);

    // By default node promises will crash the whole process. If the
    // transaction which created this watch promise is cancelled or conflicts,
    // what should we do here? 
    // 1 If we reject the promise, the process will crash by default.
    //   Preventing this with the current API is really awkward
    // 2 If we resolve the promise that doesn't really make a lot of sense
    // 3 If we leave the promise dangling.. that sort of violates the idea of a
    //   *promise*
    // 
    // By default I'm going to do option 2 (well, when ignoreStandardErrors is
    // passed, which happens by default).
    // 
    // The promise will resolve (true) normally, or (false) if it was aborted.
    if (err && ctx->ignoreStandardErrors && (
        err == 1101 // operation_cancelled
        || err == 1025 // transaction_cancelled
        || err == 1020)) { // not_committed (tn conflict)
      success = false;
      err = 0;
    }

    if (err != 0) (void)resolver->Reject(context, FdbError::NewInstance(err));
    else (void)resolver->Resolve(context, Boolean::New(isolate, success));

    // Needed to kick promises resolved in the callback.
    isolate->RunMicrotasks();

    ctx->jsWatch.Reset();
    ctx->resolver.Reset();
  });

  return jsWatch;
}
