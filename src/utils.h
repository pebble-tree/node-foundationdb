// This is a few utility methods & macros to help interact with NAPI and FDB.

#ifndef UTILS_H
#define UTILS_H

#define NAPI_VERSION 3
#include <node_api.h>

#include "fdbversion.h"
#include <foundationdb/fdb_c.h>

napi_status throw_if_not_ok(napi_env env, napi_status status);

#define NAPI_OK_OR_RETURN_NULL(env, expr) do {\
  if (throw_if_not_ok(env, expr) != napi_ok) { return NULL; }\
} while (0)
#define NAPI_OK_OR_RETURN_STATUS(env, expr) do {\
  napi_status status = throw_if_not_ok(env, expr);\
  if (status != napi_ok) { return status; }\
} while (0)

napi_status wrap_fdb_error(napi_env env, fdb_error_t fdbErrCode, napi_value* result);

void throw_fdb_error(napi_env env, fdb_error_t fdbErrCode);

#define CHECKED_FDB(env, expr) do {\
  fdb_error_t code = expr;\
  if (code != 0) {\
    throw_fdb_error(env, code);\
    return NULL;\
  }\
} while (0)

#define FN_DEF(fn) {#fn, NULL, fn, NULL, NULL, NULL, napi_default, NULL}

#endif