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

#include <node.h>
#include <iostream>
#include <string>
#include <cstring>

#include "Database.h"
#include "FdbOptions.h"
#include "NodeCallback.h"

using namespace v8;
using namespace std;

Database::Database() { };

Database::~Database() {
  fdb_database_destroy(db);
};

Nan::Persistent<Function> Database::constructor;

void Database::Init() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);

  tpl->SetClassName(Nan::New<v8::String>("Database").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "createTransaction", CreateTransaction);
  Nan::SetPrototypeMethod(tpl, "setOption", SetOption);

  constructor.Reset(tpl->GetFunction());
}

void Database::CreateTransaction(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  Database *dbPtr = node::ObjectWrap::Unwrap<Database>(info.Holder());
  FDBDatabase *db = dbPtr->db;
  FDBTransaction *tr;
  fdb_error_t err = fdb_database_create_transaction(db, &tr);
  if (err) {
    Nan::ThrowError(FdbError::NewInstance(err, fdb_get_error(err)));
    return info.GetReturnValue().SetUndefined();
  }

  info.GetReturnValue().Set(Transaction::NewInstance(tr));
}

void Database::SetOption(const Nan::FunctionCallbackInfo<v8::Value>& args) {
  // database.setOptionStr(opt_id, "value")
  Isolate *isolate = args.GetIsolate();

  Database *dbPtr = node::ObjectWrap::Unwrap<Database>(args.Holder());
  FDBDatabase *db = dbPtr->db;

  if (args.Length() < 2) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Not enough arguments")));
    return;
  }

  if (!args[0]->IsUint32()) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "First argument not an integer")));
    return;
  }
  uint32_t code = args[0]->Uint32Value();
  fdb_error_t err;

  if (args[1]->IsUint32()) {
    uint64_t value = args[1]->Uint32Value();
    err = fdb_database_set_option(db, (FDBDatabaseOption)code, (const uint8_t *)&value, 8);

    printf("%d %lld\n", code, value);
  } else if (node::Buffer::HasInstance(args[1])) {
    uint8_t const *value = (uint8_t *)node::Buffer::Data(args[1]);
    int value_length = node::Buffer::Length(args[1]);
    err = fdb_database_set_option(db, (FDBDatabaseOption)code, value, value_length);

    printf("%d %s\n", code, value);
  } else {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Second argument not a buffer")));
    return;
  }

  if (err) {
    Nan::ThrowError(FdbError::NewInstance(err, fdb_get_error(err)));
    // return info.GetReturnValue().SetUndefined();
  }

  // printf("%s\n", args[0]->ToString());
}

void Database::New(const Nan::FunctionCallbackInfo<Value>& info) {
  Database *db = new Database();
  db->Wrap(info.Holder());

  info.GetReturnValue().Set(info.Holder());
}

Local<Value> Database::NewInstance(FDBDatabase *ptr) {
  Nan::EscapableHandleScope scope;

  Local<Function> databaseConstructor = Nan::New<Function>(constructor);
  Local<Object> instance = Nan::NewInstance(databaseConstructor).ToLocalChecked();

  Database *dbObj = ObjectWrap::Unwrap<Database>(instance);
  dbObj->db = ptr;

  // instance->Set(Nan::New<v8::String>("options").ToLocalChecked(),
  //   FdbOptions::CreateOptions(FdbOptions::DatabaseOption, instance));

  return scope.Escape(instance);
}
