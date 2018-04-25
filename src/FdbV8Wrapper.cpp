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
#include "node.h"
#include <iostream>
#include <cstdlib>
#include <cstring>
#include <node_version.h>

#include "Database.h"
#include "Cluster.h"
#include "Version.h"
#include "FdbError.h"
#include "options.h"
#include "future.h"

using namespace v8;
using namespace std;


static uv_thread_t fdbThread;

static bool networkStarted = false;


void ApiVersion(const FunctionCallbackInfo<Value>& info) {
  int apiVersion = info[0]->Int32Value();
  fdb_error_t errorCode = fdb_select_api_version(apiVersion);

  if(errorCode != 0) {
    if (errorCode == 2203)
      return Nan::ThrowError(FdbError::NewInstance(errorCode, "API version not supported by the installed FoundationDB C library"));
    return Nan::ThrowError(FdbError::NewInstance(errorCode));
  }

  info.GetReturnValue().SetNull();
}


static void networkThread(void *arg) {
  fdb_error_t errorCode = fdb_run_network();
  if(errorCode != 0)
    fprintf(stderr, "Unhandled error in FoundationDB network thread: %s (%d)\n", fdb_get_error(errorCode), errorCode);
}

static void runNetwork() {
  fdb_error_t errorCode = fdb_setup_network();

  if(errorCode != 0)
    return Nan::ThrowError(FdbError::NewInstance(errorCode));

  uv_thread_create(&fdbThread, networkThread, NULL);  // FIXME: Return code?
}


static FDBFuture *createClusterFuture(Local<Value> filenameOrNull) {
  const char *path = (filenameOrNull->IsNull() || filenameOrNull->IsUndefined())
    ? NULL : *Nan::Utf8String(filenameOrNull->ToString());

  return fdb_create_cluster(path);
}

void CreateClusterSync(const FunctionCallbackInfo<Value>& info) {
  Isolate *isolate = Isolate::GetCurrent();
  Nan::EscapableHandleScope scope;

  FDBFuture *f = createClusterFuture(info[0]);
  fdb_error_t errorCode = fdb_future_block_until_ready(f);

  FDBCluster *cluster;
  if(errorCode == 0) errorCode = fdb_future_get_cluster(f, &cluster);

  if(errorCode) return Nan::ThrowError(FdbError::NewInstance(errorCode));

  Local<Value> jsValue = Local<Value>::New(isolate, Cluster::NewInstance(cluster));
  info.GetReturnValue().Set(jsValue);
}

void CreateCluster(const FunctionCallbackInfo<Value>& info) {
  FDBFuture *f = createClusterFuture(info[0]);
  auto promise = futureToJS(f, info[1], [](FDBFuture* f, fdb_error_t* errOut) -> Local<Value> {
    Isolate *isolate = Isolate::GetCurrent();

    FDBCluster *cluster;
    auto errorCode = fdb_future_get_cluster(f, &cluster);
    if (errorCode) {
      *errOut = errorCode;
      return Undefined(isolate);
    }

    return Local<Value>::New(isolate, Cluster::NewInstance(cluster));
  });
  info.GetReturnValue().Set(promise);
}

void SetNetworkOption(const FunctionCallbackInfo<Value>& info) {
  set_option_wrapped(NULL, OptNetwork, info);
}

void StartNetwork(const FunctionCallbackInfo<Value>& info) {
  if(!networkStarted) {
    networkStarted = true;
    runNetwork();
  }
}

void StopNetwork(const FunctionCallbackInfo<Value>& info) {
  fdb_error_t errorCode = fdb_stop_network();

  if(errorCode != 0)
    return Nan::ThrowError(FdbError::NewInstance(errorCode));

  uv_thread_join(&fdbThread);

  //This line forces garbage collection.  Useful for doing valgrind tests
  //while(!V8::IdleNotification());
}

// (test, code) -> bool.
void ErrorPredicate(const FunctionCallbackInfo<Value>& info) {
  int test = info[0]->Int32Value();
  fdb_error_t code = info[1]->Int32Value();

  fdb_bool_t result = fdb_error_predicate(test, code);

  Isolate *isolate = Isolate::GetCurrent();
  info.GetReturnValue().Set(Boolean::New(isolate, result));
}

void Init(Local<Object> exports, Local<Object> module) {
  FdbError::Init( exports );
  Database::Init();
  Transaction::Init();
  Cluster::Init();
  initWatch();

// #define FN(name, fn) Nan::Set(exports, Nan::New<v8::String>(name).ToLocalChecked(), Nan::New<v8::FunctionTemplate>(fn)->GetFunction())
  NODE_SET_METHOD(exports, "apiVersion", ApiVersion);

  NODE_SET_METHOD(exports, "startNetwork", StartNetwork);
  NODE_SET_METHOD(exports, "stopNetwork", StopNetwork);

  NODE_SET_METHOD(exports, "setNetworkOption", SetNetworkOption);

  NODE_SET_METHOD(exports, "createCluster", CreateCluster);
  NODE_SET_METHOD(exports, "createClusterSync", CreateClusterSync);

  NODE_SET_METHOD(exports, "errorPredicate", ErrorPredicate);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Init);
