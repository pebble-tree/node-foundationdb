#include <node_api.h>
#if defined(NAPI_VERSION) && NAPI_VERSION >= 4
#include "napi/future.cpp"
#else
#include "nan/future.cpp"
#endif
