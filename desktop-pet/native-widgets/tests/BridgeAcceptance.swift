import Foundation

@main struct BridgeAcceptance {
    static func main() throws {
        let now = Date(), sourceA = String(repeating: "a", count: 64), sourceB = String(repeating: "b", count: 64)
        var checks: [[String: Any]] = [], reloads: [String] = []
        func check(_ name: String, _ passed: Bool) { checks.append(["name": name, "passed": passed]) }
        func input(_ source: String = "", todo: [String: Any] = ["state": "missing"], config: [String: Any] = ["state": "missing"], cache: [String: Any] = ["state": "missing"]) throws -> WidgetSyncInput {
            try WidgetSyncInput(JSONSerialization.data(withJSONObject: ["schema": 1, "sourceID": source.isEmpty ? sourceA : source, "todo": todo, "weatherConfig": config, "weatherCache": cache]))
        }
        func datum(_ value: [String: Any]) -> [String: Any] { ["state": "data", "value": value] }
        let missing: [String: Any] = ["state": "missing"], error: [String: Any] = ["state": "error"]
        let millis = now.timeIntervalSince1970 * 1000
        let row: [String: Any] = ["id": "synthetic-1", "title": "Synthetic task", "dueDate": TodoModel.dayKey(now), "completed": false, "archived": false, "reminderAt": NSNull(), "reminderState": "none", "createdAt": millis, "updatedAt": millis, "occurrenceId": "", "notes": "NEVER-EXPORT-PRIVATE-BODY", "body": "NEVER-EXPORT-PRIVATE-BODY"]
        let todo: [String: Any] = ["schema": 2, "revision": 9, "todos": [row]]
        func config(_ lat: Double = 10, _ lon: Double = 20, enabled: Bool = true, mode: String = "manual", consent: Bool = true) -> [String: Any] {
            ["enabled": enabled, "city": ["name": "Synthetic City", "latitude": lat, "longitude": lon, "mode": mode, "locationSharingAccepted": consent, "timezone": "Asia/Shanghai"]]
        }
        func cache(_ lat: Double = 10, _ lon: Double = 20) -> [String: Any] {
            ["city": ["latitude": lat, "longitude": lon], "current": ["temperature": 24, "weatherCode": 2, "isDay": 1, "time": millis], "updatedAt": millis, "daily": [["date": TodoModel.dayKey(now), "min": 12, "max": 32]], "timezone": "Asia/Shanghai"]
        }
        func sync(_ x: WidgetSyncInput) throws -> [String: Any] { try WidgetBridgeSync.sync(x, now: now, reload: { reloads.append($0) }) }
        guard WidgetStore.group == "SUUX53KQQV.qiuqiu.widgetprobe.acceptance" else { throw TodoReadError.invalid }
        // Overwrite only the dedicated synthetic acceptance snapshots; never any real profile.
        try WidgetBridgeSync.emptyTodo(sourceA).write(); try WidgetBridgeSync.emptyWeather(sourceA).write()
        var report = try sync(input())
        check("missing_is_waiting_without_fabricated_count", TodoSnapshot.read().state == "waiting" && WidgetWeatherSnapshot.read().state == "waiting" && (report["todo"] as? [String: Any])?["count"] is NSNull)
        report = try sync(input(todo: datum(todo), config: datum(config()), cache: datum(cache())))
        check("real_sync_ready", TodoSnapshot.read().items.count == 1 && WidgetWeatherSnapshot.read().temperature == 24)
        check("separate_kinds_reload", Set(reloads) == Set(WidgetBridgeSync.todoKinds + WidgetBridgeSync.weatherKinds))
        let before = reloads.count, goodTodo = TodoSnapshot.read(), goodWeather = WidgetWeatherSnapshot.read()
        report = try sync(input(todo: datum(todo), config: datum(config()), cache: datum(cache())))
        check("identical_input_does_not_reload", reloads.count == before && report["changed"] as? Bool == false)
        check("identical_input_preserves_sync_timestamp", TodoSnapshot.read().syncedAt == goodTodo.syncedAt)
        report = try sync(input(todo: error, config: datum(config()), cache: error))
        check("same_source_error_preserves_last_good", TodoSnapshot.read().state == "error" && TodoSnapshot.read().items == goodTodo.items && WidgetWeatherSnapshot.read().state == "error" && WidgetWeatherSnapshot.read().temperature == goodWeather.temperature)
        let errorCount = reloads.count
        _ = try sync(input(todo: error, config: datum(config()), cache: error))
        check("repeated_same_source_error_no_reload", reloads.count == errorCount)
        _ = try sync(input(todo: datum(todo), config: datum(config()), cache: datum(cache())))
        check("valid_after_error_recovers", TodoSnapshot.read().state == "ready" && WidgetWeatherSnapshot.read().state == "ready")
        _ = try sync(input(todo: datum(["schema": 2, "revision": 10, "todos": [["id": "invalid"]]]), config: datum(config()), cache: datum(cache())))
        check("invalid_todo_retains_valid_rows_with_error", TodoSnapshot.read().state == "error" && TodoSnapshot.read().items.count == 1 && TodoSnapshot.read().revision == 9)
        _ = try sync(input(todo: missing, config: datum(config()), cache: datum(cache())))
        check("source_file_disappears_retains_last_good_error", TodoSnapshot.read().state == "error" && TodoSnapshot.read().items.count == 1)
        _ = try sync(input(sourceB, todo: error, config: error, cache: error))
        check("source_switch_error_clears_previous_profile", TodoSnapshot.read().items.isEmpty && TodoSnapshot.read().syncedAt == nil && WidgetWeatherSnapshot.read().temperature == nil && TodoSnapshot.read().sourceID == sourceB && WidgetWeatherSnapshot.read().profileID == sourceB)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config()), cache: datum(cache())))
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(enabled: false)), cache: error))
        check("disabled_ignores_cache_error_and_clears", WidgetWeatherSnapshot.read().state == "disabled" && !WidgetWeatherSnapshot.read().hasData && WidgetWeatherSnapshot.read().city.isEmpty)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config()), cache: datum(cache())))
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(30, 40)), cache: error))
        let newCity = WidgetWeatherSnapshot.read().cityID
        check("city_change_bad_cache_clears_old_city", !WidgetWeatherSnapshot.read().hasData && WidgetWeatherSnapshot.read().state == "error" && newCity != goodWeather.cityID)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(30, 40)), cache: datum(cache())))
        check("mismatched_cache_clears_payload_keeps_identity", !WidgetWeatherSnapshot.read().hasData && WidgetWeatherSnapshot.read().cityID == newCity && WidgetWeatherSnapshot.read().profileID == sourceB)
        let mismatchCount = reloads.count
        for _ in 0..<3 { _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(30, 40)), cache: datum(cache()))) }
        check("repeated_city_mismatch_no_reload", reloads.count == mismatchCount)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(30, 40)), cache: datum(cache(30, 40))))
        check("new_city_valid_cache_recovers", WidgetWeatherSnapshot.read().state == "ready" && WidgetWeatherSnapshot.read().hasData)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(30, 40, mode: "current", consent: false)), cache: datum(cache(30, 40))))
        check("revoked_current_consent_clears", !WidgetWeatherSnapshot.read().hasData && WidgetWeatherSnapshot.read().city.isEmpty)
        let consentCount = reloads.count
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config(30, 40, mode: "current", consent: false)), cache: datum(cache(30, 40))))
        check("repeated_no_consent_no_reload", reloads.count == consentCount)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config()), cache: datum(cache())))
        _ = try sync(input(sourceB, todo: datum(todo), config: missing, cache: datum(cache())))
        check("missing_config_clears_weather_waiting", WidgetWeatherSnapshot.read().state == "waiting" && !WidgetWeatherSnapshot.read().hasData)
        _ = try sync(input(sourceB, todo: datum(todo), config: datum(config()), cache: missing))
        check("missing_cache_waiting_not_zero", WidgetWeatherSnapshot.read().state == "waiting" && !WidgetWeatherSnapshot.read().hasData)
        let folder = WidgetStore.directory!
        let todoData = try Data(contentsOf: folder.appendingPathComponent("todo-snapshot.json"))
        let weatherData = try Data(contentsOf: folder.appendingPathComponent("weather-snapshot.json"))
        let texts = String(decoding: todoData + weatherData, as: UTF8.self)
        check("minimal_export_omits_notes_body_coordinates", !texts.contains("NEVER-EXPORT") && !texts.contains("latitude") && !texts.contains("longitude") && !texts.contains("\"notes\"") && !texts.contains("\"body\""))
        check("snapshots_owner_only", try ["todo-snapshot.json", "weather-snapshot.json"].allSatisfy { ((try FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent($0).path)[.posixPermissions]) as? NSNumber)?.intValue == 0o600 })
        let safe = String(decoding: try JSONSerialization.data(withJSONObject: report), as: UTF8.self)
        check("stdout_metadata_omits_personal_payload", !safe.contains("Synthetic") && !safe.contains("latitude") && !safe.contains("title") && !safe.contains(sourceA))
        check("invalid_envelope_bool_schema_rejected", (try? WidgetSyncInput(JSONSerialization.data(withJSONObject: ["schema": true, "sourceID": sourceA, "todo": missing, "weatherConfig": missing, "weatherCache": missing]))) == nil)
        check("invalid_source_id_rejected", (try? input("../not-a-source")) == nil)
        check("source_object_over_4MiB_rejected", (try? input(todo: datum(["padding": String(repeating: "x", count: 4 * 1024 * 1024)]))) == nil)
        check("whole_input_over_16MiB_rejected", (try? WidgetSyncInput(Data(repeating: 32, count: 16 * 1024 * 1024 + 1))) == nil)
        check("error_state_may_not_smuggle_value", (try? input(todo: ["state": "error", "value": todo])) == nil)
        let output: [String: Any] = ["scope": "synthetic dedicated-group helper-core IO only; no real profile, registration or native rendering", "checks": checks, "passed": checks.filter { $0["passed"] as? Bool == true }.count, "total": checks.count]
        print(String(decoding: try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
        if checks.contains(where: { $0["passed"] as? Bool != true }) { exit(1) }
    }
}
