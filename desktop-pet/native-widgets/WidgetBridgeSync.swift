import Foundation
import Darwin

struct WidgetSourceInput {
    let state: String
    let data: Data?
    init(_ raw: Any?) throws {
        guard let object = raw as? [String: Any], let state = object["state"] as? String,
              ["data", "missing", "error"].contains(state) else { throw TodoReadError.invalid }
        self.state = state
        if state == "data" {
            guard let value = object["value"] as? [String: Any] else { throw TodoReadError.invalid }
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            guard data.count <= 4 * 1024 * 1024 else { throw TodoReadError.invalid }
            self.data = data
        } else {
            guard object["value"] == nil else { throw TodoReadError.invalid }
            self.data = nil
        }
    }
}
struct WidgetSyncInput {
    let sourceID: String
    let todo: WidgetSourceInput
    let config: WidgetSourceInput
    let cache: WidgetSourceInput
    init(_ data: Data) throws {
        guard data.count <= 16 * 1024 * 1024,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              TodoModel.number(object["schema"]) == 1,
              let sourceID = object["sourceID"] as? String,
              sourceID.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw TodoReadError.invalid }
        self.sourceID = sourceID
        todo = try WidgetSourceInput(object["todo"])
        config = try WidgetSourceInput(object["weatherConfig"])
        cache = try WidgetSourceInput(object["weatherCache"])
    }
}

enum WidgetBridgeSync {
    static let todoKinds = ["QiuqiuNativeTodoTodayProbe", "QiuqiuNativeTodoListProbe", "QiuqiuNativeNextReminderProbe", "QiuqiuNativeAccentOverviewProbe", "QiuqiuNativeAccentTodoProbe", "QiuqiuNativeCompanionPanelProbe"]
    static let weatherKinds = ["QiuqiuNativeWeatherCardProbe", "QiuqiuNativeWeatherWeekProbe"]
    static func encoded<T: Encodable>(_ value: T) throws -> Data {
        let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970; e.outputFormatting = .sortedKeys
        return try e.encode(value)
    }
    static func comparable(_ value: TodoSnapshot) throws -> Data {
        var copy = value; copy.syncedAt = nil
        return try encoded(copy)
    }
    static func emptyTodo(_ sourceID: String, state: String = "waiting") -> TodoSnapshot {
        var s = TodoSnapshot.disconnected; s.sourceID = sourceID; s.state = state; return s
    }
    static func emptyWeather(_ sourceID: String, state: String = "waiting", cityID: String? = nil) -> WidgetWeatherSnapshot {
        var s = WidgetWeatherSnapshot(state: state); s.profileID = sourceID; s.cityID = cityID; return s
    }
    static func todo(_ input: WidgetSourceInput, old: TodoSnapshot, sourceID: String, now: Date) -> TodoSnapshot {
        if input.state == "data", let data = input.data {
            do {
                var s = try TodoModel.decodeSource(data, now: now); s.sourceID = sourceID
                if (try? comparable(s)) == (try? comparable(old)) { s.syncedAt = old.syncedAt }
                return s
            } catch { var s = old; s.state = "error"; return s }
        }
        var s = old
        s.state = input.state == "missing" && old.syncedAt == nil ? "waiting" : "error"
        return s
    }
    static func weather(config: WidgetSourceInput, cache: WidgetSourceInput, old: WidgetWeatherSnapshot, sourceID: String, now: Date) -> WidgetWeatherSnapshot {
        guard config.state == "data", let configData = config.data else {
            if config.state == "missing" { return emptyWeather(sourceID) }
            var s = old; s.state = "error"; return s
        }
        var preflight: WidgetWeatherSnapshot
        do {
            preflight = try WeatherWidgetModel.decode(config: configData, cache: nil, now: now)
            preflight.profileID = sourceID
        } catch WeatherWidgetError.missingConsent {
            return emptyWeather(sourceID, state: "error")
        } catch {
            var s = old; s.state = "error"; return s
        }
        if ["disabled", "unconfigured"].contains(preflight.state) { return preflight }
        let sameCity = old.cityID != nil && old.cityID == preflight.cityID
        let baseline = sameCity ? old : preflight
        guard cache.state == "data", let cacheData = cache.data else {
            if cache.state == "missing" { return preflight }
            var s = baseline; s.state = "error"; return s
        }
        do {
            var s = try WeatherWidgetModel.decode(config: configData, cache: cacheData, now: now)
            s.profileID = sourceID; return s
        } catch WeatherWidgetError.mismatchedCity {
            return emptyWeather(sourceID, state: "error", cityID: preflight.cityID)
        } catch WeatherWidgetError.missingConsent {
            return emptyWeather(sourceID, state: "error", cityID: preflight.cityID)
        } catch {
            var s = baseline; s.state = "error"; return s
        }
    }
    // The caller supplies only its own profile. The extension never opens profile files.
    static func sync(_ input: WidgetSyncInput, now: Date = Date(), reload: (String) -> Void = { _ in }) throws -> [String: Any] {
        guard let folder = WidgetStore.directory else { throw TodoReadError.invalid }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let lock = open(folder.appendingPathComponent(".widget-sync.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard lock >= 0 else { throw TodoReadError.invalid }
        defer { close(lock) }
        guard flock(lock, LOCK_EX) == 0 else { throw TodoReadError.invalid }
        defer { _ = flock(lock, LOCK_UN) }
        let previousTodo = TodoSnapshot.read(), previousWeather = WidgetWeatherSnapshot.read()
        let todoSwitched = previousTodo.sourceID != input.sourceID
        let weatherSwitched = previousWeather.profileID != input.sourceID
        let baselineTodo = todoSwitched ? emptyTodo(input.sourceID) : previousTodo
        let baselineWeather = weatherSwitched ? emptyWeather(input.sourceID) : previousWeather
        // Persist the empty new-source state before decoding any incoming personal payload.
        if todoSwitched { try baselineTodo.write() }
        if weatherSwitched { try baselineWeather.write() }
        let nextTodo = todo(input.todo, old: baselineTodo, sourceID: input.sourceID, now: now)
        let nextWeather = weather(config: input.config, cache: input.cache, old: baselineWeather, sourceID: input.sourceID, now: now)
        let todoChanged = try comparable(previousTodo) != comparable(nextTodo)
        let weatherChanged = try encoded(previousWeather) != encoded(nextWeather)
        if todoChanged { try nextTodo.write() }
        if weatherChanged { try nextWeather.write() }
        if todoChanged { todoKinds.forEach(reload) }
        if weatherChanged { weatherKinds.forEach(reload) }
        let failed = nextTodo.state == "error" || nextWeather.state == "error"
        return ["ok": true, "state": failed ? "partial" : "synced",
                "todo": ["state": nextTodo.state, "count": nextTodo.syncedAt == nil ? NSNull() : nextTodo.items.count, "revision": nextTodo.revision, "changed": todoChanged] as [String: Any],
                "weather": ["state": nextWeather.state, "count": nextWeather.hasData ? nextWeather.days.count : NSNull(), "changed": weatherChanged] as [String: Any],
                "changed": todoChanged || weatherChanged]
    }
}
