/*
 * FoundationDB Node.js API
 * Copyright (c) 2012 FoundationDB, LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

#include <string>
// #include "node.h"
#include <iostream>
#include <cstdlib>
#include <cstring>
// #include <node_version.h>

#define NAPI_VERSION 3
#include <node_api.h>
#include <uv.h>

#include "Version.h"
#include <foundationdb/fdb_c.h>


// #include "Database.h"
// #include "Cluster.h"
// #include "FdbError.h"
// #include "options.h"
// #include "future.h"

// using namespace v8;
using namespace std;


static uv_thread_t fdbThread;

static bool networkStarted = false;

// napi_status get_int32_arg(napi_env env, napi_callback_info info) {

// }

static napi_status throw_if_not_ok(napi_env env, napi_status status) {
  switch (status) {
    case napi_ok: case napi_pending_exception:
      return status;
    case napi_number_expected:
      napi_throw_type_error(env, NULL, "Expected number");
      return napi_pending_exception;
    case napi_string_expected:
      napi_throw_type_error(env, NULL, "Expected string");
      return napi_pending_exception;
    default:
      fprintf(stderr, "throw_if_not_ok %d", status);
      assert(0);
  }
}

#define CHECKED_NAPI_VALUE(env, expr) do {\
  if (throw_if_not_ok(env, expr) != napi_ok) { return NULL; }\
} while (0)
#define CHECKED_NAPI_STATUS(env, expr) do {\
  napi_status status = throw_if_not_ok(env, expr);\
  if (status != napi_ok) { return status; }\
} while (0)

static napi_status wrap_fdb_error(napi_env env, fdb_error_t fdbErrCode, napi_value* result) {
  napi_value errCode;
  CHECKED_NAPI_STATUS(env, napi_create_int32(env, fdbErrCode, &errCode));
  napi_value errStr;
  CHECKED_NAPI_STATUS(env, napi_create_string_utf8(env, fdb_get_error(fdbErrCode), NAPI_AUTO_LENGTH, &errStr));
  CHECKED_NAPI_STATUS(env, napi_create_error(env, NULL, errStr, result));

  // TODO: This isn't the same as the old code, since it won't allow err instanceof fdbErrCode to work.
  CHECKED_NAPI_STATUS(env, napi_set_named_property(env, *result, "fdb_errcode", errCode));
  return napi_ok;
}

static void throw_fdb_error(napi_env env, fdb_error_t fdbErrCode) {
  napi_value error;
  if (throw_if_not_ok(env, wrap_fdb_error(env, fdbErrCode, &error)) == napi_pending_exception) return; 
  throw_if_not_ok(env, napi_throw(env, error));
  // There'll be a pending exception after this no matter what. No need to return a status code.
}

#define CHECKED_FDB(env, expr) do {\
  fdb_error_t code = expr;\
  if (code != 0) {\
    throw_fdb_error(env, code);\
    return NULL;\
  }\
} while (0)

static napi_value setAPIVersion(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  CHECKED_NAPI_VALUE(env, napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  int32_t apiVersion;
  CHECKED_NAPI_VALUE(env, napi_get_value_int32(env, arg, &apiVersion));

  CHECKED_FDB(env, fdb_select_api_version(apiVersion));
  return NULL;
}

static napi_value setAPIVersionImpl(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  CHECKED_NAPI_VALUE(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  int32_t apiVersion;
  CHECKED_NAPI_VALUE(env, napi_get_value_int32(env, args[0], &apiVersion));
  int32_t headerVersion;
  CHECKED_NAPI_VALUE(env, napi_get_value_int32(env, args[0], &headerVersion));

  CHECKED_FDB(env, fdb_select_api_version_impl(apiVersion, headerVersion));
  return NULL;
}

static void networkThread(void *arg) {
  fdb_error_t errorCode = fdb_run_network();
  if(errorCode != 0) {
    fprintf(stderr, "Unhandled error in FoundationDB network thread: %s (%d)\n", fdb_get_error(errorCode), errorCode);
  }
}

static fdb_error_t runNetwork() {
  fdb_error_t errorCode = fdb_setup_network();

  if(errorCode != 0) return errorCode;

  assert(0 == uv_thread_create(&fdbThread, networkThread, NULL));  // FIXME: Handle errors here gracefully
  return 0;
}

// static void valIsNullish(napi_env env, napi_value value, int* result) {
//   napi_valuetype type;
//   napi_typeof(env, value, &type)
  
// }

// Returns null if the passed value isn't a string or NULL.
static FDBFuture *_createClusterFuture(napi_env env, napi_value filenameOrNull) {
  if (filenameOrNull != NULL) {
    napi_valuetype type;
    CHECKED_NAPI_VALUE(env, napi_typeof(env, filenameOrNull, &type));
    if (type == napi_null || type == napi_undefined) filenameOrNull = NULL;
  }

  if (filenameOrNull != NULL) {
    // This effectively enforces a hardcoded 1024 character limit on cluster file
    // paths. In practice this should be fine.
    char path[1024];
    // TODO: Consider adding a warning here if the path is truncated. (We can
    // pull the length back off with the last argument).
    CHECKED_NAPI_VALUE(env, napi_get_value_string_utf8(env, filenameOrNull, path, sizeof(path), NULL));
    return fdb_create_cluster(path);
  } else {
    return fdb_create_cluster(NULL);
  }
}

static napi_value createClusterSync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  CHECKED_NAPI_VALUE(env, napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));

  FDBFuture *f = _createClusterFuture(env, arg);
  if (f == NULL) return NULL; // A napi error happened.

  // Isolate *isolate = Isolate::GetCurrent();
  // Nan::EscapableHandleScope scope;

  // FDBFuture *f = _createClusterFuture(info[0]);
  CHECKED_FDB(env, fdb_future_block_until_ready(f));

  FDBCluster *cluster;
  CHECKED_FDB(env, fdb_future_get_cluster(f, &cluster));

  // TODO!
  // Local<Value> jsValue = Local<Value>::New(isolate, Cluster::NewInstance(cluster));
  // info.GetReturnValue().Set(jsValue);
  return NULL;
}

// void createCluster(const FunctionCallbackInfo<Value>& info) {
// static napi_value createClusterSync(napi_env env, napi_callback_info info) {
//   FDBFuture *f = createClusterFuture(info[0]);
//   auto promise = futureToJS(f, info[1], [](FDBFuture* f, fdb_error_t* errOut) -> Local<Value> {
//     Isolate *isolate = Isolate::GetCurrent();

//     FDBCluster *cluster;
//     auto errorCode = fdb_future_get_cluster(f, &cluster);
//     if (errorCode) {
//       *errOut = errorCode;
//       return Undefined(isolate);
//     }

//     return Local<Value>::New(isolate, Cluster::NewInstance(cluster));
//   });
//   info.GetReturnValue().Set(promise);
// }

// void SetNetworkOption(const FunctionCallbackInfo<Value>& info) {
//   set_option_wrapped(NULL, OptNetwork, info);
// }

static napi_value startNetwork(napi_env env, napi_callback_info info) {
  if(!networkStarted) {
    networkStarted = true;
    runNetwork();
  }
  return NULL;
}

static napi_value stopNetwork(napi_env env, napi_callback_info info) {
  if (!networkStarted) return NULL;

  CHECKED_FDB(env, fdb_stop_network());

  assert(0 == uv_thread_join(&fdbThread));

  networkStarted = false;

  //This line forces garbage collection.  Useful for doing valgrind tests
  //while(!V8::IdleNotification());
  return NULL;
}

// (test, code) -> bool.
static napi_value errorPredicate(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  CHECKED_NAPI_VALUE(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  
  int test;
  CHECKED_NAPI_VALUE(env, napi_get_value_int32(env, args[0], &test));

  fdb_error_t code;
  CHECKED_NAPI_VALUE(env, napi_get_value_int32(env, args[1], &code));

  fdb_bool_t result = fdb_error_predicate(test, code);

  napi_value js_result;
  CHECKED_NAPI_VALUE(env, napi_get_boolean(env, result, &js_result));
  return js_result;
}

// void Init(Local<Object> exports, Local<Object> module) {
//   FdbError::Init( exports );
//   Database::Init();
//   Transaction::Init();
//   Cluster::Init();
//   initWatch();

// // #define FN(name, fn) Nan::Set(exports, Nan::New<v8::String>(name).ToLocalChecked(), Nan::New<v8::FunctionTemplate>(fn)->GetFunction())
//   NODE_SET_METHOD(exports, "setAPIVersion", setAPIVersion);
//   NODE_SET_METHOD(exports, "setAPIVersionImpl", setAPIVersionImpl);

//   NODE_SET_METHOD(exports, "startNetwork", StartNetwork);
//   NODE_SET_METHOD(exports, "stopNetwork", StopNetwork);

//   NODE_SET_METHOD(exports, "setNetworkOption", SetNetworkOption);

//   NODE_SET_METHOD(exports, "createCluster", CreateCluster);
//   NODE_SET_METHOD(exports, "createClusterSync", CreateClusterSync);

//   NODE_SET_METHOD(exports, "errorPredicate", ErrorPredicate);
// }

// NODE_MODULE(NODE_GYP_MODULE_NAME, Init);

#define FN_DEF(fn) {#fn, NULL, fn, NULL, NULL, NULL, napi_default, NULL}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {
    FN_DEF(setAPIVersion),
    FN_DEF(setAPIVersionImpl),

    // FN_DEF(createCluster),
    FN_DEF(createClusterSync),

    // FN_DEF(setNetworkOption),
    FN_DEF(startNetwork),
    FN_DEF(stopNetwork),

    FN_DEF(errorPredicate),
  };
  CHECKED_NAPI_VALUE(env, napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc));
  return NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init);