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

#include "utils.h"
// #include <node.h>
// #include <iostream>
// #include <string>
// #include <cstring>
// #include <node_version.h>

// #include "Cluster.h"
// #include "Database.h"
// #include "future.h"
// #include "FdbError.h"

using namespace std;

// Cluster::Cluster() { }
// Cluster::~Cluster() {
//   if (cluster) fdb_cluster_destroy(cluster);
// }

// Nan::Persistent<Function> Cluster::constructor;

// static napi_value newCluster(napi_env env, napi_callback_info info) {

// }


static napi_value openDatabaseSync(napi_env env, napi_callback_info info) {}
static napi_value openDatabase(napi_env env, napi_callback_info info) {}
static napi_value close(napi_env env, napi_callback_info info) {}

napi_status initCluster(napi_env env) {
  napi_property_descriptor desc[] = {
    FN_DEF(openDatabase),
    FN_DEF(openDatabaseSync),
    FN_DEF(close),
  };

  napi_value constructor;
  NAPI_OK_OR_RETURN_STATUS(env, napi_define_class(env, "Cluster", NAPI_AUTO_LENGTH,
    NULL, NULL, sizeof(desc)/sizeof(desc[0]), desc, &constructor));

  // Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);

  // tpl->SetClassName(Nan::New<v8::String>("Cluster").ToLocalChecked());
  // tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // Nan::SetPrototypeMethod(tpl, "openDatabaseSync", OpenDatabaseSync);
  // Nan::SetPrototypeMethod(tpl, "openDatabase", OpenDatabase);
  // Nan::SetPrototypeMethod(tpl, "close", Close);

  // constructor.Reset(tpl->GetFunction());
}

// void Cluster::New(const Nan::FunctionCallbackInfo<Value>& info) {
//   Cluster *c = new Cluster();
//   c->Wrap(info.Holder());
// }

// Local<Value> Cluster::NewInstance(FDBCluster *ptr) {
//   Nan::EscapableHandleScope scope;

//   Local<Function> clusterConstructor = Nan::New<Function>(constructor);
//   Local<Object> instance = Nan::NewInstance(clusterConstructor, 0, NULL).ToLocalChecked();

//   Cluster *clusterObj = ObjectWrap::Unwrap<Cluster>(instance);
//   clusterObj->cluster = ptr;

//   // instance->Set(Nan::New<v8::String>("options").ToLocalChecked(),
//   //   FdbOptions::CreateOptions(FdbOptions::ClusterOption, instance));

//   return scope.Escape(instance);
// }

// static FDBFuture *createDbFuture(FDBCluster *cluster, Local<Value> name) {
//   std::string dbName = *Nan::Utf8String(name->ToString());
//   return fdb_cluster_create_database(cluster, (uint8_t*)dbName.c_str(), (int)strlen(dbName.c_str()));
// }

// void Cluster::OpenDatabaseSync(const Nan::FunctionCallbackInfo<Value>& info) {
//   Cluster *clusterPtr = ObjectWrap::Unwrap<Cluster>(info.Holder());
//   if (clusterPtr->cluster == nullptr) {
//     Nan::ThrowReferenceError("Cannot open database in closed cluster");
//     return info.GetReturnValue().SetUndefined();
//   }

//   FDBFuture *f = createDbFuture(clusterPtr->cluster, info[0]);

//   fdb_error_t errorCode = fdb_future_block_until_ready(f);

//   FDBDatabase *database;
//   if(errorCode == 0)
//     errorCode = fdb_future_get_database(f, &database);

//   if(errorCode != 0)
//     return Nan::ThrowError(FdbError::NewInstance(errorCode, fdb_get_error(errorCode)));

//   Local<Value> jsValue = Database::NewInstance(database);

//   info.GetReturnValue().Set(jsValue);
// }

// void Cluster::Close(const Nan::FunctionCallbackInfo<Value>& info) {
//   Cluster *clusterPtr = ObjectWrap::Unwrap<Cluster>(info.Holder());
//   // printf("cluster::close\n");
//   if (clusterPtr->cluster != nullptr) {
//     fdb_cluster_destroy(clusterPtr->cluster);
//     clusterPtr->cluster = nullptr;
//   }
// }

// void Cluster::OpenDatabase(const Nan::FunctionCallbackInfo<Value>& info) {
//   Cluster *clusterPtr = ObjectWrap::Unwrap<Cluster>(info.Holder());
//   if (clusterPtr->cluster == nullptr) {
//     Nan::ThrowReferenceError("Cannot open database in closed cluster");
//     return info.GetReturnValue().SetUndefined();
//   }
//   FDBFuture *f = createDbFuture(clusterPtr->cluster, info[0]);

//   auto promise = futureToJS(f, info[1], [](FDBFuture* f, fdb_error_t* errOut) -> Local<Value> {
//     FDBDatabase *database;
//     *errOut = fdb_future_get_database(f, &database);

//     if (*errOut == 0) return Database::NewInstance(database);
//     else return Nan::Undefined();
//   });
//   info.GetReturnValue().Set(promise);
// }
