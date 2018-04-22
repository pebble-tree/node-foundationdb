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

#ifndef FDB_NODE_TRANSACTION_H
#define FDB_NODE_TRANSACTION_H

#include "Version.h"

#include <foundationdb/fdb_c.h>
#include <node.h>

#include "NodeCallback.h"

class Transaction: public node::ObjectWrap {
  public:
    static void Init();
    static v8::Local<v8::Value> NewInstance(FDBTransaction *ptr);
    static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void SetOption(const Nan::FunctionCallbackInfo<v8::Value>& info);

    // Lifecycle methods.
    static void Commit(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void Reset(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void Cancel(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void OnError(const Nan::FunctionCallbackInfo<v8::Value>& info);

    // Basic kv interaction
    static void Get(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void GetKey(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void Set(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void Clear(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void AtomicOp(const Nan::FunctionCallbackInfo<v8::Value>& info);

    // Fancy kv interaction
    static void GetRange(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void ClearRange(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void Watch(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void AddReadConflictRange(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void AddWriteConflictRange(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void SetReadVersion(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void GetReadVersion(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void GetCommittedVersion(const Nan::FunctionCallbackInfo<v8::Value>& info);
    static void GetVersionStamp(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void GetAddressesForKey(const Nan::FunctionCallbackInfo<v8::Value>& info);




    FDBTransaction* GetTransaction() { return tr; }
  private:
    Transaction();
    ~Transaction();

    static Nan::Persistent<v8::Function> constructor;
    FDBTransaction *tr;

    static void AddConflictRange(const Nan::FunctionCallbackInfo<v8::Value>& info, FDBConflictRangeType type);
    static FDBTransaction* GetTransactionFromArgs(const Nan::FunctionCallbackInfo<v8::Value>& info);
};

class Watch : public node::ObjectWrap {
  public:
    static void Init();

    static v8::Local<v8::Value> NewInstance(NodeCallback *callback);
    static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);

    static void Cancel(const Nan::FunctionCallbackInfo<v8::Value>& info);

  private:
    Watch();
    ~Watch();

    static Nan::Persistent<v8::Function> constructor;
    NodeCallback *callback;
};

#endif
