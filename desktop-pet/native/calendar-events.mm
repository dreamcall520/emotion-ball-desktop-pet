// EventKit access stays inside the signed app; only Connect may request permission.
#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <node_api.h>
#include <cmath>
#include <memory>
#include <mutex>
#include <string>

static const char *StatusName() {
  EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
  if (@available(macOS 14.0, *)) {
    if (status == EKAuthorizationStatusFullAccess) return "granted";
    if (status == EKAuthorizationStatusWriteOnly) return "denied";
  } else if (status == EKAuthorizationStatusAuthorized) return "granted";
  switch (status) {
    case EKAuthorizationStatusNotDetermined: return "not-determined";
    case EKAuthorizationStatusRestricted: return "restricted";
    default: return "denied";
  }
}
static napi_value Text(napi_env env, const char *value) {
  napi_value result; napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result); return result;
}
static napi_value Error(napi_env env) {
  napi_value result; napi_create_error(env, Text(env, "CALENDAR_UNAVAILABLE"), Text(env, "System calendar is unavailable."), &result); return result;
}
static napi_value Status(napi_env env, napi_callback_info info) { return Text(env, StatusName()); }
static NSString *BoundedText(NSString *value, NSUInteger limit) {
  // Avoid splitting a surrogate pair/combining sequence and invalidating JSON.
  return value.length > limit ? [value substringToIndex:[value rangeOfComposedCharacterSequenceAtIndex:limit].location] : value ?: @"";
}
static NSString *CalendarColor(CGColorRef color) {
  if (!color) return nil;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGColorRef rgb = space ? CGColorCreateCopyByMatchingToColorSpace(space, kCGRenderingIntentDefault, color, nullptr) : nullptr;
  if (space) CGColorSpaceRelease(space);
  if (!rgb) return nil;
  NSString *result = nil;
  const CGFloat *components = CGColorGetComponents(rgb);
  if (components && CGColorGetNumberOfComponents(rgb) >= 3 && std::isfinite(components[0]) && std::isfinite(components[1]) && std::isfinite(components[2])) {
    int values[3];
    for (int i = 0; i < 3; i++) values[i] = static_cast<int>(std::lround(std::fmax(0, std::fmin(1, components[i])) * 255));
    result = [NSString stringWithFormat:@"#%02X%02X%02X", values[0], values[1], values[2]];
  }
  CGColorRelease(rgb); return result;
}

struct AuthRequest { std::mutex mutex; napi_threadsafe_function completion = nullptr; };
struct Environment { std::shared_ptr<AuthRequest> auth; };
struct PromiseContext { napi_deferred deferred; };
static void FinalizePromise(napi_env env, void *data, void *hint) { delete static_cast<PromiseContext *>(data); }
static void AuthResolved(napi_env env, napi_value callback, void *context, void *data) {
  std::unique_ptr<std::string> status(static_cast<std::string *>(data));
  if (env && context) napi_resolve_deferred(env, static_cast<PromiseContext *>(context)->deferred, Text(env, status->c_str()));
}
static napi_value Connect(napi_env env, napi_callback_info info) {
  napi_value promise; napi_deferred deferred; napi_create_promise(env, &deferred, &promise);
  void *data; napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data);
  auto *owner = static_cast<Environment *>(data);
  const char *current = StatusName();
  if (std::string(current) == "granted" || std::string(current) == "restricted") { napi_resolve_deferred(env, deferred, Text(env, current)); return promise; }
  if (owner->auth) {
    std::lock_guard<std::mutex> lock(owner->auth->mutex);
    if (owner->auth->completion) { napi_reject_deferred(env, deferred, Error(env)); return promise; }
  }
  auto request = std::make_shared<AuthRequest>();
  auto *context = new PromiseContext{deferred};
  if (napi_create_threadsafe_function(env, nullptr, nullptr, Text(env, "calendar-authorization"), 1, 1,
      context, FinalizePromise, context, AuthResolved, &request->completion) != napi_ok) {
    delete context; napi_reject_deferred(env, deferred, Error(env)); return promise;
  }
  owner->auth = request;
  dispatch_async(dispatch_get_main_queue(), ^{
    { std::lock_guard<std::mutex> lock(request->mutex); if (!request->completion) return; }
    EKEventStore *store = [[EKEventStore alloc] init];
    void (^complete)(BOOL, NSError *) = ^(BOOL granted, NSError *error) {
      (void)store;
      std::lock_guard<std::mutex> lock(request->mutex);
      if (!request->completion) return;
      auto *result = new std::string(error ? "error" : StatusName());
      if (napi_call_threadsafe_function(request->completion, result, napi_tsfn_nonblocking) != napi_ok) delete result;
      napi_release_threadsafe_function(request->completion, napi_tsfn_release); request->completion = nullptr;
    };
    if (@available(macOS 14.0, *)) [store requestFullAccessToEventsWithCompletion:complete];
    else [store requestAccessToEntityType:EKEntityTypeEvent completion:complete];
  });
  return promise;
}
struct ReadRequest { napi_deferred deferred; napi_async_work work; double start; double end; std::string json; bool failed = false; };
static void ExecuteRead(napi_env env, void *data) {
  auto *request = static_cast<ReadRequest *>(data);
  @autoreleasepool {
    @try {
      if (std::string(StatusName()) != "granted") { request->failed = true; return; }
      EKEventStore *store = [[EKEventStore alloc] init];
      NSArray<EKCalendar *> *calendars = [store calendarsForEntityType:EKEntityTypeEvent];
      if (calendars.count > 1000) { request->failed = true; return; }
      NSMutableArray *calendarData = [NSMutableArray array];
      for (EKCalendar *calendar in calendars) {
        if (!calendar.calendarIdentifier.length) continue;
        NSMutableDictionary *item = [@{@"id":calendar.calendarIdentifier, @"title":BoundedText(calendar.title, 160)} mutableCopy];
        NSString *color = CalendarColor(calendar.CGColor);
        if (color) item[@"color"] = color;
        [calendarData addObject:item];
      }
      NSDate *start = [NSDate dateWithTimeIntervalSince1970:request->start / 1000.0];
      NSDate *end = [NSDate dateWithTimeIntervalSince1970:request->end / 1000.0];
      NSPredicate *predicate = [store predicateForEventsWithStartDate:start endDate:end calendars:calendars];
      NSArray<EKEvent *> *events = [store eventsMatchingPredicate:predicate];
      NSMutableArray *eventData = [NSMutableArray array];
      BOOL truncated = NO;
      for (EKEvent *event in [events sortedArrayUsingSelector:@selector(compareStartDateWithEvent:)]) {
        if (event.status == EKEventStatusCanceled) continue;
        if (eventData.count >= 2000) { truncated = YES; break; }
        if (!event.eventIdentifier.length || !event.calendar.calendarIdentifier.length || !event.startDate || !event.endDate) continue;
        NSMutableDictionary *item = [@{@"id":event.eventIdentifier, @"calendarId":event.calendar.calendarIdentifier, @"title":BoundedText(event.title, 300),
          @"start":@(event.startDate.timeIntervalSince1970 * 1000), @"end":@(event.endDate.timeIntervalSince1970 * 1000), @"allDay":@(event.allDay),
          @"recurring":@(event.hasRecurrenceRules || event.isDetached)} mutableCopy];
        if (event.calendarItemIdentifier.length && event.calendarItemIdentifier.length <= 1024) item[@"itemId"] = event.calendarItemIdentifier;
        if (event.location.length) item[@"location"] = BoundedText(event.location, 500);
        if (event.notes.length) item[@"notes"] = BoundedText(event.notes, 4000);
        // Display name only: never access participant URLs, mailboxes or attendees.
        NSString *organizer = event.organizer.name;
        if (organizer.length && [organizer rangeOfString:@"@"].location == NSNotFound) item[@"organizer"] = BoundedText(organizer, 300);
        NSMutableArray<NSNumber *> *reminderMinutes = [NSMutableArray array];
        for (EKAlarm *alarm in event.alarms) {
          if (alarm.absoluteDate || alarm.structuredLocation || alarm.proximity != EKAlarmProximityNone) continue;
          const double offset = alarm.relativeOffset;
          if (!std::isfinite(offset) || offset > 0 || offset < -525600.0 * 60) continue;
          NSNumber *minutes = @(-offset / 60.0);
          if (![reminderMinutes containsObject:minutes]) [reminderMinutes addObject:minutes];
          if (reminderMinutes.count >= 8) break;
        }
        if (reminderMinutes.count) item[@"reminderMinutes"] = reminderMinutes;
        [eventData addObject:item];
      }
      if (std::string(StatusName()) != "granted") { request->failed = true; return; }
      NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"calendars":calendarData, @"events":eventData, @"truncated":@(truncated)} options:0 error:nil];
      if (!json) { request->failed = true; return; }
      request->json.assign(static_cast<const char *>(json.bytes), json.length);
    } @catch (NSException *exception) { request->failed = true; }
  }
}
static void CompleteRead(napi_env env, napi_status status, void *data) {
  std::unique_ptr<ReadRequest> request(static_cast<ReadRequest *>(data));
  if (status != napi_ok || request->failed) napi_reject_deferred(env, request->deferred, Error(env));
  else {
    napi_value value; napi_create_string_utf8(env, request->json.c_str(), request->json.size(), &value);
    napi_resolve_deferred(env, request->deferred, value);
  }
  napi_delete_async_work(env, request->work);
}
static napi_value Read(napi_env env, napi_callback_info info) {
  napi_value promise; napi_deferred deferred; napi_create_promise(env, &deferred, &promise);
  size_t argc = 2; napi_value args[2]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  double start = 0, end = 0;
  if (argc != 2 || napi_get_value_double(env, args[0], &start) != napi_ok || napi_get_value_double(env, args[1], &end) != napi_ok ||
      !std::isfinite(start) || !std::isfinite(end) || end <= start || end - start > 62.0 * 86400000 || std::abs(start) > 8640000000000000 || std::abs(end) > 8640000000000000 || std::string(StatusName()) != "granted") {
    napi_reject_deferred(env, deferred, Error(env)); return promise;
  }
  auto *request = new ReadRequest{deferred, nullptr, start, end};
  if (napi_create_async_work(env, nullptr, Text(env, "calendar-read"), ExecuteRead, CompleteRead, request, &request->work) != napi_ok) {
    delete request; napi_reject_deferred(env, deferred, Error(env)); return promise;
  }
  if (napi_queue_async_work(env, request->work) != napi_ok) { napi_delete_async_work(env, request->work); delete request; napi_reject_deferred(env, deferred, Error(env)); }
  return promise;
}
static void Cleanup(void *data) {
  std::unique_ptr<Environment> owner(static_cast<Environment *>(data));
  if (owner->auth) {
    std::lock_guard<std::mutex> lock(owner->auth->mutex);
    if (owner->auth->completion) { napi_release_threadsafe_function(owner->auth->completion, napi_tsfn_abort); owner->auth->completion = nullptr; }
  }
}
static napi_value Init(napi_env env, napi_value exports) {
  auto *owner = new Environment();
  napi_property_descriptor properties[] = {
    {"status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"connect", nullptr, Connect, nullptr, nullptr, nullptr, napi_default, owner},
    {"read", nullptr, Read, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 3, properties); napi_add_env_cleanup_hook(env, Cleanup, owner); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
