// Fixed vendor-app presence and launch bridge. No process ID, arbitrary path,
// arbitrary URL, termination, Accessibility, or AppleEvents API is exposed.
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <node_api.h>
#include <pthread.h>
#include <string>

static NSString *ProviderBundle(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype type;
  if (argc != 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_string) {
    napi_throw_error(env, "INVALID_PROVIDER", "Unsupported plugin host."); return nil;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) != napi_ok || length > 16) {
    napi_throw_error(env, "INVALID_PROVIDER", "Unsupported plugin host."); return nil;
  }
  char text[17] = {};
  napi_get_value_string_utf8(env, argv[0], text, sizeof(text), &length);
  std::string provider(text, length);
  if (provider == "zcode") return @"dev.zcode.app";
  if (provider == "workbuddy") return @"com.tencent.workbuddy.mac";
  napi_throw_error(env, "INVALID_PROVIDER", "Unsupported plugin host."); return nil;
}
static void SetBool(napi_env env, napi_value object, const char *key, bool flag) {
  napi_value value; napi_get_boolean(env, flag, &value); napi_set_named_property(env, object, key, value);
}
static NSURL *InstalledURL(NSString *bundleID) {
  NSURL *url = [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:bundleID];
  if (!url || ![url isFileURL]) return nil;
  BOOL directory = NO;
  if (![[NSFileManager defaultManager] fileExistsAtPath:[url path] isDirectory:&directory] || !directory) return nil;
  NSBundle *bundle = [NSBundle bundleWithURL:url];
  return [bundle.bundleIdentifier isEqualToString:bundleID] ? url : nil;
}
static napi_value Status(napi_env env, napi_callback_info info) {
  NSString *bundleID = ProviderBundle(env, info); if (!bundleID) return nullptr;
  if (!pthread_main_np()) { napi_throw_error(env, "HOST_STATUS_UNAVAILABLE", "Plugin host status is unavailable."); return nullptr; }
  @try {
    @autoreleasepool {
      const bool installed = InstalledURL(bundleID) != nil;
      const bool running = [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID].count > 0;
      napi_value result; napi_create_object(env, &result);
      SetBool(env, result, "known", true); SetBool(env, result, "installed", installed); SetBool(env, result, "running", running);
      return result;
    }
  } @catch (NSException *exception) {
    napi_throw_error(env, "HOST_STATUS_UNAVAILABLE", "Plugin host status is unavailable."); return nullptr;
  }
}
static napi_value Launch(napi_env env, napi_callback_info info) {
  NSString *bundleID = ProviderBundle(env, info); if (!bundleID) return nullptr;
  if (!pthread_main_np()) { napi_throw_error(env, "HOST_LAUNCH_UNAVAILABLE", "Plugin host launch is unavailable."); return nullptr; }
  @try {
    @autoreleasepool {
      NSURL *url = InstalledURL(bundleID);
      if (!url) { napi_throw_error(env, "HOST_NOT_INSTALLED", "The selected AI tool is not installed."); return nullptr; }
      NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
      configuration.activates = NO;
      [[NSWorkspace sharedWorkspace] openApplicationAtURL:url configuration:configuration completionHandler:^(NSRunningApplication *opened, NSError *error) {
        // This method only reports that a fixed-app open request was submitted.
        // Loading and task-event readiness are confirmed separately.
      }];
      napi_value result; napi_create_object(env, &result); SetBool(env, result, "requested", true); return result;
    }
  } @catch (NSException *exception) {
    napi_throw_error(env, "HOST_LAUNCH_UNAVAILABLE", "Plugin host launch is unavailable."); return nullptr;
  }
}
// Inspect only this process's sealed signature. No bundle path, identity,
// certificate, entitlement dictionary or filesystem grant leaves this bridge.
static napi_value SandboxCapabilities(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 0) { napi_throw_error(env, "SANDBOX_CAPABILITIES_UNAVAILABLE", "Sandbox capabilities are unavailable."); return nullptr; }
  SecCodeRef code = nullptr; CFDictionaryRef information = nullptr;
  const OSStatus selfStatus = SecCodeCopySelf(kSecCSDefaultFlags, &code);
  const OSStatus infoStatus = selfStatus == errSecSuccess && code
    ? SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information) : errSecParam;
  if (code) CFRelease(code);
  if (infoStatus != errSecSuccess || !information) {
    if (information) CFRelease(information);
    napi_throw_error(env, "SANDBOX_CAPABILITIES_UNAVAILABLE", "Sandbox capabilities are unavailable."); return nullptr;
  }
  CFTypeRef raw = CFDictionaryGetValue(information, kSecCodeInfoEntitlementsDict);
  if (raw && CFGetTypeID(raw) != CFDictionaryGetTypeID()) {
    CFRelease(information);
    napi_throw_error(env, "SANDBOX_CAPABILITIES_UNAVAILABLE", "Sandbox capabilities are unavailable."); return nullptr;
  }
  const CFDictionaryRef rights = raw ? static_cast<CFDictionaryRef>(raw) : nullptr;
  const auto enabled = [rights](CFStringRef key) -> bool {
    if (!rights) return false;
    CFTypeRef value = CFDictionaryGetValue(rights, key);
    return value && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(static_cast<CFBooleanRef>(value));
  };
  napi_value result; napi_create_object(env, &result);
  SetBool(env, result, "known", true);
  SetBool(env, result, "sandbox", enabled(CFSTR("com.apple.security.app-sandbox")));
  SetBool(env, result, "userSelectedReadWrite", enabled(CFSTR("com.apple.security.files.user-selected.read-write")));
  SetBool(env, result, "userSelectedExecutable", enabled(CFSTR("com.apple.security.files.user-selected.executable")));
  SetBool(env, result, "appScopeBookmarks", enabled(CFSTR("com.apple.security.files.bookmarks.app-scope")));
  CFRelease(information);
  return result;
}
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"launch", nullptr, Launch, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getSandboxCapabilities", nullptr, SandboxCapabilities, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 3, properties); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
