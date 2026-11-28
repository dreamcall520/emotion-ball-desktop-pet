import Foundation

enum AccentTimeModel {
    static func fraction(_ component: Calendar.Component, at date: Date, calendar: Calendar = MonthModel.calendar) -> Double {
        guard let interval = calendar.dateInterval(of: component, for: date), interval.duration > 0 else { return 0 }
        return min(1, max(0, date.timeIntervalSince(interval.start) / interval.duration))
    }
    static func remainingHours(at date: Date, calendar: Calendar = MonthModel.calendar) -> Int {
        guard let end = calendar.dateInterval(of: .day, for: date)?.end else { return 0 }
        return max(0, Int(ceil(end.timeIntervalSince(date) / 3600)))
    }
    static func remainingMonthDays(at date: Date, calendar: Calendar = MonthModel.calendar) -> Int {
        guard let count = calendar.range(of: .day, in: .month, for: date)?.count else { return 0 }
        return max(0, count - calendar.component(.day, from: date))
    }
    static func dates(after date: Date, calendar: Calendar = MonthModel.calendar) -> [Date] {
        let minute = calendar.dateInterval(of: .minute, for: date)!.start
        let next = calendar.date(byAdding: .minute, value: 5 - calendar.component(.minute, from: minute) % 5, to: minute)!
        var dates = [date] + (0..<144).map { next.addingTimeInterval(Double($0) * 300) }
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date))!
        if midnight <= dates.last! { dates.append(midnight) }
        return Array(Set(dates)).sorted()
    }
}

struct AccentTodoSummary {
    let state: String
    let syncedAt: Date?
    let total: Int
    let done: Int
    let rows: [TodoItem]
    var connected: Bool { syncedAt != nil || state == "example" }
    var pending: Int { max(0, total - done) }
    static func make(_ source: TodoSnapshot, at date: Date) -> AccentTodoSummary {
        let today = TodoModel.today(source, at: date)
        let rows = today.filter { !$0.archived }.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
        return AccentTodoSummary(state: source.state, syncedAt: source.syncedAt, total: today.count, done: today.filter(\.completed).count, rows: Array(rows.prefix(8)))
    }
}
