import Foundation
import Darwin

enum WidgetStore {
    private static let configuration: [String: Any] = {
        if let group = Bundle.main.object(forInfoDictionaryKey: "QiuqiuWidgetAppGroup") as? String {
            return ["appGroup": group, "urlScheme": Bundle.main.object(forInfoDictionaryKey: "QiuqiuWidgetURLScheme") as? String ?? "qiuqiu-widget"]
        }
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        for url in configurationURLs(for: executable) {
            if let data = try? Data(contentsOf: url), data.count <= 4096,
               let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { return value }
        }
        return [:]
    }()
    static func configurationURLs(for executable: URL) -> [URL] {
        let helperDirectory = executable.standardizedFileURL.deletingLastPathComponent()
        let contents = helperDirectory.deletingLastPathComponent()
        var urls: [URL] = []
        if helperDirectory.lastPathComponent == "Helpers", contents.lastPathComponent == "Contents",
           contents.deletingLastPathComponent().pathExtension == "app" {
            urls.append(contents.appendingPathComponent("Resources/QiuqiuWidgetBridge.json"))
        }
        // The sibling is retained solely for standalone CLI builds and older local fixtures.
        urls.append(helperDirectory.appendingPathComponent("QiuqiuWidgetBridge.json"))
        return urls
    }
    static let group: String = {
        guard let value = configuration["appGroup"] as? String,
              value.range(of: #"^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]{1,200}$"#, options: .regularExpression) != nil else { return "" }
        return value
    }()
    static var directory: URL? {
        guard !group.isEmpty else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }
    static func link(_ action: String) -> URL {
        let proposed = configuration["urlScheme"] as? String ?? "qiuqiu-widget"
        let scheme = proposed.range(of: #"^[a-z][a-z0-9+.-]{1,63}$"#, options: .regularExpression) != nil ? proposed : "qiuqiu-widget"
        var url = URLComponents(); url.scheme = scheme
        url.host = ["calendar", "todos", "connect-weather"].contains(action) ? action : "calendar"
        return url.url!
    }
    static func read(_ name: String) -> [String: Any] {
        guard let url = directory?.appendingPathComponent(name), let data = try? Data(contentsOf: url),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return value
    }
    // Create the replacement with owner-only access before writing any contents.
    static func atomicWrite(_ data: Data, name: String) throws {
        guard let directory, name.range(of: #"^[a-z0-9-]+\.json$"#, options: .regularExpression) != nil else { throw CocoaError(.fileWriteNoPermission) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporary = directory.appendingPathComponent(".widget-" + UUID().uuidString)
        guard FileManager.default.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteUnknown) }
        defer { try? FileManager.default.removeItem(at: temporary) }
        try data.write(to: temporary, options: .completeFileProtectionUntilFirstUserAuthentication)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        let fd = open(temporary.path, O_RDONLY)
        if fd >= 0 { _ = fsync(fd); close(fd) }
        guard rename(temporary.path, directory.appendingPathComponent(name).path) == 0 else { throw CocoaError(.fileWriteUnknown) }
    }
    static func write(_ value: [String: Any], to name: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        try? atomicWrite(data, name: name)
    }
    static func record(_ phase: String, settings: [String: Any]) {
        // Widget providers retain their diagnostic call sites without exporting personal data.
    }
}

enum MonthModel {
    static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.firstWeekday = 2; return c }
    static func cells(for date: Date) -> [Date] {
        let c = calendar
        let start = c.date(from: c.dateComponents([.year, .month], from: date))!
        let offset = (c.component(.weekday, from: start) + 5) % 7
        return (0..<42).map { c.date(byAdding: .day, value: $0 - offset, to: start)! }
    }
}

enum DayModel {
    static func week(for date: Date) -> [Date] {
        let c = MonthModel.calendar, start = c.startOfDay(for: date)
        let offset = (c.component(.weekday, from: start) + 5) % 7
        return (0..<7).map { c.date(byAdding: .day, value: $0 - offset, to: start)! }
    }
    static func dayRange(for date: Date) -> ClosedRange<Date> {
        let c = MonthModel.calendar, start = c.startOfDay(for: date)
        return start...c.date(byAdding: .day, value: 1, to: start)!
    }
    static func lunar(for date: Date) -> String {
        var c = Calendar(identifier: .chinese); c.timeZone = .current
        let months = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"]
        let days = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"]
        let parts = c.dateComponents([.month, .day, .isLeapMonth], from: date)
        guard let month = parts.month, let day = parts.day, (1...12).contains(month), (1...30).contains(day) else { return "" }
        return "农历 " + (parts.isLeapMonth == true ? "闰" : "") + months[month - 1] + days[day - 1]
    }
    static func midnights(after date: Date) -> [Date] {
        let c = MonthModel.calendar, start = c.startOfDay(for: date)
        return [date] + (1...7).map { c.date(byAdding: .day, value: $0, to: start)! }
    }
}
