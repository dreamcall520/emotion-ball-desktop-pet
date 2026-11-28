import SwiftUI
import WidgetKit

// Keep facial features in alpha in monochrome modes. WidgetKit may map opaque
// black and white shapes to one tint, so separate eye fills are not sufficient.
private struct CompanionOrbSilhouette: Shape {
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let origin = CGPoint(x: rect.midX - side / 2, y: rect.midY - side / 2)
        var path = Path()
        path.addEllipse(in: CGRect(origin: origin, size: CGSize(width: side, height: side)))
        for x in [0.35, 0.595] {
            let eye = CGRect(x: origin.x + side * x, y: origin.y + side * 0.41, width: side * 0.055, height: side * 0.15)
            path.addRoundedRect(in: eye, cornerSize: CGSize(width: side * 0.0275, height: side * 0.0275))
        }
        return path
    }
}

struct CompanionOrb: View {
    @Environment(\.widgetRenderingMode) private var mode
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            Group {
                if mode == .fullColor {
                    ZStack {
                        Circle()
                            .fill(RadialGradient(colors: [.white, Color(red: 0.96, green: 0.93, blue: 0.87), Color(red: 0.80, green: 0.75, blue: 0.66)], center: .init(x: 0.29, y: 0.20), startRadius: 0, endRadius: side * 0.94))
                            .overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 0.5))
                            .shadow(color: .black.opacity(0.12), radius: side * 0.06, x: 0, y: side * 0.045)
                        HStack(spacing: side * 0.19) {
                            Capsule().fill(Color(white: 0.12)).frame(width: side * 0.055, height: side * 0.15)
                            Capsule().fill(Color(white: 0.12)).frame(width: side * 0.055, height: side * 0.15)
                        }.offset(y: -side * 0.015)
                    }
                } else {
                    CompanionOrbSilhouette()
                        .fill(Color.primary.opacity(0.78), style: FillStyle(eoFill: true, antialiased: true))
                }
            }.frame(width: side, height: side)
        }.accessibilityHidden(true)
    }
}

struct CompanionSurface: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        if scheme == .dark {
            Color(white: 0.11)
        } else {
            LinearGradient(colors: [Color(red: 0.96, green: 0.985, blue: 1), .white], startPoint: .top, endPoint: .bottom)
        }
    }
}

struct CompanionMonthCalendar: View {
    let date: Date
    var showsOrb = false
    var compact = false
    @Environment(\.widgetRenderingMode) private var mode
    private var calendar: Calendar { MonthModel.calendar }
    var body: some View {
        let cells = MonthModel.cells(for: date)
        VStack(spacing: compact ? 3 : 5) {
            HStack(spacing: 4) {
                Text("\(String(calendar.component(.year, from: date)))年\(calendar.component(.month, from: date))月")
                    .font(.system(size: compact ? 11 : 13, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
                if showsOrb { CompanionOrb().frame(width: 27, height: 27) }
            }.frame(height: showsOrb ? 27 : (compact ? 15 : 18))
            GeometryReader { proxy in
                let rowHeight = max(10, proxy.size.height / 7)
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        ForEach(Array(["一", "二", "三", "四", "五", "六", "日"].enumerated()), id: \.offset) { _, text in
                            Text(text).font(.system(size: compact ? 8 : 9, weight: .medium))
                                .foregroundStyle(.secondary).frame(maxWidth: .infinity)
                        }
                    }.frame(height: rowHeight)
                    ForEach(0..<6, id: \.self) { week in
                        HStack(spacing: 0) {
                            ForEach(0..<7, id: \.self) { column in
                                let day = cells[week * 7 + column]
                                let sameMonth = calendar.isDate(day, equalTo: date, toGranularity: .month)
                                let today = calendar.isDate(day, inSameDayAs: date)
                                Text(sameMonth ? String(calendar.component(.day, from: day)) : " ")
                                    .font(.system(size: compact ? 9 : 10, weight: today ? .bold : .medium, design: .rounded))
                                    .foregroundStyle(today && mode == .fullColor ? Color.white : Color.primary)
                                    .frame(width: min(19, proxy.size.width / 7), height: min(18, rowHeight))
                                    .background {
                                        if today {
                                            Circle().fill(mode == .fullColor ? Color.blue : Color.primary.opacity(0.16))
                                                .frame(width: min(18, rowHeight), height: min(18, rowHeight))
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                            }
                        }.frame(height: rowHeight)
                    }
                }
            }
        }
    }
}

struct CompanionMonthView: View {
    let entry: MonthEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        HStack(spacing: 18) {
            CompanionMonthCalendar(date: entry.date, showsOrb: true)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if family == .systemMedium {
                Divider()
                VStack(spacing: 4) {
                    Text("今天").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                    Text(String(MonthModel.calendar.component(.day, from: entry.date)))
                        .font(.system(size: 46, weight: .semibold, design: .rounded))
                    Text(entry.date, format: .dateTime.weekday(.wide))
                        .font(.system(size: 12, weight: .semibold))
                    Text(DayModel.lunar(for: entry.date))
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }.frame(width: 120)
            }
        }
        .containerBackground(for: .widget) { CompanionSurface() }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct CompanionDateView: View {
    let entry: MonthEntry
    private var calendar: Calendar { MonthModel.calendar }
    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width, height = proxy.size.height
            let weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][calendar.component(.weekday, from: entry.date) - 1]
            ZStack {
                Text("\(weekday)  \(calendar.component(.month, from: entry.date))月")
                    .font(.system(size: 13, weight: .semibold))
                    .position(x: width / 2, y: 13)
                // The numeral is centered on the entire card, independently of
                // the mascot. Fixed regions also keep font metrics off the header.
                Text(String(calendar.component(.day, from: entry.date)))
                    .font(.system(size: min(77, height * 0.52), weight: .bold, design: .rounded))
                    .tracking(-2).lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: width, height: height * 0.64, alignment: .center)
                    .position(x: width / 2, y: height * 0.50)
                HStack {
                    Text(DayModel.lunar(for: entry.date)).font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.85)
                    Spacer(minLength: 0)
                }.padding(.trailing, 40).frame(width: width, height: 22)
                    .position(x: width / 2, y: height - 11)
                CompanionOrb().frame(width: 36, height: 36)
                    .position(x: width - 18, y: height - 18)
            }.frame(width: width, height: height)
        }
        .containerBackground(for: .widget) { CompanionSurface() }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct CompanionPanelDate: View {
    let date: Date
    let large: Bool
    private var calendar: Calendar { MonthModel.calendar }
    var body: some View {
        if large {
            VStack(spacing: 4) {
                HStack(spacing: 7) {
                    Text("今天 · \(calendar.component(.month, from: date))月")
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Spacer(minLength: 0)
                    CompanionOrb().frame(width: 31, height: 31)
                }
                Text(String(calendar.component(.day, from: date)))
                    .font(.system(size: 57, weight: .bold, design: .rounded))
                    .lineLimit(1).minimumScaleFactor(0.8).frame(maxWidth: .infinity)
                Text(date, format: .dateTime.weekday(.wide))
                    .font(.system(size: 12, weight: .semibold))
                Text(DayModel.lunar(for: date))
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }.frame(maxWidth: .infinity)
        } else {
            HStack(spacing: 7) {
                CompanionOrb().frame(width: 27, height: 27)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(calendar.component(.month, from: date))月\(calendar.component(.day, from: date))日")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    HStack(spacing: 3) {
                        Text("今天 ·")
                        Text(date, format: .dateTime.weekday(.wide))
                    }.font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
                    Text(DayModel.lunar(for: date))
                        .font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        }
    }
}

struct CompanionPanelTasks: View {
    let todo: AccentTodoSummary
    let limit: Int
    let large: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: large ? 9 : 5) {
            HStack(spacing: 4) {
                Text("今日待办").font(.system(size: large ? 12 : 10, weight: .semibold))
                Spacer(minLength: 0)
                if todo.connected {
                    Text("\(todo.pending)项未完成").font(.system(size: large ? 10 : 8)).foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            if todo.connected {
                if todo.rows.isEmpty {
                    Text(todo.total == 0 ? "今天还没有待办" : "今天都完成了")
                        .font(.system(size: large ? 12 : 10)).foregroundStyle(.secondary)
                } else {
                    ForEach(Array(todo.rows.prefix(limit))) { item in
                        HStack(spacing: 6) {
                            Capsule().fill(Color.blue).frame(width: 3)
                            Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(item.completed ? Color.blue : Color.secondary)
                            Text(item.title).lineLimit(1)
                                .foregroundStyle(item.completed ? Color.secondary : Color.primary)
                            Spacer(minLength: 0)
                        }.font(.system(size: large ? 12 : 10, weight: .medium))
                            .frame(height: large ? 26 : 18)
                            .privacySensitive()
                    }
                }
            } else if todo.state == "waiting" {
                Text("等待球球保存事项").font(.system(size: large ? 12 : 9)).foregroundStyle(.secondary)
                    .lineLimit(2)
            } else {
                Link("连接球球待办", destination: WidgetStore.link("todos"))
                    .font(.system(size: large ? 12 : 10)).foregroundStyle(.blue)
            }
        }
    }
}

struct CompanionPanelView: View {
    let entry: AccentEntry
    @Environment(\.widgetFamily) private var family
    private var large: Bool { family == .systemLarge }
    var body: some View {
        VStack(alignment: .leading, spacing: large ? 12 : 5) {
            HStack(alignment: .top, spacing: large ? 18 : 13) {
                CompanionMonthCalendar(date: entry.date, compact: !large)
                    .frame(maxWidth: .infinity)
                Divider()
                if large {
                    CompanionPanelDate(date: entry.date, large: true)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        CompanionPanelDate(date: entry.date, large: false)
                        CompanionPanelTasks(todo: entry.todo, limit: 1, large: false)
                        Spacer(minLength: 0)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.frame(height: large ? 183 : 128)
            if large {
                Divider()
                CompanionPanelTasks(todo: entry.todo, limit: 2, large: true)
                Spacer(minLength: 0)
            }
            AccentFootnote(todo: entry.todo)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { CompanionSurface() }
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct QiuqiuCompanionMonthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeCompanionMonthProbe", provider: MonthProvider()) { CompanionMonthView(entry: $0) }
            .configurationDisplayName("日历 · 球球月历")
            .description("让球球在月历一角安静陪伴，日期依然清楚。")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct QiuqiuCompanionDateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeCompanionDateProbe", provider: MonthProvider()) { CompanionDateView(entry: $0) }
            .configurationDisplayName("日历 · 球球日期")
            .description("居中的大字日期，和右下角的小球球。")
            .supportedFamilies([.systemSmall])
    }
}
struct QiuqiuCompanionPanelWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeCompanionPanelProbe", provider: AccentProvider()) { CompanionPanelView(entry: $0) }
            .configurationDisplayName("日历 · 球球面板")
            .description("月历、今日日期与球球待办放在一起。")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}
