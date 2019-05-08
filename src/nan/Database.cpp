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
#include "options.h"
#include "FdbError.h"

using namespace v8;
using namespace std;

Database::Database() { };

Database::~Database() {
  if (db != nullptr) fdb_database_destroy(db);
};

Nan::Persistent<Function> Database::constructor;

void Database::Init() {
  Isolate *isolate = Isolate::GetCurrent();
  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New);

  tpl->SetClassName(Nan::New<String>("Database").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "close", Close);
  NODE_SET_PROTOTYPE_METHOD(tpl, "createTransaction", CreateTransaction);
  NODE_SET_PROTOTYPE_METHOD(tpl, "setOption", SetOption);

  constructor.Reset(tpl->GetFunction());
}

void Database::Close(const FunctionCallbackInfo<Value>& info) {
  Database *dbPtr = node::ObjectWrap::Unwrap<Database>(info.Holder());
  if (dbPtr->db) {
    fdb_database_destroy(dbPtr->db);
    dbPtr->db = nullptr;
  }
}

void Database::CreateTransaction(const FunctionCallbackInfo<Value>& info) {
  Database *dbPtr = node::ObjectWrap::Unwrap<Database>(info.Holder());
  FDBDatabase *db = dbPtr->db;
  if (db == nullptr) {
    Nan::ThrowReferenceError("Cannot create transaction after db closed");
    return info.GetReturnValue().SetUndefined();
  }
  FDBTransaction *tr;
  fdb_error_t err = fdb_database_create_transaction(db, &tr);
  if (err) {
    Nan::ThrowError(FdbError::NewInstance(err, fdb_get_error(err)));
    return info.GetReturnValue().SetUndefined();
  }

  info.GetReturnValue().Set(Transaction::NewInstance(tr));
}

void Database::SetOption(const FunctionCallbackInfo<Value>& args) {
  // database.setOptionStr(opt_id, "value")
  Database *dbPtr = node::ObjectWrap::Unwrap<Database>(args.Holder());
  FDBDatabase *db = dbPtr->db;
  // Silently fail if the database is closed.
  if (db != nullptr) set_option_wrapped(db, OptDatabase, args);
}

void Database::New(const FunctionCallbackInfo<Value>& info) {
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

  // instance->Set(Nan::New<String>("options").ToLocalChecked(),
  //   FdbOptions::CreateOptions(FdbOptions::DatabaseOption, instance));

  return scope.Escape(instance);
}
