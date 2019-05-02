#include "utils.h"
#include <cstdio>
#include <cassert>

napi_status throw_if_not_ok(napi_env env, napi_status status) {
  switch (status) {
    case napi_ok: case napi_pending_exception:
      return status;
    case napi_number_expected:
      napi_throw_type_error(env, NULL, "Expected number");
      return napi_pending_exception;
    case napi_string_expected:
      napi_throw_type_error(env, NULL, "Expected string");
      return napi_pending_exception;
    default:
      fprintf(stderr, "throw_if_not_ok %d", status);
      assert(0);
  }
}

napi_status wrap_fdb_error(napi_env env, fdb_error_t fdbErrCode, napi_value* result) {
  napi_value errCode;
  NAPI_OK_OR_RETURN_STATUS(env, napi_create_int32(env, fdbErrCode, &errCode));
  napi_value errStr;
  NAPI_OK_OR_RETURN_STATUS(env, napi_create_string_utf8(env, fdb_get_error(fdbErrCode), NAPI_AUTO_LENGTH, &errStr));
  NAPI_OK_OR_RETURN_STATUS(env, napi_create_error(env, NULL, errStr, result));

  // TODO: This isn't the same as the old code, since it won't allow err instanceof fdbErrCode to work.
  NAPI_OK_OR_RETURN_STATUS(env, napi_set_named_property(env, *result, "fdb_errcode", errCode));
  return napi_ok;
}

void throw_fdb_error(napi_env env, fdb_error_t fdbErrCode) {
  napi_value error;
  if (throw_if_not_ok(env, wrap_fdb_error(env, fdbErrCode, &error)) == napi_pending_exception) return; 
  throw_if_not_ok(env, napi_throw(env, error));
  // There'll be a pending exception after this no matter what. No need to return a status code.
}
