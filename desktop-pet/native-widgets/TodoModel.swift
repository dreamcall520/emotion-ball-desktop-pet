import Foundation
import CoreFoundation

struct TodoItem: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let dueDate: String
    let completed: Bool
    let archived: Bool
    let reminderAt: Date?
    let reminderState: String
    let createdAt: Date
}

struct TodoSnapshot: Codable {
    var schema = 1
    var sourceID: String? = nil
    var state: String
    var syncedAt: Date?
    var revision: Int
    var items: [TodoItem]
    static var disconnected: TodoSnapshot { TodoSnapshot(state: "disconnected", syncedAt: nil, revision: 0, items: []) }
    static func read() -> TodoSnapshot {
        guard let url = WidgetStore.directory?.appendingPathComponent("todo-snapshot.json") else { return TodoSnapshot(state: "error", syncedAt: nil, revision: 0, items: []) }
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .secondsSince1970
            return try decoder.decode(Self.self, from: data)
        } catch {
            let failure = error as NSError
            if failure.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(failure.code) { return .disconnected }
            return TodoSnapshot(state: "error", syncedAt: nil, revision: 0, items: [])
        }
    }
    func write(to filename: String = "todo-snapshot.json") throws {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .secondsSince1970; encoder.outputFormatting = .sortedKeys
        try WidgetStore.atomicWrite(encoder.encode(self), name: filename)
    }
    static func example(at date: Date) -> TodoSnapshot {
        let today = TodoModel.dayKey(date)
        return TodoSnapshot(state: "example", syncedAt: nil, revision: 0, items: [
            TodoItem(id: "sample-1", title: "整理今天的计划", dueDate: today, completed: false, archived: false, reminderAt: date.addingTimeInterval(3600), reminderState: "pending", createdAt: date),
            TodoItem(id: "sample-2", title: "读完一章书", dueDate: today, completed: false, archived: false, reminderAt: nil, reminderState: "none", createdAt: date.addingTimeInterval(1)),
            TodoItem(id: "sample-3", title: "喝杯水，休息一下", dueDate: today, completed: true, archived: false, reminderAt: nil, reminderState: "none", createdAt: date.addingTimeInterval(2)),
            TodoItem(id: "sample-4", title: "确认明天的安排", dueDate: today, completed: false, archived: false, reminderAt: nil, reminderState: "none", createdAt: date.addingTimeInterval(3)),
            TodoItem(id: "sample-5", title: "回复一条重要消息", dueDate: today, completed: false, archived: false, reminderAt: nil, reminderState: "none", createdAt: date.addingTimeInterval(4)),
            TodoItem(id: "sample-6", title: "散步十分钟", dueDate: today, completed: false, archived: false, reminderAt: nil, reminderState: "none", createdAt: date.addingTimeInterval(5))
        ])
    }
}

enum TodoReadError: Error { case invalid }
enum TodoModel {
    static func number(_ value: Any?) -> Double? {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return nil }
        return value.doubleValue
    }
    static func boolean(_ value: Any?) -> Bool? {
        guard let value = value as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
        return value.boolValue
    }
    static func dayKey(_ date: Date) -> String {
        let c = MonthModel.calendar, p = c.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year!, p.month!, p.day!)
    }
    static func decodeSource(_ data: Data, now: Date) throws -> TodoSnapshot {
        guard data.count <= 4 * 1024 * 1024,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let schema = number(root["schema"]), [1.0, 2.0].contains(schema),
              let revision = number(root["revision"]), revision >= 0, revision <= 9007199254740991, revision.rounded(.down) == revision,
              let rows = root["todos"] as? [[String: Any]], rows.count <= 5000 else { throw TodoReadError.invalid }
        var items: [TodoItem] = [], ids = Set<String>()
        for row in rows {
            guard let id = row["id"] as? String, !id.isEmpty, ids.insert(id).inserted,
                  let title = row["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 200,
                  let due = row["dueDate"] as? String, validDay(due),
                  let completed = boolean(row["completed"]), let archived = boolean(row["archived"]), !archived || completed,
                  let state = row["reminderState"] as? String, ["none", "pending", "presented", "dismissed", "cancelled"].contains(state),
                  let created = number(row["createdAt"]), number(row["updatedAt"]) != nil,
                  let occurrence = row["occurrenceId"] as? String else { throw TodoReadError.invalid }
            if completed && number(row["completedAt"]) == nil { throw TodoReadError.invalid }
            if let deletion = row["deletedAt"], !(deletion is NSNull), number(deletion) == nil { throw TodoReadError.invalid }
            let reminder: Date?
            if row["reminderAt"] is NSNull { reminder = nil }
            else if let millis = number(row["reminderAt"]) { reminder = Date(timeIntervalSince1970: millis / 1000) }
            else { throw TodoReadError.invalid }
            if ["pending", "presented"].contains(state) && (reminder == nil || occurrence.isEmpty) { throw TodoReadError.invalid }
            if let deletion = row["deletedAt"], !(deletion is NSNull) { continue }
            items.append(TodoItem(id: id, title: title, dueDate: due, completed: completed, archived: archived, reminderAt: reminder, reminderState: state, createdAt: Date(timeIntervalSince1970: created / 1000)))
        }
        return TodoSnapshot(state: "ready", syncedAt: now, revision: Int(revision), items: items)
    }
    static func validDay(_ value: String) -> Bool {
        if value.isEmpty { return true }
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = MonthModel.calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else { return false }
        return dayKey(date) == value
    }
    static func today(_ snapshot: TodoSnapshot, at date: Date) -> [TodoItem] { snapshot.items.filter { $0.dueDate == dayKey(date) } }
    static func pending(_ snapshot: TodoSnapshot) -> [TodoItem] {
        snapshot.items.filter { !$0.completed && !$0.archived }.sorted {
            if $0.dueDate != $1.dueDate { return ($0.dueDate.isEmpty ? "9999" : $0.dueDate) < ($1.dueDate.isEmpty ? "9999" : $1.dueDate) }
            return $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt
        }
    }
    static func nextReminder(_ snapshot: TodoSnapshot) -> TodoItem? {
        snapshot.items.filter { !$0.completed && !$0.archived && $0.reminderAt != nil && ["pending", "presented"].contains($0.reminderState) }
            .sorted { $0.reminderAt == $1.reminderAt ? $0.createdAt < $1.createdAt : $0.reminderAt! < $1.reminderAt! }.first
    }
}
