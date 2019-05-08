#include <node_api.h>
#if defined(NAPI_VERSION) && NAPI_VERSION >= 4
#include "napi/module.cpp"
#else
#include "nan/FdbV8Wrapper.cpp"
#endif
