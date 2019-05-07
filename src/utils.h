// This is a few utility methods & macros to help interact with NAPI and FDB.

#ifndef UTILS_H
#define UTILS_H

#define NAPI_VERSION 4
#include <node_api.h>
#include <stdbool.h>
#include "fdbversion.h"
#include <foundationdb/fdb_c.h>

napi_status throw_if_not_ok(napi_env env, napi_status status);

typedef struct MaybeValue {
  napi_status status;
  napi_value value; // Only if status is napi_ok.
} MaybeValue;

inline MaybeValue wrap_ok(napi_value value) {
  return (MaybeValue) { napi_ok, value };
}
inline MaybeValue wrap_err(napi_status status) {
  return (MaybeValue) { status, NULL };
}
inline MaybeValue wrap_null() {
  return (MaybeValue) { napi_ok, NULL };
}

#define NAPI_OK_OR_RETURN_NULL(env, expr) do {\
  if (throw_if_not_ok(env, expr) != napi_ok) { return NULL; }\
} while (0)

#define NAPI_OK_OR_RETURN_STATUS(env, expr) do {\
  napi_status status = throw_if_not_ok(env, expr);\
  if (status != napi_ok) { return status; }\
} while (0)

#define NAPI_OK_OR_RETURN_MAYBE(env, expr) do {\
  napi_status status = throw_if_not_ok(env, expr);\
  if (status != napi_ok) { return wrap_err(status); }\
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

inline napi_status typeof_wrap(napi_env env, napi_value value, napi_valuetype* result) {
  if (value == NULL) {
    *result = napi_undefined;
    return napi_ok;
  } else {
    return napi_typeof(env, value, result);
  }
}
// inline napi_status is_nullish(napi_env env, napi_value value, bool* result) {
//   if (value == NULL) {
//     *result = true;
//     return napi_ok;
//   } else {
//     napi_valuetype type;
//     NAPI_OK_OR_RETURN_STATUS(env, napi_typeof(env, value, &type));
//     *result = type == napi_null || type == napi_undefined;
//     return napi_ok;
//   }
// }

#endif