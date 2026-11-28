import SwiftUI
import WidgetKit

struct MonthEntry: TimelineEntry { let date: Date; let sharedRead: Bool }
struct MonthProvider: TimelineProvider {
    func placeholder(in context: Context) -> MonthEntry { MonthEntry(date: Date(), sharedRead: false) }
    func getSnapshot(in context: Context, completion: @escaping (MonthEntry) -> Void) {
        let settings = WidgetStore.read("widget-settings.json")
        WidgetStore.record(context.isPreview ? "gallery-snapshot" : "snapshot", settings: settings)
        completion(MonthEntry(date: Date(), sharedRead: settings["schema"] as? Int == 1))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<MonthEntry>) -> Void) {
        let settings = WidgetStore.read("widget-settings.json"), now = Date()
        WidgetStore.record("timeline", settings: settings)
        completion(Timeline(entries: DayModel.midnights(after: now).map { MonthEntry(date: $0, sharedRead: settings["schema"] as? Int == 1) }, policy: .atEnd))
    }
}

struct MonthGrid: View {
    let date: Date
    @Environment(\.widgetRenderingMode) var renderingMode
    private let blue = Color(red: 0.04, green: 0.39, blue: 0.96)
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 2) {
                Text(date, format: .dateTime.year().month(.wide)).font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 0)
            }
            Grid(horizontalSpacing: 0, verticalSpacing: 2) {
                GridRow {
                    ForEach(Array(["一", "二", "三", "四", "五", "六", "日"].enumerated()), id: \.offset) { _, label in
                        Text(label).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                    }
                }
                ForEach(0..<6, id: \.self) { week in
                    GridRow {
                        ForEach(0..<7, id: \.self) { day in
                            let item = MonthModel.cells(for: date)[week * 7 + day]
                            let today = MonthModel.calendar.isDate(item, inSameDayAs: date)
                            let sameMonth = MonthModel.calendar.isDate(item, equalTo: date, toGranularity: .month)
                            Text(String(MonthModel.calendar.component(.day, from: item)))
                                .font(.system(size: 10, weight: today ? .bold : .medium, design: .rounded))
                                .foregroundStyle(today ? (renderingMode == .fullColor ? Color.white : Color.primary) : sameMonth ? Color.primary : Color.secondary.opacity(0.45))
                                .frame(width: 18, height: 14)
                                .background { if today { Circle().fill(renderingMode == .fullColor ? blue : Color.primary.opacity(0.18)).frame(width: 16, height: 16) } }
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }
}

struct MonthWidgetView: View {
    var entry: MonthEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        HStack(spacing: 20) {
            MonthGrid(date: entry.date)
            if family == .systemMedium {
                Divider()
                VStack(alignment: .center, spacing: 7) {
                    Text("今天").font(.system(size: 12, weight: .semibold)).foregroundStyle(.blue)
                    Text(entry.date, format: .dateTime.day()).font(.system(size: 48, weight: .semibold, design: .rounded))
                    Text(entry.date, format: .dateTime.weekday(.wide)).font(.system(size: 13, weight: .medium))
                    Text(DayModel.lunar(for: entry.date)).font(.system(size: 11)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
            }
        }
        .containerBackground(for: .widget) {
            LinearGradient(colors: [Color.blue.opacity(0.10), Color.clear], startPoint: .top, endPoint: .bottom)
        }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct QiuqiuMonthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeMonthProbe", provider: MonthProvider()) { MonthWidgetView(entry: $0) }
            .configurationDisplayName("日历 · 月历")
            .description("一眼查看本月日期，点击打开球球日历。")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct DateWidgetView: View {
    let entry: MonthEntry
    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 6) {
                Text(entry.date, format: .dateTime.weekday(.wide)).foregroundStyle(.blue)
                Text(entry.date, format: .dateTime.month()).foregroundStyle(.secondary)
            }.font(.system(size: 13, weight: .semibold))
            Text(String(MonthModel.calendar.component(.day, from: entry.date)))
                .font(.system(size: 76, weight: .semibold, design: .rounded))
                .minimumScaleFactor(0.7).lineLimit(1).frame(maxWidth: .infinity)
            Text(DayModel.lunar(for: entry.date)).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom) }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct WeekWidgetView: View {
    let entry: MonthEntry
    @Environment(\.widgetRenderingMode) var renderingMode
    var body: some View {
        let week = DayModel.week(for: entry.date)
        let c = MonthModel.calendar
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("\(c.component(.month, from: week[0]))月\(c.component(.day, from: week[0]))日 – \(c.component(.month, from: week[6]))月\(c.component(.day, from: week[6]))日")
                    .font(.system(size: 13, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.85)
                Spacer()
                Text(String(c.component(.year, from: entry.date))).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            }
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    ForEach(Array(week.enumerated()), id: \.offset) { index, date in
                        let today = c.isDate(date, inSameDayAs: entry.date)
                        VStack(spacing: 9) {
                            Text(["一", "二", "三", "四", "五", "六", "日"][index])
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(today && renderingMode == .fullColor ? Color.white.opacity(0.8) : Color.secondary)
                            Text(String(c.component(.day, from: date)))
                                .font(.system(size: 23, weight: .semibold, design: .rounded))
                                .fixedSize(horizontal: true, vertical: false)
                                .foregroundStyle(today && renderingMode == .fullColor ? Color.white : Color.primary)
                        }
                        .frame(width: geometry.size.width / 7, height: 64)
                        .background {
                            if today { RoundedRectangle(cornerRadius: 17, style: .continuous)
                                .fill(renderingMode == .fullColor ? Color.blue : Color.primary.opacity(0.12))
                                .frame(width: min(38, geometry.size.width / 7 - 3)) }
                        }
                    }
                }
            }.frame(height: 64)
            Text(DayModel.lunar(for: entry.date)).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
        }.frame(maxHeight: .infinity)
        .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom) }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct DaylightWidgetView: View {
    let entry: MonthEntry
    @Environment(\.widgetFamily) var family
    @ViewBuilder private var liveTime: some View {
        if #available(macOS 15.0, *) {
            Text(.currentDate, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB")))
        } else {
            Text(timerInterval: DayModel.dayRange(for: entry.date), countsDown: false, showsHours: true)
        }
    }
    var body: some View {
        HStack(spacing: 18) {
            VStack(alignment: .center, spacing: 0) {
                HStack(spacing: 7) {
                    Text(entry.date, format: .dateTime.month().day())
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                    if family == .systemMedium {
                        Rectangle().fill(Color.primary.opacity(0.14))
                            .frame(width: 1, height: 12).accessibilityHidden(true)
                        Text(entry.date, format: .dateTime.weekday(.wide))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.blue)
                    }
                }.frame(maxWidth: .infinity)
                Spacer(minLength: 6)
                liveTime
                    .font(.system(size: family == .systemMedium ? 58 : 48, weight: .semibold, design: .rounded))
                    .tracking(-1.5).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 8)
                if family == .systemSmall {
                    Text(entry.date, format: .dateTime.weekday(.wide))
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(.blue)
                    Text(DayModel.lunar(for: entry.date))
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).padding(.top, 4)
                }
                if #unavailable(macOS 15.0) {
                    Text("今天已走过").font(.system(size: 10)).foregroundStyle(.secondary).padding(.top, 3)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .multilineTextAlignment(.center)
            if family == .systemMedium {
                VStack(alignment: .center, spacing: 4) {
                    Text("今天").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                    Text(String(MonthModel.calendar.component(.day, from: entry.date)))
                        .font(.system(size: 48, weight: .semibold, design: .rounded)).foregroundStyle(.blue)
                    Text(DayModel.lunar(for: entry.date).replacingOccurrences(of: "农历 ", with: ""))
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                }.frame(width: 84, height: 118)
                .background(.blue.opacity(0.05), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom) }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct QiuqiuDateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeDateProbe", provider: MonthProvider()) { DateWidgetView(entry: $0) }
            .configurationDisplayName("日历 · 日期").description("大字日期，搭配星期与农历。").supportedFamilies([.systemSmall])
    }
}
struct QiuqiuWeekWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeWeekProbe", provider: MonthProvider()) { WeekWidgetView(entry: $0) }
            .configurationDisplayName("日历 · 周历").description("一周七天，今天一眼可见。").supportedFamilies([.systemMedium])
    }
}
struct QiuqiuDaylightWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeDaylightProbe", provider: MonthProvider()) { DaylightWidgetView(entry: $0) }
            .configurationDisplayName("时间 · 时钟").description("清晰的时间，搭配星期与农历。").supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct QiuqiuCalendarWidgetGroup: WidgetBundle {
    var body: some Widget {
        QiuqiuMonthWidget()
        QiuqiuDateWidget()
        QiuqiuWeekWidget()
        QiuqiuCompanionMonthWidget()
        QiuqiuCompanionDateWidget()
        QiuqiuCompanionPanelWidget()
    }
}
struct QiuqiuTimeWidgetGroup: WidgetBundle {
    var body: some Widget {
        QiuqiuDaylightWidget()
        QiuqiuTimeProgressWidget()
        QiuqiuDualClockWidget()
    }
}
struct QiuqiuTodoWidgetGroup: WidgetBundle {
    var body: some Widget {
        QiuqiuTodayTodoWidget()
        QiuqiuTodoListWidget()
        QiuqiuNextReminderWidget()
        QiuqiuAccentTodoWidget()
    }
}
@main struct QiuqiuWidgetBundle: WidgetBundle {
    var body: some Widget {
        QiuqiuCalendarWidgetGroup().body
        QiuqiuTimeWidgetGroup().body
        QiuqiuWeatherWeekWidget()
        QiuqiuWeatherCardWidget()
        QiuqiuTodoWidgetGroup().body
        QiuqiuAccentOverviewWidget()
    }
}
