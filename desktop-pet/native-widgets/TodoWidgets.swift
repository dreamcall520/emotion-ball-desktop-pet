import SwiftUI
import WidgetKit

struct TodoEntry: TimelineEntry { let date: Date; let snapshot: TodoSnapshot }
struct TodoProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodoEntry { TodoEntry(date: Date(), snapshot: .example(at: Date())) }
    func getSnapshot(in context: Context, completion: @escaping (TodoEntry) -> Void) {
        let now = Date(), source = TodoSnapshot.read()
        completion(TodoEntry(date: now, snapshot: context.isPreview && source.syncedAt == nil ? .example(at: now) : source))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodoEntry>) -> Void) {
        let now = Date(), source = TodoSnapshot.read()
        let dates = [now] + DayModel.midnights(after: now).dropFirst().prefix(2) + source.items.compactMap(\.reminderAt).filter { $0 > now && $0 < now.addingTimeInterval(86400) }.prefix(32)
        let entries = Array(Set(dates)).sorted().map { TodoEntry(date: $0, snapshot: source) }
        WidgetStore.write(["date": ISO8601DateFormatter().string(from: now), "revision": source.revision, "state": source.state, "itemCount": source.items.count, "process": ProcessInfo.processInfo.processIdentifier], to: "todo-widget-result.json")
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(1800))))
    }
}

struct TodoFooter: View {
    let snapshot: TodoSnapshot
    var body: some View {
        HStack(spacing: 3) {
            if snapshot.state == "example" { Text("示例 · 连接后显示你的待办") }
            else if snapshot.state == "error" { Image(systemName: "exclamationmark.circle"); Text("同步暂停 · 保留上次结果") }
            else if let date = snapshot.syncedAt { Text("同步于"); Text(date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB"))) }
        }.font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
    }
}
struct TodoConnectionView: View {
    let title: String
    let symbol: String
    let error: Bool
    var waiting = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(.blue)
            Spacer(minLength: 0)
            Text(waiting ? "等待待办数据" : error ? "同步暂不可用" : "连接球球待办").font(.system(size: 19, weight: .semibold))
            Text(waiting ? "在球球保存事项后自动同步" : error ? "点击重新连接" : "点击连接，查看你的事项")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
struct TodoLine: View {
    let item: TodoItem
    let now: Date
    let showDate: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 13, weight: .medium)).foregroundStyle(item.completed ? Color.blue : Color.secondary.opacity(0.6)).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.system(size: 13, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
                if showDate && !item.dueDate.isEmpty {
                    Text(item.dueDate == TodoModel.dayKey(now) ? "今天" : item.dueDate < TodoModel.dayKey(now) ? "已逾期 · " + item.dueDate : item.dueDate)
                        .font(.system(size: 10)).foregroundStyle(item.dueDate < TodoModel.dayKey(now) ? Color.orange : Color.secondary)
                }
            }
            Spacer(minLength: 0)
            if let date = item.reminderAt, ["pending", "presented"].contains(item.reminderState) {
                Text(date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB")))
                    .font(.system(size: 11, weight: .medium, design: .rounded)).foregroundStyle(.blue)
            } else if !showDate && !item.dueDate.isEmpty && item.dueDate < TodoModel.dayKey(now) {
                Text("逾期").font(.system(size: 10, weight: .medium)).foregroundStyle(.orange)
            }
        }.privacySensitive()
    }
}

struct TodayTodoView: View {
    let entry: TodoEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let today = TodoModel.today(entry.snapshot, at: entry.date)
        let pending = today.filter { !$0.completed && !$0.archived }
        let done = today.filter(\.completed).count
        Group {
            if ["disconnected", "waiting"].contains(entry.snapshot.state) || entry.snapshot.state == "error" && entry.snapshot.syncedAt == nil {
                TodoConnectionView(title: "今日待办", symbol: "checklist", error: entry.snapshot.state == "error", waiting: entry.snapshot.state == "waiting")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Label("今日待办", systemImage: "checklist").font(.system(size: 13, weight: .semibold)).foregroundStyle(.blue); Spacer(); if family == .systemMedium { Text(entry.date, format: .dateTime.month().day()).font(.system(size: 11)).foregroundStyle(.secondary) } }
                    HStack(alignment: .center, spacing: 18) {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text(String(pending.count)).font(.system(size: 48, weight: .semibold, design: .rounded)).foregroundStyle(.blue)
                                Text("项待完成").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                            }
                            Text("已完成 \(done) 项").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                        }
                        if family == .systemMedium {
                            VStack(alignment: .leading, spacing: 9) {
                                if pending.isEmpty { Text(today.isEmpty ? "今天还没有待办" : "今天都完成了").font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary) }
                                ForEach(Array(pending.prefix(2))) { TodoLine(item: $0, now: entry.date, showDate: false) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    TodoFooter(snapshot: entry.snapshot)
                }
            }
        }
        .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom) }
        .widgetURL(WidgetStore.link("todos"))
    }
}

struct TodoListView: View {
    let entry: TodoEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let pending = TodoModel.pending(entry.snapshot)
        let limit = family == .systemLarge ? 7 : 3
        Group {
            if ["disconnected", "waiting"].contains(entry.snapshot.state) || entry.snapshot.state == "error" && entry.snapshot.syncedAt == nil {
                TodoConnectionView(title: "待办清单", symbol: "list.bullet", error: entry.snapshot.state == "error", waiting: entry.snapshot.state == "waiting")
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    HStack { Label("待办清单", systemImage: "list.bullet").font(.system(size: 13, weight: .semibold)).foregroundStyle(.blue); Spacer(); Text("\(pending.count) 项").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary) }
                    if pending.isEmpty { Spacer(); Text("都处理好了").font(.system(size: 19, weight: .semibold)); Text("新的待办会显示在这里").font(.system(size: 11)).foregroundStyle(.secondary); Spacer() }
                    ForEach(Array(pending.prefix(limit))) { item in
                        TodoLine(item: item, now: entry.date, showDate: family == .systemLarge)
                    }
                    Spacer(minLength: 0)
                    HStack { TodoFooter(snapshot: entry.snapshot); Spacer(); if pending.count > limit { Text("还有 \(pending.count - limit) 项").font(.system(size: 10, weight: .medium)).foregroundStyle(.blue) } }
                }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom) }
        .widgetURL(WidgetStore.link("todos"))
    }
}

struct NextReminderView: View {
    let entry: TodoEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let item = TodoModel.nextReminder(entry.snapshot)
        Group {
            if ["disconnected", "waiting"].contains(entry.snapshot.state) || entry.snapshot.state == "error" && entry.snapshot.syncedAt == nil {
                TodoConnectionView(title: "下一条提醒", symbol: "bell", error: entry.snapshot.state == "error", waiting: entry.snapshot.state == "waiting")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Label((item?.reminderAt ?? .distantFuture) <= entry.date ? "待处理提醒" : "下一条提醒", systemImage: "bell")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(.orange)
                    if let item, let time = item.reminderAt {
                        HStack(spacing: 18) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(time, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB")))
                                    .font(.system(size: family == .systemMedium ? 40 : 34, weight: .semibold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.8)
                                if !MonthModel.calendar.isDate(time, inSameDayAs: entry.date) { Text(time, format: .dateTime.month().day()).font(.system(size: 10)).foregroundStyle(.secondary) }
                            }
                            if family == .systemMedium { Text(item.title).font(.system(size: 17, weight: .semibold)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading).privacySensitive() }
                        }.frame(maxHeight: .infinity, alignment: .leading)
                        if family == .systemSmall { Text(item.title).font(.system(size: 13, weight: .medium)).lineLimit(2).privacySensitive() }
                        if time > entry.date { (Text("还有 ") + Text(time, style: .relative)).font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary) }
                        else { Text("提醒时间已到").font(.system(size: 10, weight: .medium)).foregroundStyle(.orange) }
                    } else { Spacer(); Text("暂时没有提醒").font(.system(size: 18, weight: .semibold)); Text("在球球为待办设置提醒时间").font(.system(size: 10)).foregroundStyle(.secondary); Spacer() }
                    TodoFooter(snapshot: entry.snapshot)
                }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .containerBackground(for: .widget) { LinearGradient(colors: [.orange.opacity(0.07), .clear], startPoint: .top, endPoint: .bottom) }
        .widgetURL(WidgetStore.link("todos"))
    }
}

struct QiuqiuTodayTodoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeTodoTodayProbe", provider: TodoProvider()) { TodayTodoView(entry: $0) }
            .configurationDisplayName("待办 · 今日待办").description("今天还剩几项，一眼看到完成情况。").supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct QiuqiuTodoListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeTodoListProbe", provider: TodoProvider()) { TodoListView(entry: $0) }
            .configurationDisplayName("待办 · 待办清单").description("把未完成的事项放在桌面，点击打开便签与待办。").supportedFamilies([.systemMedium, .systemLarge])
    }
}
struct QiuqiuNextReminderWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeNextReminderProbe", provider: TodoProvider()) { NextReminderView(entry: $0) }
            .configurationDisplayName("待办 · 下一条提醒").description("最近的待办提醒，时间与事项一起看。").supportedFamilies([.systemSmall, .systemMedium])
    }
}
