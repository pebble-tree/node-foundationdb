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

#include "Transaction.h"
#include "NodeCallback.h"
#include "FdbError.h"
#include "FdbOptions.h"

using namespace v8;
using namespace std;
using namespace node;

// Transaction Implementation
Transaction::Transaction() { };

Transaction::~Transaction() {
	fdb_transaction_destroy(tr);
};

Nan::Persistent<Function> Transaction::constructor;

struct NodeValueCallback : NodeCallback {

	NodeValueCallback(FDBFuture *future, Local<Function> cbFunc) : NodeCallback(future, cbFunc) { }

	virtual Local<Value> extractValue(FDBFuture* future, fdb_error_t& outErr) {
		Isolate *isolate = Isolate::GetCurrent();
		Nan::EscapableHandleScope scope;

		const char *value;
		int valueLength;
		int valuePresent;

		outErr = fdb_future_get_value(future, &valuePresent, (const uint8_t**)&value, &valueLength);
		if (outErr) return Undefined(isolate);

		Local<Value> jsValue;

		if(!valuePresent)
			jsValue = Local<Value>::New(isolate, Null(isolate));
		else
			jsValue = Local<Value>::New(isolate, makeBuffer(value, valueLength));

		return scope.Escape(jsValue);
	}
};

struct NodeKeyCallback : NodeCallback {

	NodeKeyCallback(FDBFuture *future, Local<Function> cbFunc) : NodeCallback(future, cbFunc) { }

	virtual Local<Value> extractValue(FDBFuture* future, fdb_error_t& outErr) {
		Isolate *isolate = Isolate::GetCurrent();
		Nan::EscapableHandleScope scope;

		const char *key;
		int keyLength;

		outErr = fdb_future_get_key(future, (const uint8_t**)&key, &keyLength);
		if (outErr) return Undefined(isolate);

		Local<Value> jsValue = Local<Value>::New(isolate, makeBuffer(key, keyLength));

		return scope.Escape(jsValue);
	}
};

struct NodeVoidCallback : NodeCallback {

	NodeVoidCallback(FDBFuture *future, Local<Function> cbFunc) : NodeCallback(future, cbFunc) { }

	virtual Local<Value> extractValue(FDBFuture* future, fdb_error_t& outErr) {
		Isolate *isolate = Isolate::GetCurrent();
		outErr = fdb_future_get_error(future);
		return Undefined(isolate);
	}
};

struct NodeKeyValueCallback : NodeCallback {

	NodeKeyValueCallback(FDBFuture *future, Local<Function> cbFunc) : NodeCallback(future, cbFunc) { }

	virtual Local<Value> extractValue(FDBFuture* future, fdb_error_t& outErr) {
		Isolate *isolate = Isolate::GetCurrent();
		Nan::EscapableHandleScope scope;

		const FDBKeyValue *kv;
		int len;
		fdb_bool_t more;

		outErr = fdb_future_get_keyvalue_array(future, &kv, &len, &more);
		if (outErr) return Undefined(isolate);

		/*
		 * Constructing a JavaScript array of KeyValue objects:
		 *  {
		 *  	key: "some key",
		 *  	value: "some value"
		 *  }
		 *
		 */

		Local<Object> returnObj = Local<Object>::New(isolate, Object::New(isolate));
		Local<Array> jsValueArray = Array::New(isolate, len);

		Local<String> keySymbol = String::NewFromUtf8(isolate, "key", String::kInternalizedString);
		Local<String> valueSymbol = String::NewFromUtf8(isolate, "value", String::kInternalizedString);

		for(int i = 0; i < len; i++) {
			Local<Object> jsKeyValue = Object::New(isolate);

			Local<Value> jsKeyBuffer = makeBuffer((const char*)kv[i].key, kv[i].key_length);
			Local<Value> jsValueBuffer = makeBuffer((const char*)kv[i].value, kv[i].value_length);

			jsKeyValue->Set(keySymbol, jsKeyBuffer);
			jsKeyValue->Set(valueSymbol, jsValueBuffer);
			jsValueArray->Set(Number::New(isolate, i), jsKeyValue);
		}

		returnObj->Set(String::NewFromUtf8(isolate, "array", String::kInternalizedString), jsValueArray);
		if(more)
			returnObj->Set(String::NewFromUtf8(isolate, "more", String::kInternalizedString), Number::New(isolate, 1));

		return scope.Escape(returnObj);
	}
};

struct NodeVersionCallback : NodeCallback {

	NodeVersionCallback(FDBFuture *future, Local<Function> cbFunc) : NodeCallback(future, cbFunc) { }

	virtual Local<Value> extractValue(FDBFuture* future, fdb_error_t& outErr) {
		Isolate *isolate = Isolate::GetCurrent();
		Nan::EscapableHandleScope scope;

		int64_t version;

		outErr = fdb_future_get_version(future, &version);
		if (outErr) return Undefined(isolate);

		//SOMEDAY: This limits the version to 53-bits.  Do something different here?
		Local<Value> jsValue = Local<Value>::New(isolate, Number::New(isolate, (double)version));

		return scope.Escape(jsValue);
	}
};

struct NodeStringArrayCallback : NodeCallback {

	NodeStringArrayCallback(FDBFuture *future, Local<Function> cbFunc) : NodeCallback(future, cbFunc) { }

	virtual Local<Value> extractValue(FDBFuture *future, fdb_error_t& outErr) {
		Isolate *isolate = Isolate::GetCurrent();
		Nan::EscapableHandleScope scope;

		const char **strings;
		int stringCount;

		outErr = fdb_future_get_string_array(future, &strings, &stringCount);
		if (outErr) return Undefined(isolate);

		Local<Array> jsArray = Local<Array>::New(isolate, Array::New(isolate, stringCount));
		for(int i = 0; i < stringCount; i++)
			jsArray->Set(Number::New(isolate, i), makeBuffer(strings[i], (int)strlen(strings[i])));

		return scope.Escape(jsArray);
	}
};

struct StringParams {
	uint8_t *str;
	int len;

	/*
	 *  String arguments always have to be buffers to
	 *  preserve bytes. Otherwise, stuff gets converted
	 *  to UTF-8.
	 */
	StringParams(Local<Value> keyVal) {
		str = (uint8_t*)(Buffer::Data(keyVal->ToObject()));
		len = (int)Buffer::Length(keyVal->ToObject());
	}
};

FDBTransaction* Transaction::GetTransactionFromArgs(const Nan::FunctionCallbackInfo<Value>& info) {
	return node::ObjectWrap::Unwrap<Transaction>(info.Holder())->tr;
}

Local<Function> Transaction::GetCallback(Local<Value> funcVal) {
	Isolate *isolate = Isolate::GetCurrent();
	Nan::EscapableHandleScope scope;
	Local<Function> callback = Local<Function>::New(isolate, Local<Function>::Cast(funcVal));
	return scope.Escape(callback);
}

void Transaction::Set(const Nan::FunctionCallbackInfo<Value>& info){
	StringParams key(info[0]);
	StringParams val(info[1]);
	fdb_transaction_set(GetTransactionFromArgs(info), key.str, key.len, val.str, val.len);

	info.GetReturnValue().SetNull();
}

void Transaction::Commit(const Nan::FunctionCallbackInfo<Value>& info) {
	FDBFuture *f = fdb_transaction_commit(GetTransactionFromArgs(info));
	(new NodeVoidCallback(f, GetCallback(info[0])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::Clear(const Nan::FunctionCallbackInfo<Value>& info) {
	StringParams key(info[0]);
	fdb_transaction_clear(GetTransactionFromArgs(info), key.str, key.len);

	info.GetReturnValue().SetNull();
}

/*
 * ClearRange takes two key strings.
 */
void Transaction::ClearRange(const Nan::FunctionCallbackInfo<Value>& info) {
	StringParams begin(info[0]);
	StringParams end(info[1]);
	fdb_transaction_clear_range(GetTransactionFromArgs(info), begin.str, begin.len, end.str, end.len);

	info.GetReturnValue().SetNull();
}

/*
 * This function takes a KeySelector and returns a future.
 */
void Transaction::GetKey(const Nan::FunctionCallbackInfo<Value>& info) {
	StringParams key(info[0]);
	int selectorOrEqual = info[1]->Int32Value();
	int selectorOffset = info[2]->Int32Value();
	bool snapshot = info[3]->BooleanValue();

	FDBFuture *f = fdb_transaction_get_key(GetTransactionFromArgs(info), key.str, key.len, (fdb_bool_t)selectorOrEqual, selectorOffset, snapshot);
	(new NodeKeyCallback(f, GetCallback(info[4])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::Get(const Nan::FunctionCallbackInfo<Value>& info) {
	StringParams key(info[0]);
	bool snapshot = info[1]->BooleanValue();

	FDBFuture *f = fdb_transaction_get(GetTransactionFromArgs(info), key.str, key.len, snapshot);
	(new NodeValueCallback(f, GetCallback(info[2])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::GetRange(const Nan::FunctionCallbackInfo<Value>& info) {
	StringParams start(info[0]);
	int startOrEqual = info[1]->Int32Value();
	int startOffset = info[2]->Int32Value();

	StringParams end(info[3]);
	int endOrEqual = info[4]->Int32Value();
	int endOffset = info[5]->Int32Value();

	int limit = info[6]->Int32Value();
	FDBStreamingMode mode = (FDBStreamingMode)info[7]->Int32Value();
	int iteration = info[8]->Int32Value();
	bool snapshot = info[9]->BooleanValue();
	bool reverse = info[10]->BooleanValue();

	FDBFuture *f = fdb_transaction_get_range(GetTransactionFromArgs(info), start.str, start.len, (fdb_bool_t)startOrEqual, startOffset,
												end.str, end.len, (fdb_bool_t)endOrEqual, endOffset, limit, 0, mode, iteration, snapshot, reverse);

	(new NodeKeyValueCallback(f, GetCallback(info[11])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::Watch(const Nan::FunctionCallbackInfo<Value>& info) {
	Isolate *isolate = Isolate::GetCurrent();
	Transaction *trPtr = node::ObjectWrap::Unwrap<Transaction>(info.Holder());

	uint8_t *keyStr = (uint8_t*)(Buffer::Data(info[0]->ToObject()));
	int keyLen = (int)Buffer::Length(info[0]->ToObject());

	Local<Function> cb = Local<Function>::New(isolate, Local<Function>::Cast(info[1]));

	FDBFuture *f = fdb_transaction_watch(trPtr->tr, keyStr, keyLen);
	NodeVoidCallback *callback = new NodeVoidCallback(f, cb);
	Local<Value> watch = Watch::NewInstance(callback);

	callback->start();
	info.GetReturnValue().Set(watch);
}

void Transaction::AddConflictRange(const Nan::FunctionCallbackInfo<Value>& info, FDBConflictRangeType type) {
	StringParams start(info[0]);
	StringParams end(info[1]);

	fdb_error_t errorCode = fdb_transaction_add_conflict_range(GetTransactionFromArgs(info), start.str, start.len, end.str, end.len, type);

	if(errorCode != 0)
		return Nan::ThrowError(FdbError::NewInstance(errorCode, fdb_get_error(errorCode)));

	info.GetReturnValue().SetNull();
}

void Transaction::AddReadConflictRange(const Nan::FunctionCallbackInfo<Value>& info) {
	return AddConflictRange(info, FDB_CONFLICT_RANGE_TYPE_READ);
}

void Transaction::AddWriteConflictRange(const Nan::FunctionCallbackInfo<Value>& info) {
	return AddConflictRange(info, FDB_CONFLICT_RANGE_TYPE_WRITE);
}

void Transaction::OnError(const Nan::FunctionCallbackInfo<Value>& info) {
	fdb_error_t errorCode = info[0]->Int32Value();
	FDBFuture *f = fdb_transaction_on_error(GetTransactionFromArgs(info), errorCode);
	(new NodeVoidCallback(f, GetCallback(info[1])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::Reset(const Nan::FunctionCallbackInfo<Value>& info) {
	fdb_transaction_reset(GetTransactionFromArgs(info));

	info.GetReturnValue().SetNull();
}

void Transaction::SetReadVersion(const Nan::FunctionCallbackInfo<Value>& info) {
	int64_t version = info[0]->IntegerValue();
	fdb_transaction_set_read_version(GetTransactionFromArgs(info), version);

	info.GetReturnValue().SetNull();
}

void Transaction::GetReadVersion(const Nan::FunctionCallbackInfo<Value>& info) {
	FDBFuture *f = fdb_transaction_get_read_version(GetTransactionFromArgs(info));
	(new NodeVersionCallback(f, GetCallback(info[0])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::GetCommittedVersion(const Nan::FunctionCallbackInfo<Value>& info) {
	int64_t version;
	fdb_error_t errorCode = fdb_transaction_get_committed_version(GetTransactionFromArgs(info), &version);

	if(errorCode != 0)
		return Nan::ThrowError(FdbError::NewInstance(errorCode, fdb_get_error(errorCode)));

	info.GetReturnValue().Set((double)version);
}

void Transaction::Cancel(const Nan::FunctionCallbackInfo<Value>& info) {
	fdb_transaction_cancel(GetTransactionFromArgs(info));

	info.GetReturnValue().SetNull();
}

void Transaction::GetAddressesForKey(const Nan::FunctionCallbackInfo<Value>& info) {
	StringParams key(info[0]);

	FDBFuture *f = fdb_transaction_get_addresses_for_key(GetTransactionFromArgs(info), key.str, key.len);
	(new NodeStringArrayCallback(f, GetCallback(info[1])))->start();

	info.GetReturnValue().SetNull();
}

void Transaction::New(const Nan::FunctionCallbackInfo<Value>& info) {
	Transaction *tr = new Transaction();
	tr->Wrap(info.Holder());
}

Local<Value> Transaction::NewInstance(FDBTransaction *ptr) {
	Isolate *isolate = Isolate::GetCurrent();
	Nan::EscapableHandleScope scope;

	Local<Function> transactionConstructor = Local<Function>::New(isolate, constructor);
	Local<Object> instance = transactionConstructor->NewInstance();

	Transaction *trObj = ObjectWrap::Unwrap<Transaction>(instance);
	trObj->tr = ptr;

	instance->Set(String::NewFromUtf8(isolate, "options", String::kInternalizedString), FdbOptions::CreateOptions(FdbOptions::TransactionOption, instance));

	return scope.Escape(instance);
}

void Transaction::Init() {
	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);

	tpl->SetClassName(Nan::New<v8::String>("Transaction").ToLocalChecked());
	tpl->InstanceTemplate()->SetInternalFieldCount(1);

	Nan::SetPrototypeMethod(tpl, "get", Get);
	Nan::SetPrototypeMethod(tpl, "getRange", GetRange);
	Nan::SetPrototypeMethod(tpl, "getKey", GetKey);
	Nan::SetPrototypeMethod(tpl, "watch", Watch);
	Nan::SetPrototypeMethod(tpl, "set", Set);
	Nan::SetPrototypeMethod(tpl, "commit", Commit);
	Nan::SetPrototypeMethod(tpl, "clear", Clear);
	Nan::SetPrototypeMethod(tpl, "clearRange", ClearRange);
	Nan::SetPrototypeMethod(tpl, "addReadConflictRange", AddReadConflictRange);
	Nan::SetPrototypeMethod(tpl, "addWriteConflictRange", AddWriteConflictRange);
	Nan::SetPrototypeMethod(tpl, "onError", OnError);
	Nan::SetPrototypeMethod(tpl, "reset", Reset);
	Nan::SetPrototypeMethod(tpl, "getReadVersion", GetReadVersion);
	Nan::SetPrototypeMethod(tpl, "setReadVersion", SetReadVersion);
	Nan::SetPrototypeMethod(tpl, "getCommittedVersion", GetCommittedVersion);
	Nan::SetPrototypeMethod(tpl, "cancel", Cancel);
	Nan::SetPrototypeMethod(tpl, "getAddressesForKey", GetAddressesForKey);

	constructor.Reset(tpl->GetFunction());
}

// Watch implementation
Watch::Watch() : callback(NULL) { };

Watch::~Watch() {
	if(callback) {
		if(callback->getFuture())
			fdb_future_cancel(callback->getFuture());

		callback->delRef();
	}
};

Nan::Persistent<Function> Watch::constructor;

Local<Value> Watch::NewInstance(NodeCallback *callback) {
	Isolate *isolate = Isolate::GetCurrent();
	Nan::EscapableHandleScope scope;

	Local<Function> watchConstructor = Local<Function>::New(isolate, constructor);
	Local<Object> instance = watchConstructor->NewInstance();

	Watch *watchObj = ObjectWrap::Unwrap<Watch>(instance);
	watchObj->callback = callback;
	callback->addRef();

	return scope.Escape(instance);
}

void Watch::New(const Nan::FunctionCallbackInfo<Value>& info) {
	Watch *c = new Watch();
	c->Wrap(info.Holder());
}

void Watch::Cancel(const Nan::FunctionCallbackInfo<Value>& info) {
	NodeCallback *callback = node::ObjectWrap::Unwrap<Watch>(info.Holder())->callback;

	if(callback && callback->getFuture())
		fdb_future_cancel(callback->getFuture());

	info.GetReturnValue().SetNull();
}

void Watch::Init() {
	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);

	tpl->SetClassName(Nan::New<v8::String>("Watch").ToLocalChecked());
	tpl->InstanceTemplate()->SetInternalFieldCount(1);

	Nan::SetPrototypeMethod(tpl, "cancel", Cancel);

	constructor.Reset(tpl->GetFunction());
}
