#include <cstdio>

#include "Version.h"
#include <foundationdb/fdb_c.h>

#include "options.h"
#include "FdbError.h"

using namespace v8;

static fdb_error_t set_option(void *target, OptionType type, int code, uint8_t const* value, int length) {
  switch (type) {
    case OptNetwork: return fdb_network_set_option((FDBNetworkOption)code, value, length);
    // case OptCluster: return fdb_cluster_set_option((FDBCluster *)target, (FDBClusterOption)code, value, length);
    case OptDatabase: return fdb_database_set_option((FDBDatabase *)target, (FDBDatabaseOption)code, value, length);
    case OptTransaction: return fdb_transaction_set_option((FDBTransaction *)target, (FDBTransactionOption)code, value, length);
    //case OptTransaction: return fdb_transaction_set_option((FDBTransaction *)target, (FDBTransactionOption)code, value, length);
  }
}

void set_option_wrapped(void *target, OptionType type, const Nan::FunctionCallbackInfo<v8::Value>& args) {
  // For network options, target is ignored.
  // args should contain code, value.
  Isolate *isolate = args.GetIsolate();

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
    err = set_option(target, type, code, (const uint8_t *)&value, sizeof(value));

    printf("%d %lld\n", code, value);
  } else if (args[1]->IsNull()) {
    err = set_option(target, type, code, NULL, 0);
    printf("%d (null)\n", code);
  } else if (node::Buffer::HasInstance(args[1])) {
    uint8_t const *value = (uint8_t *)node::Buffer::Data(args[1]);
    int value_length = node::Buffer::Length(args[1]);
    err = set_option(target, type, code, value, value_length);

    printf("%d %s\n", code, value);
  } else {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Second argument not a buffer")));
    return;
  }

  if (err) {
    Nan::ThrowError(FdbError::NewInstance(err, fdb_get_error(err)));
    // return info.GetReturnValue().SetUndefined();
  }

  args.GetReturnValue().SetNull(); // Not sure that this is actually necessary.
}