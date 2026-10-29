// Core Location runs inside the signed Electron app, never in an external helper.
#import <Foundation/Foundation.h>
#import <CoreLocation/CoreLocation.h>
#include <node_api.h>
#include <pthread.h>
#include <cmath>
#include <memory>
#include <string>

static const NSTimeInterval kRequestTimeout = 15.0;
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


struct LocationResult {
  const char *errorCode;
  double latitude;
  double longitude;
  double accuracy;
  std::string name;
  std::string locationLabel;
};
struct PromiseContext { napi_deferred deferred; };
static void DeletePromiseContext(napi_env env, void *data, void *hint) {
  delete static_cast<PromiseContext *>(data);
}
static void ResolveOnJsThread(napi_env env, napi_value callback, void *context, void *data) {
  std::unique_ptr<LocationResult> result(static_cast<LocationResult *>(data));
  // Node invokes this with env=null when shutting down; only release plain data then.
  if (!env || !context || !result) return;
  auto *promise = static_cast<PromiseContext *>(context);
  if (result->errorCode) {
    napi_reject_deferred(env, promise->deferred, ErrorValue(env, result->errorCode));
  } else {
    napi_value value;
    if (napi_create_object(env, &value) != napi_ok) return;
    SetNumber(env, value, "latitude", result->latitude);
    SetNumber(env, value, "longitude", result->longitude);
    SetNumber(env, value, "accuracy", result->accuracy);
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
    self.locationLabel ? std::string(self.locationLabel.UTF8String ?: "") : std::string()};
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
  if (status == kCLAuthorizationStatusDenied) { [self finish:nil error:"LOCATION_DENIED"]; return; }
  if (status == kCLAuthorizationStatusRestricted) { [self finish:nil error:"LOCATION_RESTRICTED"]; return; }
  if (status == kCLAuthorizationStatusNotDetermined) {
    if (!self.requestedAuthorization) {
      self.requestedAuthorization = YES;
      [self.manager requestWhenInUseAuthorization];
    }
    return;
  }
  if (!self.started) { self.started = YES; [self.manager startUpdatingLocation]; }
}
- (void)start {
  self.manager = [[CLLocationManager alloc] init];
  self.manager.desiredAccuracy = kCLLocationAccuracyKilometer;
  self.manager.distanceFilter = kCLDistanceFilterNone;
  self.manager.delegate = self;
  self.timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  __weak WeatherLocationRequest *weakSelf = self;
  dispatch_source_set_event_handler(self.timer, ^{
    WeatherLocationRequest *request = weakSelf;
    if (request) [request finish:request.resolvedLocation error:request.resolvedLocation ? nullptr : "LOCATION_TIMEOUT"];
  });
  dispatch_source_set_timer(self.timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRequestTimeout * NSEC_PER_SEC)), DISPATCH_TIME_FOREVER, 100 * NSEC_PER_MSEC);
  dispatch_resume(self.timer);
  [self startIfAuthorized];
}
- (void)resolveName:(CLLocation *)location {
  if (self.completed || self.resolvedLocation) return;
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
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager { [self startIfAuthorized]; }
- (void)locationManager:(CLLocationManager *)manager didChangeAuthorizationStatus:(CLAuthorizationStatus)status { [self startIfAuthorized]; }
- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
  for (CLLocation *location in locations.reverseObjectEnumerator) {
    NSTimeInterval age = -location.timestamp.timeIntervalSinceNow;
    if (CLLocationCoordinate2DIsValid(location.coordinate) && std::isfinite(location.horizontalAccuracy) &&
        location.horizontalAccuracy >= 0 && age >= -30 && age <= 300) {
      [self resolveName:location]; return;
    }
  }
}
- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  if (error.code == kCLErrorLocationUnknown) return;
  [self finish:nil error:error.code == kCLErrorDenied ? "LOCATION_DENIED" : "LOCATION_UNAVAILABLE"];
}
- (void)abandon {
  self.completed = YES;
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
static napi_value Locate(napi_env env, napi_callback_info info) {
  napi_value promise; napi_deferred deferred;
  napi_create_promise(env, &deferred, &promise);
  if (!pthread_main_np()) {
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_MAIN_THREAD_REQUIRED")); return promise;
  }
  if (activeRequest) {
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_BUSY")); return promise;
  }
  auto *context = new PromiseContext{deferred};
  napi_value resourceName;
  napi_create_string_utf8(env, "weather-location", NAPI_AUTO_LENGTH, &resourceName);
  napi_threadsafe_function completion;
  if (napi_create_threadsafe_function(env, nullptr, nullptr, resourceName, 1, 1,
      context, DeletePromiseContext, context, ResolveOnJsThread, &completion) != napi_ok) {
    delete context;
    napi_reject_deferred(env, deferred, ErrorValue(env, "LOCATION_UNAVAILABLE")); return promise;
  }
  activeRequest = [[WeatherLocationRequest alloc] init];
  activeRequest.env = env; activeRequest.completion = completion;
  [activeRequest start];
  return promise;
}
static void Cleanup(void *data) {
  if (pthread_main_np() && activeRequest && activeRequest.env == (napi_env)data) { [activeRequest abandon]; activeRequest = nil; }
}
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"locate", nullptr, Locate, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 2, properties);
  napi_add_env_cleanup_hook(env, Cleanup, env);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
