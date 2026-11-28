import Foundation
import CoreFoundation
import CryptoKit

struct WidgetWeatherDay: Codable, Equatable {
    let date: String
    let minimum: Double
    let maximum: Double
}
struct WidgetWeatherSnapshot: Codable {
    var schema = 1
    var state: String
    var profileID: String?
    var cityID: String?
    var city: String = ""
    var temperature: Double?
    var code: Int?
    var isDay: Bool?
    var observedAt: Date?
    var fetchedAt: Date?
    var timezone: String?
    var days: [WidgetWeatherDay] = []
    var source = "Open-Meteo"
    var hasData: Bool { temperature != nil && observedAt != nil && fetchedAt != nil }
    static var disconnected: Self { Self(state: "disconnected") }
    func status(at date: Date) -> String {
        guard state == "ready", let observedAt, let fetchedAt else { return state }
        return date.timeIntervalSince(observedAt) > 90 * 60 || date.timeIntervalSince(fetchedAt) > 90 * 60 ? "stale" : "ready"
    }
    func today(at date: Date) -> WidgetWeatherDay? {
        guard let timezone, let zone = TimeZone(identifier: timezone) else { return nil }
        var c = Calendar(identifier: .gregorian); c.timeZone = zone
        let p = c.dateComponents([.year, .month, .day], from: date)
        let key = String(format: "%04d-%02d-%02d", p.year!, p.month!, p.day!)
        return days.first { $0.date == key }
    }
    static func read() -> Self {
        guard let folder = WidgetStore.directory else { return Self(state: "error") }
        do {
            let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
            return try d.decode(Self.self, from: Data(contentsOf: folder.appendingPathComponent("weather-snapshot.json")))
        } catch {
            return WeatherWidgetModel.isMissing(error) ? .disconnected : Self(state: "error")
        }
    }
    func write() throws {
        let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970; e.outputFormatting = .sortedKeys
        try WidgetStore.atomicWrite(e.encode(self), name: "weather-snapshot.json")
    }
    static func example(at date: Date) -> Self {
        var s = Self(state: "example"); s.city = "示例城市"; s.temperature = 24; s.code = 2; s.isDay = true
        s.observedAt = date; s.fetchedAt = date; s.timezone = TimeZone.current.identifier
        s.days = [WidgetWeatherDay(date: TodoModel.dayKey(date), minimum: 22, maximum: 32)]
        return s
    }
}
enum WeatherWidgetError: Error, Equatable { case invalid, mismatchedCity, missingConsent }
enum WeatherWidgetModel {
    static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }
    static func boolean(_ value: Any?) -> Bool? {
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }; return n.boolValue
    }
    static func isMissing(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == NSCocoaErrorDomain && [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(e.code)
    }
    static func object(_ data: Data) throws -> [String: Any] {
        guard data.count <= 4 * 1024 * 1024, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw WeatherWidgetError.invalid }
        return value
    }
    static func validDay(_ value: String) -> Bool {
        guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return false }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0)!
        guard parts.count == 3, let d = c.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return false }
        return c.component(.year, from: d) == parts[0] && c.component(.month, from: d) == parts[1] && c.component(.day, from: d) == parts[2]
    }
    static func decode(config: Data, cache: Data?, now: Date) throws -> WidgetWeatherSnapshot {
        let c = try object(config)
        guard let enabled = boolean(c["enabled"]) else { throw WeatherWidgetError.invalid }
        guard enabled else { return WidgetWeatherSnapshot(state: "disabled") }
        guard let city = c["city"] as? [String: Any],
              let lat = number(city["latitude"]), (-90...90).contains(lat),
              let lon = number(city["longitude"]), (-180...180).contains(lon) else { return WidgetWeatherSnapshot(state: "unconfigured") }
        if city["mode"] as? String == "current", boolean(city["locationSharingAccepted"]) != true { throw WeatherWidgetError.missingConsent }
        var s = WidgetWeatherSnapshot(state: "waiting")
        let mode = city["mode"] as? String ?? "manual"
        s.cityID = identifier("\(lat)|\(lon)|\(mode)")
        s.city = String(((city["name"] as? String) ?? "已选城市").prefix(40))
        guard let cache else { return s }
        let raw = try object(cache)
        guard let savedCity = raw["city"] as? [String: Any],
              let savedLat = number(savedCity["latitude"]), let savedLon = number(savedCity["longitude"]),
              savedLat == lat, savedLon == lon else { throw WeatherWidgetError.mismatchedCity }
        guard let current = raw["current"] as? [String: Any],
              let t = number(current["temperature"]), (-100...70).contains(t),
              let code = number(current["weatherCode"]), (0...99).contains(code), code.rounded(.down) == code,
              let day = number(current["isDay"]), [0, 1].contains(day),
              let time = number(current["time"]), time > 0, time / 1000 <= now.timeIntervalSince1970 + 15 * 60,
              let updated = number(raw["updatedAt"]), updated > 0, updated / 1000 <= now.timeIntervalSince1970 + 60,
              let rows = raw["daily"] as? [[String: Any]], !rows.isEmpty, rows.count <= 8 else { throw WeatherWidgetError.invalid }
        var days: [WidgetWeatherDay] = [], seen = Set<String>()
        for row in rows {
            guard let date = row["date"] as? String, validDay(date), seen.insert(date).inserted,
                  let low = number(row["min"]), let high = number(row["max"]), (-100...70).contains(low), (-100...70).contains(high), low <= high else { throw WeatherWidgetError.invalid }
            days.append(WidgetWeatherDay(date: date, minimum: low, maximum: high))
        }
        s.state = "ready"
        s.temperature = t; s.code = Int(code); s.isDay = day == 1
        s.observedAt = Date(timeIntervalSince1970: time / 1000); s.fetchedAt = Date(timeIntervalSince1970: updated / 1000); s.days = days
        let zone = raw["timezone"] as? String ?? city["timezone"] as? String ?? ""
        if TimeZone(identifier: zone) != nil { s.timezone = zone }
        else if let offset = number(raw["utcOffsetSeconds"]), (-50400...50400).contains(offset), offset.rounded(.down) == offset { s.timezone = TimeZone(secondsFromGMT: Int(offset))?.identifier }
        return s
    }
    static func identifier(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
    static func nextCityMidnight(after date: Date, timezone: String?) -> Date? {
        guard let timezone, let zone = TimeZone(identifier: timezone) else { return nil }
        var c = Calendar(identifier: .gregorian); c.timeZone = zone
        return c.date(byAdding: .day, value: 1, to: c.startOfDay(for: date))
    }
    static func condition(_ code: Int, isDay: Bool) -> (String, String) {
        switch code {
        case 0: return ("晴", isDay ? "sun.max.fill" : "moon.stars.fill")
        case 1, 2: return ("晴间多云", isDay ? "cloud.sun.fill" : "cloud.moon.fill")
        case 3: return ("阴", "cloud.fill")
        case 45, 48: return ("雾", "cloud.fog.fill")
        case 51, 53, 55: return ("毛毛雨", "cloud.drizzle.fill")
        case 56, 57, 66, 67: return ("冻雨", "cloud.sleet.fill")
        case 61, 63, 65: return ("雨", "cloud.rain.fill")
        case 71, 73, 75, 77: return ("雪", "cloud.snow.fill")
        case 80...82: return ("阵雨", "cloud.heavyrain.fill")
        case 85, 86: return ("阵雪", "cloud.snow.fill")
        case 95, 96, 99: return ("雷雨", "cloud.bolt.rain.fill")
        default: return ("天气", "cloud.fill")
        }
    }
}
