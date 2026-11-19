// Core Location runs inside the signed Electron app, never in an external helper.
#import <Foundation/Foundation.h>
#import <CoreLocation/CoreLocation.h>
#import <AppKit/NSApplication.h>
#include <node_api.h>
#include <pthread.h>
#include <cmath>
#include <chrono>
#include <memory>
#include <string>

struct SafeLocationDiagnostic {
  bool mainThread = false, servicesEnabled = false, locationStarted = false, timedOut = false, appActive = false, finished = false;
  unsigned int authorizationCallbacks = 0, locationCallbacks = 0, receivedSamples = 0, staleSamples = 0, invalidSamples = 0, unknownFailures = 0;
  int nativeErrorCode = 0;
  const char *authorizationStatus = "unknown", *phase = nullptr;
  long long elapsedMs = 0, phaseElapsedMs = 0;
};
static SafeLocationDiagnostic diagnostic;
using DiagnosticClock = std::chrono::steady_clock;
static DiagnosticClock::time_point requestStartedAt, phaseStartedAt;
static void SetDiagnosticPhase(const char *phase) {
  diagnostic.phase = phase;
  phaseStartedAt = DiagnosticClock::now();
}
static void UpdateDiagnosticElapsed() {
  if (!diagnostic.phase || diagnostic.finished) return;
  const auto now = DiagnosticClock::now();
  diagnostic.elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - requestStartedAt).count();
  diagnostic.phaseElapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - phaseStartedAt).count();
}
static const NSTimeInterval kRequestTimeout = 15.0;
static const NSTimeInterval kAuthorizationTimeout = 120.0;
static const NSTimeInterval kGeocodeTimeout = 1.2;
static const char *StatusName(CLAuthorizationStatus status) {
  switch (status) {
    case kCLAuthorizationStatusNotDetermined: return "not-determined";
    case kCLAuthorizationStatusRestricted: return "restricted";
    case kCLAuthorizationStatusDenied: return "denied";
    case kCLAuthorizationStatusAuthorized: return "granted";
  }
  return "unknown";
}
static void SetNumber(napi_env env, napi_value object, const char *key, double number) {
  napi_value value;
  napi_create_double(env, number, &value);
  napi_set_named_property(env, object, key, value);
}
static napi_value ErrorValue(napi_env env, const char *code) {
  napi_value codeValue, message, error;
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &codeValue);
  napi_create_string_utf8(env, "System location is unavailable.", NAPI_AUTO_LENGTH, &message);
  napi_create_error(env, codeValue, message, &error);
  return error;
}


static napi_value DiagnosticValue(napi_env env, const SafeLocationDiagnostic &value) {
  napi_value result, authorization; napi_create_object(env, &result);
  napi_create_string_utf8(env, value.authorizationStatus, NAPI_AUTO_LENGTH, &authorization);
  napi_set_named_property(env, result, "locationAuthorization", authorization);
  for (const auto &field : {std::make_pair("locationMainThread", value.mainThread), std::make_pair("locationStarted", value.locationStarted), std::make_pair("locationAppActive", value.appActive)}) {
    napi_value flag; napi_get_boolean(env, field.second, &flag); napi_set_named_property(env, result, field.first, flag);
  }
  SetNumber(env, result, "locationAuthorizationCallbacks", value.authorizationCallbacks);
  if (value.phase) {
    napi_value phase;
    napi_create_string_utf8(env, value.phase, NAPI_AUTO_LENGTH, &phase);
    napi_set_named_property(env, result, "locationPhase", phase);
    SetNumber(env, result, "locationElapsedMs", value.elapsedMs);
    SetNumber(env, result, "locationPhaseElapsedMs", value.phaseElapsedMs);
  }
  SetNumber(env, result, "locationCallbacks", value.locationCallbacks);
  SetNumber(env, result, "locationUnknownFailures", value.unknownFailures);
  SetNumber(env, result, "locationSamplesRejected", value.staleSamples + value.invalidSamples);
  return result;
}

struct LocationResult {
  const char *errorCode;
  double latitude;
  double longitude;
  double accuracy;
  std::string name;
  std::string locationLabel;
  SafeLocationDiagnostic diagnostic;
};
struct PromiseContext { napi_deferred deferred; napi_ref promiseReference; };
static void DeletePromiseContext(napi_env env, void *data, void *hint) {
  // Release the opaque cancellation token on Node's finalizer queue, not a Cocoa delegate.
  auto *context = static_cast<PromiseContext *>(data);
  if (env && context->promiseReference) napi_delete_reference(env, context->promiseReference);
  delete context;
}
static void ResolveOnJsThread(napi_env env, napi_value callback, void *context, void *data) {
  std::unique_ptr<LocationResult> result(static_cast<LocationResult *>(data));
  // Node invokes this with env=null when shutting down; only release plain data then.
  if (!env || !context || !result) return;
  auto *promise = static_cast<PromiseContext *>(context);
  if (result->errorCode) {
    napi_value error = ErrorValue(env, result->errorCode);
    napi_set_named_property(env, error, "diagnostic", DiagnosticValue(env, result->diagnostic));
    napi_reject_deferred(env, promise->deferred, error);
  } else {
    napi_value value;
    if (napi_create_object(env, &value) != napi_ok) return;
    SetNumber(env, value, "latitude", result->latitude);
    SetNumber(env, value, "longitude", result->longitude);
    SetNumber(env, value, "accuracy", result->accuracy);
    napi_set_named_property(env, value, "diagnostic", DiagnosticValue(env, result->diagnostic));
    for (const auto &field : {std::make_pair("name", result->name), std::make_pair("locationLabel", result->locationLabel)}) {
      if (field.second.empty()) continue;
      napi_value text;
      napi_create_string_utf8(env, field.second.c_str(), field.second.size(), &text);
      napi_set_named_property(env, value, field.first, text);
    }
    napi_resolve_deferred(env, promise->deferred, value);
  }
}

@interface WeatherLocationRequest : NSObject <CLLocationManagerDelegate>
@property(nonatomic, strong) CLLocationManager *manager;
@property(nonatomic, strong) dispatch_source_t timer;
@property(nonatomic, strong) dispatch_source_t geocodeTimer;
@property(nonatomic, strong) CLGeocoder *geocoder;
@property(nonatomic, strong) CLLocation *resolvedLocation;
@property(nonatomic, copy) NSString *locationName;
@property(nonatomic, copy) NSString *locationLabel;
@property(nonatomic) napi_env env;
@property(nonatomic) napi_threadsafe_function completion;
@property(nonatomic) PromiseContext *promiseContext;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL started;
@property(nonatomic) BOOL requestedAuthorization;
- (void)start;
- (void)abandon;
@end

static WeatherLocationRequest *activeRequest = nil;
static NSString *CleanLocality(NSString *value) {
  if (![value isKindOfClass:[NSString class]]) return @"";
  NSString *clean = [[value componentsSeparatedByCharactersInSet:[NSCharacterSet controlCharacterSet]] componentsJoinedByString:@" "];
  clean = [clean stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  return clean.length > 80 ? [clean substringToIndex:80] : clean;
}

@implementation WeatherLocationRequest
- (void)finish:(CLLocation *)location error:(const char *)errorCode {
  if (self.completed) return;
  self.completed = YES;
  UpdateDiagnosticElapsed(); diagnostic.finished = true;
  diagnostic.timedOut = errorCode && std::string(errorCode) == "LOCATION_TIMEOUT";
  __attribute__((objc_precise_lifetime)) WeatherLocationRequest *keepAlive = self;
  [self.manager stopUpdatingLocation];
  self.manager.delegate = nil;
  if (self.timer) { dispatch_source_cancel(self.timer); self.timer = nil; }
  if (self.geocodeTimer) { dispatch_source_cancel(self.geocodeTimer); self.geocodeTimer = nil; }
  [self.geocoder cancelGeocode]; self.geocoder = nil;
  // Cocoa delegates publish one plain result; Promise resolution runs on Node's JS queue.
  auto *result = new LocationResult{errorCode,
    location ? location.coordinate.latitude : 0,
    location ? location.coordinate.longitude : 0,
    location ? location.horizontalAccuracy : 0,
    self.locationName ? std::string(self.locationName.UTF8String ?: "") : std::string(),
    self.locationLabel ? std::string(self.locationLabel.UTF8String ?: "") : std::string(), diagnostic};
  napi_threadsafe_function completion = self.completion;
  self.completion = nullptr;
  if (!completion || napi_call_threadsafe_function(completion, result, napi_tsfn_nonblocking) != napi_ok) delete result;
  if (completion) napi_release_threadsafe_function(completion, napi_tsfn_release);
  if (activeRequest == self) activeRequest = nil;
  (void)keepAlive;
}
- (void)startIfAuthorized {
  if (self.completed) return;
  if (![CLLocationManager locationServicesEnabled]) { [self finish:nil error:"LOCATION_SERVICES_DISABLED"]; return; }
  CLAuthorizationStatus status = self.manager.authorizationStatus;
  diagnostic.authorizationStatus = StatusName(status);
  if (status == kCLAuthorizationStatusDenied) { [self finish:nil error:"LOCATION_DENIED"]; return; }
  if (status == kCLAuthorizationStatusRestricted) { [self finish:nil error:"LOCATION_RESTRICTED"]; return; }
  if (status == kCLAuthorizationStatusNotDetermined) {
    if (!self.requestedAuthorization) {
      self.requestedAuthorization = YES;
      [self.manager requestWhenInUseAuthorization];
    }
    return;
  }
  if (!self.started) {
    self.started = YES;
    diagnostic.locationStarted = true;
    SetDiagnosticPhase("acquisition");
    // Permission-dialog reading time must not consume the location acquisition deadline.
    if (self.timer) dispatch_source_set_timer(self.timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRequestTimeout * NSEC_PER_SEC)), DISPATCH_TIME_FOREVER, 100 * NSEC_PER_MSEC);
    [self.manager startUpdatingLocation];
  }
}
- (void)start {
  diagnostic = SafeLocationDiagnostic{};
  requestStartedAt = DiagnosticClock::now();
  SetDiagnosticPhase("authorization");
  // Record activation at request entry; a later permission alert must not overwrite it.
  diagnostic.appActive = NSApp.isActive;
  diagnostic.mainThread = pthread_main_np();
  diagnostic.servicesEnabled = [CLLocationManager locationServicesEnabled];
  self.manager = [[CLLocationManager alloc] init];
  self.manager.desiredAccuracy = kCLLocationAccuracyKilometer;
  self.manager.distanceFilter = kCLDistanceFilterNone;
  self.timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  __weak WeatherLocationRequest *weakSelf = self;
  dispatch_source_set_event_handler(self.timer, ^{
    WeatherLocationRequest *request = weakSelf;
    if (request) {
      const char *failure = diagnostic.locationStarted && diagnostic.unknownFailures && diagnostic.receivedSamples == 0 ? "LOCATION_NO_FIX" : "LOCATION_TIMEOUT";
      [request finish:request.resolvedLocation error:request.resolvedLocation ? nullptr : failure];
    }
  });
  dispatch_source_set_timer(self.timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kAuthorizationTimeout * NSEC_PER_SEC)), DISPATCH_TIME_FOREVER, 100 * NSEC_PER_MSEC);
  dispatch_resume(self.timer);
  self.manager.delegate = self;
  [self startIfAuthorized];
}
- (void)resolveName:(CLLocation *)location {
  if (self.completed || self.resolvedLocation) return;
  SetDiagnosticPhase("geocode");
  self.resolvedLocation = location;
  [self.manager stopUpdatingLocation]; self.manager.delegate = nil;
  self.geocoder = [[CLGeocoder alloc] init];
  self.geocodeTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  __weak WeatherLocationRequest *weakSelf = self;
  dispatch_source_set_event_handler(self.geocodeTimer, ^{
    WeatherLocationRequest *request = weakSelf;
    if (request) [request finish:request.resolvedLocation error:nullptr];
  });
  dispatch_source_set_timer(self.geocodeTimer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kGeocodeTimeout * NSEC_PER_SEC)), DISPATCH_TIME_FOREVER, 50 * NSEC_PER_MSEC);
  dispatch_resume(self.geocodeTimer);
  [self.geocoder reverseGeocodeLocation:location preferredLocale:[NSLocale currentLocale] completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      WeatherLocationRequest *request = weakSelf;
      if (!request || request.completed) return;
      CLPlacemark *place = error ? nil : placemarks.firstObject;
      NSString *city = CleanLocality(place.locality);
      if (!city.length) city = CleanLocality(place.subAdministrativeArea);
      if (!city.length) city = CleanLocality(place.administrativeArea);
      NSString *district = CleanLocality(place.subLocality);
      request.locationName = city.length ? city : nil;
      request.locationLabel = city.length && district.length && ![city isEqualToString:district]
        ? CleanLocality([NSString stringWithFormat:@"%@ · %@", city, district]) : request.locationName;
      [request finish:request.resolvedLocation error:nullptr];
    });
  }];
}
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager { if (self.completed || manager != self.manager) return; diagnostic.authorizationCallbacks++; [self startIfAuthorized]; }
- (void)locationManager:(CLLocationManager *)manager didChangeAuthorizationStatus:(CLAuthorizationStatus)status { if (self.completed || manager != self.manager) return; diagnostic.authorizationCallbacks++; [self startIfAuthorized]; }
- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
  if (self.completed || manager != self.manager) return;
  diagnostic.locationCallbacks++;
  diagnostic.receivedSamples += locations.count;
  for (CLLocation *location in locations.reverseObjectEnumerator) {
    NSTimeInterval age = -location.timestamp.timeIntervalSinceNow;
    if (CLLocationCoordinate2DIsValid(location.coordinate) && std::isfinite(location.horizontalAccuracy) &&
        location.horizontalAccuracy >= 0 && age >= -30 && age <= 300) {
      [self resolveName:location]; return;
    }
    if (age < -30 || age > 300) diagnostic.staleSamples++;
    else diagnostic.invalidSamples++;
  }
}
- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  if (self.completed || manager != self.manager) return;
  diagnostic.nativeErrorCode = (int)error.code;
  if (error.code == kCLErrorLocationUnknown) { diagnostic.unknownFailures++; return; }
  [self finish:nil error:error.code == kCLErrorDenied ? "LOCATION_DENIED" : "LOCATION_UNAVAILABLE"];
}
- (void)abandon {
  self.completed = YES;
  UpdateDiagnosticElapsed(); diagnostic.finished = true;
  [self.manager stopUpdatingLocation]; self.manager.delegate = nil;
  if (self.timer) { dispatch_source_cancel(self.timer); self.timer = nil; }
  if (self.geocodeTimer) { dispatch_source_cancel(self.geocodeTimer); self.geocodeTimer = nil; }
  [self.geocoder cancelGeocode]; self.geocoder = nil;
  napi_threadsafe_function completion = self.completion;
  self.completion = nullptr;
  if (completion) napi_release_threadsafe_function(completion, napi_tsfn_abort);
}
@end

static napi_value Status(napi_env env, napi_callback_info info) {
  if (!pthread_main_np()) { napi_throw_error(env, "LOCATION_MAIN_THREAD_REQUIRED", "Location status requires the app main thread."); return nullptr; }
  napi_value result, status, enabled;
  napi_create_object(env, &result);
  CLLocationManager *manager = [[CLLocationManager alloc] init];
  napi_create_string_utf8(env, StatusName(manager.authorizationStatus), NAPI_AUTO_LENGTH, &status);
  napi_get_boolean(env, [CLLocationManager locationServicesEnabled], &enabled);
  napi_set_named_property(env, result, "status", status);
  napi_set_named_property(env, result, "servicesEnabled", enabled);
  return result;
}
static napi_value Diagnostics(napi_env env, napi_callback_info info) { UpdateDiagnosticElapsed(); return DiagnosticValue(env, diagnostic); }
static napi_value Locate(napi_env env, napi_callback_info info) {
  napi_value promise; napi_deferred deferred;
  napi_create_promise(env, &deferred, &promise);
  if (!pthread_main_np()) {
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_MAIN_THREAD_REQUIRED")); return promise;
  }
  if (activeRequest) {
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_BUSY")); return promise;
  }
  napi_ref promiseReference;
  if (napi_create_reference(env, promise, 1, &promiseReference) != napi_ok) {
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_UNAVAILABLE")); return promise;
  }
  auto *context = new PromiseContext{deferred, promiseReference};
  napi_value resourceName;
  napi_create_string_utf8(env, "weather-location", NAPI_AUTO_LENGTH, &resourceName);
  napi_threadsafe_function completion;
  if (napi_create_threadsafe_function(env, nullptr, nullptr, resourceName, 1, 1,
      context, DeletePromiseContext, context, ResolveOnJsThread, &completion) != napi_ok) {
    napi_delete_reference(env, promiseReference);
    delete context;
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_UNAVAILABLE")); return promise;
  }
  activeRequest = [[WeatherLocationRequest alloc] init];
  activeRequest.env = env; activeRequest.completion = completion;
  activeRequest.promiseContext = context;
  [activeRequest start];
  return promise;
}
static napi_value Cancel(napi_env env, napi_callback_info info) {
  if (!pthread_main_np()) { napi_throw_error(env, "LOCATION_MAIN_THREAD_REQUIRED", "Location cancellation requires the app main thread."); return nullptr; }
  size_t argc = 1; napi_value token, promise; bool matches = false, alreadyRetired = false;
  napi_get_cb_info(env, info, &argc, &token, nullptr, nullptr);
  // finish can retire the manager before its queued TSFN settles the JS promise.
  // With no manager active, a promise owner can safely drop that old pending too.
  if (argc == 1 && !activeRequest) napi_is_promise(env, token, &alreadyRetired);
  if (argc == 1 && activeRequest && activeRequest.env == env && activeRequest.promiseContext &&
      napi_get_reference_value(env, activeRequest.promiseContext->promiseReference, &promise) == napi_ok) {
    napi_strict_equals(env, token, promise, &matches);
  }
  // A late owner's token must never stop another request. finish retires the native
  // manager and activeRequest synchronously; only its JS settlement is asynchronous.
  if (matches) [activeRequest finish:nil error:"CANCELLED"];
  napi_value result; napi_get_boolean(env, matches || alreadyRetired, &result); return result;
}
static void Cleanup(void *data) {
  if (pthread_main_np() && activeRequest && activeRequest.env == (napi_env)data) { [activeRequest abandon]; activeRequest = nil; }
}
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"diagnostics", nullptr, Diagnostics, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"locate", nullptr, Locate, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, Cleanup, env);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
