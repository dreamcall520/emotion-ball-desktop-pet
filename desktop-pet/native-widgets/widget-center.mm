#include <node_api.h>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>

extern "C" int32_t qiuqiu_widget_center_reload(const char *const *kinds, int32_t count);
extern "C" char *qiuqiu_widget_center_bundle_identifier(void);

static const char *const KnownKinds[] = {
  "QiuqiuNativeMonthProbe", "QiuqiuNativeDateProbe", "QiuqiuNativeWeekProbe",
  "QiuqiuNativeDaylightProbe", "QiuqiuNativeTimeProgressProbe", "QiuqiuNativeDualClockProbe",
  "QiuqiuNativeCompanionMonthProbe", "QiuqiuNativeCompanionDateProbe", "QiuqiuNativeCompanionPanelProbe",
  "QiuqiuNativeWeatherCardProbe", "QiuqiuNativeWeatherWeekProbe",
  "QiuqiuNativeTodoTodayProbe", "QiuqiuNativeTodoListProbe", "QiuqiuNativeNextReminderProbe",
  "QiuqiuNativeAccentTodoProbe", "QiuqiuNativeAccentOverviewProbe"
};
static napi_value Invalid(napi_env env) {
  napi_throw_type_error(env, "WIDGET_KINDS_INVALID", "Expected an array of at most 16 supported widget kinds.");
  return nullptr;
}
static napi_value Reload(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1) return Invalid(env);
  bool isArray = false; uint32_t length = 0;
  if (napi_is_array(env, args[0], &isArray) != napi_ok || !isArray ||
      napi_get_array_length(env, args[0], &length) != napi_ok || length > 16) return Invalid(env);
  std::vector<std::string> names;
  names.reserve(length);
  // Validate the entire array before issuing any reload.
  for (uint32_t index = 0; index < length; index++) {
    napi_value value; napi_valuetype type; size_t bytes = 0;
    if (napi_get_element(env, args[0], index, &value) != napi_ok ||
        napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
        napi_get_value_string_utf8(env, value, nullptr, 0, &bytes) != napi_ok || bytes == 0 || bytes > 128) return Invalid(env);
    std::vector<char> buffer(bytes + 1);
    size_t copied = 0;
    if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &copied) != napi_ok || copied != bytes) return Invalid(env);
    std::string name(buffer.data(), copied);
    bool known = false;
    for (const char *kind : KnownKinds) if (name == kind) { known = true; break; }
    if (!known) return Invalid(env);
    if (std::find(names.begin(), names.end(), name) == names.end()) names.push_back(std::move(name));
  }
  std::vector<const char *> pointers;
  pointers.reserve(names.size());
  for (const auto &name : names) pointers.push_back(name.c_str());
  const int32_t count = qiuqiu_widget_center_reload(pointers.data(), static_cast<int32_t>(pointers.size()));
  if (count < 0) { napi_throw_error(env, "WIDGET_RELOAD_UNAVAILABLE", "Widget refresh is unavailable."); return nullptr; }
  napi_value result; napi_create_int32(env, count, &result); return result;
}
static napi_value BundleIdentifier(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 0) {
    napi_throw_type_error(env, "WIDGET_ARGUMENT_INVALID", "bundleIdentifier takes no arguments."); return nullptr;
  }
  char *identifier = qiuqiu_widget_center_bundle_identifier();
  napi_value result;
  if (identifier) { napi_create_string_utf8(env, identifier, NAPI_AUTO_LENGTH, &result); std::free(identifier); }
  else napi_get_null(env, &result);
  return result;
}
static napi_value Initialize(napi_env env, napi_value exports) {
  napi_value reload, identifier;
  napi_create_function(env, "reload", NAPI_AUTO_LENGTH, Reload, nullptr, &reload);
  napi_create_function(env, "bundleIdentifier", NAPI_AUTO_LENGTH, BundleIdentifier, nullptr, &identifier);
  napi_set_named_property(env, exports, "reload", reload);
  napi_set_named_property(env, exports, "bundleIdentifier", identifier);
  return exports;
}
NAPI_MODULE(widget_center, Initialize)
