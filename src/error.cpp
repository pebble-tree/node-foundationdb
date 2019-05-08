#include <node_api.h>
#if defined(NAPI_VERSION) && NAPI_VERSION >= 4
#include "napi/error.cpp"
#else
#include "nan/FdbError.cpp"
#endif
