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
#include <vector>
#include <node_buffer.h>
#include <node_version.h>

#include "options.h"
#include "Transaction.h"
#include "FdbError.h"

#include "future.h"

using namespace v8;
using namespace std;
using namespace node;


// Transaction Implementation
Transaction::~Transaction() {
  fdb_transaction_destroy(tr);
};

Nan::Persistent<Function> Transaction::constructor;


struct StringParams {
  bool owned;
  uint8_t *str;
  int len;

  // String arguments can either be buffers or strings. If they're strings we
  // need to copy the bytes locally in order to utf8 convert the content.
  StringParams(Local<Value> keyVal) {
    if (keyVal->IsString()) {
      owned = true;

      auto s = Local<String>::Cast(keyVal);
      len = s->Utf8Length();
      str = new uint8_t[len];
      s->WriteUtf8((char *)str, len);
    } else {
      owned = false;

      auto obj = keyVal->ToObject();
      str = (uint8_t*)(Buffer::Data(obj));
      len = (int)Buffer::Length(obj);
    }
  }
  ~StringParams() {
    if (owned) delete[] str;
  }
};


// dataOut must be a ptr to array of 8 items.
static void int64ToBEBytes(uint8_t* dataOut, uint64_t num) {
  for (int i = 0; i < 8; i++) {
    dataOut[7-i] = num & 0xff;
    num = num >> 8;
  }
}

// bytes be a ptr to an 8 byte array.
static uint64_t BEBytesToInt64(uint8_t* bytes) {
  uint64_t result = 0;
  for (int i = 7; i >= 0; i--) {
    result |= bytes[i];
    result <<= 8;
  }
  return result;
}


// **** Transaction

FDBTransaction* Transaction::GetTransactionFromArgs(const FunctionCallbackInfo<Value>& info) {
  return node::ObjectWrap::Unwrap<Transaction>(info.Holder())->tr;
}


static Local<Value> ignoreResult(FDBFuture* future, fdb_error_t* errOut) {
  *errOut = fdb_future_get_error(future);
  return Nan::Undefined();
}

static Local<Value> getValue(FDBFuture* future, fdb_error_t* errOut) {
  Isolate *isolate = Isolate::GetCurrent();

  const uint8_t *value;
  int valueLength;
  int valuePresent;

  *errOut = fdb_future_get_value(future, &valuePresent, &value, &valueLength);
  if (*errOut) return Undefined(isolate);

  return valuePresent
    ? Local<Value>::New(isolate, Nan::CopyBuffer((const char *)value, valueLength).ToLocalChecked())
    : Local<Value>(Null(isolate));
}

static Local<Value> getKey(FDBFuture* future, fdb_error_t* errOut) {
  Isolate *isolate = Isolate::GetCurrent();

  const uint8_t *key;
  int keyLength;
  *errOut = fdb_future_get_key(future, &key, &keyLength);

  if (*errOut) return Undefined(isolate);
  else return Local<Value>::New(isolate, Nan::CopyBuffer((const char *)key, keyLength).ToLocalChecked());
}

static Local<Value> getKeyValueList(FDBFuture* future, fdb_error_t* errOut) {
  Isolate *isolate = Isolate::GetCurrent();

  const FDBKeyValue *kv;
  int len;
  fdb_bool_t more;

  *errOut = fdb_future_get_keyvalue_array(future, &kv, &len, &more);
  if (*errOut) return Undefined(isolate);

  /*
   * Constructing a JavaScript object with:
   * { results: [[key, value], [key, value], ...], more }
   */

  Local<Object> returnObj = Local<Object>::New(isolate, Object::New(isolate));
  Local<Array> jsValueArray = Array::New(isolate, len);

  for(int i = 0; i < len; i++) {
    Local<Object> pair = Array::New(isolate, 2);

    Local<Value> jsKeyBuffer = Nan::CopyBuffer((const char*)kv[i].key, kv[i].key_length).ToLocalChecked();
    Local<Value> jsValueBuffer = Nan::CopyBuffer((const char*)kv[i].value, kv[i].value_length).ToLocalChecked();

    pair->Set(0, jsKeyBuffer);
    pair->Set(1, jsValueBuffer);
    jsValueArray->Set(i, pair);
  }

  returnObj->Set(String::NewFromUtf8(isolate, "results", String::kInternalizedString), jsValueArray);
  returnObj->Set(String::NewFromUtf8(isolate, "more", String::kInternalizedString), Boolean::New(isolate, !!more));

  return returnObj;
}

static Local<Value> getStringArray(FDBFuture* future, fdb_error_t* errOut) {
  Isolate *isolate = Isolate::GetCurrent();

  const char **strings;
  int stringCount;

  *errOut = fdb_future_get_string_array(future, &strings, &stringCount);
  if (*errOut) return Undefined(isolate);

  Local<Array> jsArray = Local<Array>::New(isolate, Array::New(isolate, stringCount));
  for(int i = 0; i < stringCount; i++) {
    jsArray->Set(Number::New(isolate, i), Nan::New(strings[i], (int)strlen(strings[i])).ToLocalChecked());
  }

  return jsArray;
}

static Local<Value> versionToJSBuffer(int64_t version) {
  // Versions are stored as an 8 byte buffer. They are stored big-endian so
  // standard lexical comparison functions will do what you expect.
  uint8_t data[8];
  int64ToBEBytes(data, (uint64_t)version);
  return Nan::CopyBuffer((char *)data, 8).ToLocalChecked();
}

static Local<Value> getVersion(FDBFuture* future, fdb_error_t* errOut) {
  Isolate *isolate = Isolate::GetCurrent();

  int64_t version;
  *errOut = fdb_future_get_version(future, &version);

  // See discussion about buffers vs storing the version as a JS number:
  // https://forums.foundationdb.org/t/version-length-is-53-bits-enough/260/6
  if (*errOut) return Undefined(isolate);
  else return Local<Value>::New(isolate, versionToJSBuffer(version));
}



// setOption(code, value).
void Transaction::SetOption(const FunctionCallbackInfo<v8::Value>& args) {
  // database.setOptionStr(opt_id, "value")
  FDBTransaction *tr = GetTransactionFromArgs(args);
  set_option_wrapped(tr, OptTransaction, args);
}


// commit()
void Transaction::Commit(const FunctionCallbackInfo<Value>& info) {
  FDBFuture *f = fdb_transaction_commit(GetTransactionFromArgs(info));
  info.GetReturnValue().Set(futureToJS(f, info[0], ignoreResult));
}

// Reset the transaction so it can be reused.
void Transaction::Reset(const FunctionCallbackInfo<Value>& info) {
  fdb_transaction_reset(GetTransactionFromArgs(info));
}

void Transaction::Cancel(const FunctionCallbackInfo<Value>& info) {
  fdb_transaction_cancel(GetTransactionFromArgs(info));
}

// See fdb_transaction_on_error documentation to see how to handle this.
// This is all wrapped by JS.
void Transaction::OnError(const FunctionCallbackInfo<Value>& info) {
  fdb_error_t errorCode = info[0]->Int32Value();
  FDBFuture *f = fdb_transaction_on_error(GetTransactionFromArgs(info), errorCode);
  info.GetReturnValue().Set(futureToJS(f, info[1], ignoreResult));
}



// Get(key, isSnapshot, [cb])
void Transaction::Get(const FunctionCallbackInfo<Value>& info) {
  StringParams key(info[0]);
  bool snapshot = info[1]->BooleanValue();

  FDBFuture *f = fdb_transaction_get(GetTransactionFromArgs(info), key.str, key.len, snapshot);

  info.GetReturnValue().Set(futureToJS(f, info[2], getValue));
}

/*
 * This function takes a KeySelector and returns a future.
 */
// GetKey(key, selOrEq, offset, isSnapshot, [cb])
void Transaction::GetKey(const FunctionCallbackInfo<Value>& info) {
  StringParams key(info[0]);
  bool selectorOrEqual = info[1]->BooleanValue();
  int selectorOffset = info[2]->Int32Value();
  bool snapshot = info[3]->BooleanValue();

  FDBFuture *f = fdb_transaction_get_key(GetTransactionFromArgs(info), key.str, key.len, (fdb_bool_t)selectorOrEqual, selectorOffset, snapshot);

  info.GetReturnValue().Set(futureToJS(f, info[4], getKey));
}

// set(key, val). Syncronous.
void Transaction::Set(const FunctionCallbackInfo<Value>& info){
  StringParams key(info[0]);
  StringParams val(info[1]);
  fdb_transaction_set(GetTransactionFromArgs(info), key.str, key.len, val.str, val.len);
}

// Delete value stored for key.
// clear("somekey")
void Transaction::Clear(const FunctionCallbackInfo<Value>& info) {
  StringParams key(info[0]);
  fdb_transaction_clear(GetTransactionFromArgs(info), key.str, key.len);
}

// atomicOp(key, operand key, mutationtype)
void Transaction::AtomicOp(const FunctionCallbackInfo<Value>& info) {
  StringParams key(info[0]);
  StringParams operand(info[1]);
  FDBMutationType operationType = (FDBMutationType)info[2]->Int32Value();

  fdb_transaction_atomic_op(GetTransactionFromArgs(info), key.str, key.len, operand.str, operand.len, operationType);
}

// getRange(
//   start, beginOrEqual, beginOffset,
//   end, endOrEqual, endOffset,
//   limit or 0, target_bytes or 0,
//   streamingMode, iteration,
//   snapshot, reverse,
//   [cb]
// )
void Transaction::GetRange(const FunctionCallbackInfo<Value>& info) {
  StringParams start(info[0]);
  int startOrEqual = info[1]->BooleanValue();
  int startOffset = info[2]->Int32Value();

  StringParams end(info[3]);
  int endOrEqual = info[4]->BooleanValue();
  int endOffset = info[5]->Int32Value();

  int limit = info[6]->Int32Value();
  int target_bytes = info[7]->Int32Value();
  FDBStreamingMode mode = (FDBStreamingMode)info[8]->Int32Value();
  int iteration = info[9]->Int32Value();
  bool snapshot = info[10]->BooleanValue();
  bool reverse = info[11]->BooleanValue();

  FDBFuture *f = fdb_transaction_get_range(GetTransactionFromArgs(info),
    start.str, start.len, (fdb_bool_t)startOrEqual, startOffset,
    end.str, end.len, (fdb_bool_t)endOrEqual, endOffset,
    limit, target_bytes,
    mode, iteration,
    snapshot, reverse);

  info.GetReturnValue().Set(futureToJS(f, info[12], getKeyValueList));
}



// clearRange(start, end). Clears range [start, end).
void Transaction::ClearRange(const FunctionCallbackInfo<Value>& info) {
  StringParams begin(info[0]);
  StringParams end(info[1]);
  fdb_transaction_clear_range(GetTransactionFromArgs(info), begin.str, begin.len, end.str, end.len);
}



// watch("somekey", listener) -> {cancel()}. This does not return a promise.
// Due to race conditions the listener may be called even after cancel has been called.
//
// TODO: Move this over to the new infrastructure.
void Transaction::Watch(const FunctionCallbackInfo<Value>& info) {
  StringParams key(info[0]);

  Isolate *isolate = Isolate::GetCurrent();
  FDBTransaction *tr = GetTransactionFromArgs(info);

  Local<Function> listener = Local<Function>::New(isolate, Local<Function>::Cast(info[1]));

  FDBFuture *f = fdb_transaction_watch(tr, key.str, key.len);

  Local<Value> watch = watchFuture(f, listener);
  info.GetReturnValue().Set(watch);
}




// addConflictRange(start, end)
void Transaction::AddReadConflictRange(const FunctionCallbackInfo<Value>& info) {
  AddConflictRange(info, FDB_CONFLICT_RANGE_TYPE_READ);
}

// addConflictRange(start, end)
void Transaction::AddWriteConflictRange(const FunctionCallbackInfo<Value>& info) {
  AddConflictRange(info, FDB_CONFLICT_RANGE_TYPE_WRITE);
}


// setReadVersion(version)
void Transaction::SetReadVersion(const FunctionCallbackInfo<Value>& info) {
  // The version parameter must be an 8 byte buffer.
  auto obj = info[0]->ToObject();
  if (Buffer::Length(obj) != 8) {
    // TODO: Also check that it is a buffer. I have no idea how to check that.
    Nan::ThrowTypeError("Invalid version buffer - must be 8 bytes");
    return;
  }

  uint8_t* data = (uint8_t*)(Buffer::Data(obj));
  int64_t version = (int64_t)BEBytesToInt64(data);
  fdb_transaction_set_read_version(GetTransactionFromArgs(info), version);
}

void Transaction::GetReadVersion(const FunctionCallbackInfo<Value>& info) {
  FDBFuture *f = fdb_transaction_get_read_version(GetTransactionFromArgs(info));
  info.GetReturnValue().Set(futureToJS(f, info[0], getVersion));
}

void Transaction::GetCommittedVersion(const FunctionCallbackInfo<Value>& info) {
  int64_t version;
  fdb_error_t errorCode = fdb_transaction_get_committed_version(GetTransactionFromArgs(info), &version);

  if(errorCode != 0) {
    return Nan::ThrowError(FdbError::NewInstance(errorCode));
  }

  // Again, if we change version to be a byte array this will need to change too.
  info.GetReturnValue().Set(versionToJSBuffer(version));
}

void Transaction::GetVersionStamp(const FunctionCallbackInfo<Value>& info) {
  FDBFuture *f = fdb_transaction_get_versionstamp(GetTransactionFromArgs(info));
  info.GetReturnValue().Set(futureToJS(f, info[0], getKey));
}

// getAddressesForKey("somekey", [cb])
void Transaction::GetAddressesForKey(const FunctionCallbackInfo<Value>& info) {
  StringParams key(info[0]);

  FDBFuture *f = fdb_transaction_get_addresses_for_key(GetTransactionFromArgs(info), key.str, key.len);
  info.GetReturnValue().Set(futureToJS(f, info[1], getStringArray));
}






// Not exposed to JS. Simple wrapper. Call AddReadConflictRange / AddWriteConflictRange.
void Transaction::AddConflictRange(const FunctionCallbackInfo<Value>& info, FDBConflictRangeType type) {
  StringParams start(info[0]);
  StringParams end(info[1]);

  fdb_error_t errorCode = fdb_transaction_add_conflict_range(GetTransactionFromArgs(info), start.str, start.len, end.str, end.len, type);

  if(errorCode) Nan::ThrowError(FdbError::NewInstance(errorCode));
}









void Transaction::New(const FunctionCallbackInfo<Value>& info) {
  Transaction *tr = new Transaction();
  tr->Wrap(info.Holder());
}

Local<Value> Transaction::NewInstance(FDBTransaction *ptr) {
  Isolate *isolate = Isolate::GetCurrent();
  Nan::EscapableHandleScope scope;

  Local<Function> transactionConstructor = Local<Function>::New(isolate, constructor);
  Local<Object> instance = Nan::NewInstance(transactionConstructor).ToLocalChecked();

  Transaction *trObj = ObjectWrap::Unwrap<Transaction>(instance);
  trObj->tr = ptr;

  return scope.Escape(instance);
}

void Transaction::Init() {
  Isolate *isolate = Isolate::GetCurrent();
  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New);

  tpl->SetClassName(Nan::New<v8::String>("Transaction").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "setOption", SetOption);

  NODE_SET_PROTOTYPE_METHOD(tpl, "commit", Commit);
  NODE_SET_PROTOTYPE_METHOD(tpl, "reset", Reset);
  NODE_SET_PROTOTYPE_METHOD(tpl, "cancel", Cancel);
  NODE_SET_PROTOTYPE_METHOD(tpl, "onError", OnError);

  NODE_SET_PROTOTYPE_METHOD(tpl, "get", Get);
  NODE_SET_PROTOTYPE_METHOD(tpl, "getKey", GetKey);
  NODE_SET_PROTOTYPE_METHOD(tpl, "set", Set);
  NODE_SET_PROTOTYPE_METHOD(tpl, "clear", Clear);

  NODE_SET_PROTOTYPE_METHOD(tpl, "atomicOp", AtomicOp);

  NODE_SET_PROTOTYPE_METHOD(tpl, "getRange", GetRange);
  NODE_SET_PROTOTYPE_METHOD(tpl, "clearRange", ClearRange);

  NODE_SET_PROTOTYPE_METHOD(tpl, "watch", Watch);

  NODE_SET_PROTOTYPE_METHOD(tpl, "addReadConflictRange", AddReadConflictRange);
  NODE_SET_PROTOTYPE_METHOD(tpl, "addWriteConflictRange", AddWriteConflictRange);

  NODE_SET_PROTOTYPE_METHOD(tpl, "getReadVersion", GetReadVersion);
  NODE_SET_PROTOTYPE_METHOD(tpl, "setReadVersion", SetReadVersion);
  NODE_SET_PROTOTYPE_METHOD(tpl, "getCommittedVersion", GetCommittedVersion);
  NODE_SET_PROTOTYPE_METHOD(tpl, "getVersionStamp", GetVersionStamp);

  NODE_SET_PROTOTYPE_METHOD(tpl, "getAddressesForKey", GetAddressesForKey);

  constructor.Reset(tpl->GetFunction());
}

