#include <node_api.h>
#if defined(NAPI_VERSION) && NAPI_VERSION >= 4
#include "napi/database.cpp"
#else
#include "nan/Database.cpp"
#endif
