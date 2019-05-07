#ifndef FDB_NODE_OPTIONS_H
#define FDB_NODE_OPTIONS_H

#include <nan.h>

enum OptionType {
  OptNetwork,
  OptDatabase,
  OptTransaction,
};

void set_option_wrapped(void *target, OptionType type, const v8::FunctionCallbackInfo<v8::Value>& args);

#endif