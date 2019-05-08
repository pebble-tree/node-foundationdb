#include <node_api.h>
#if defined(NAPI_VERSION) && NAPI_VERSION >= 4
#include "napi/cluster.cpp"
#else
#include "nan/Cluster.cpp"
#endif
