import SwiftUI
import WidgetKit

struct WeatherWeekEntry: TimelineEntry { let date: Date; let weather: WidgetWeatherSnapshot }
struct WeatherWeekProvider: TimelineProvider {
    func placeholder(in context: Context) -> WeatherWeekEntry { let date = Date(); return WeatherWeekEntry(date: date, weather: .example(at: date)) }
    func getSnapshot(in context: Context, completion: @escaping (WeatherWeekEntry) -> Void) {
        let date = Date(), source = WidgetWeatherSnapshot.read()
        completion(WeatherWeekEntry(date: date, weather: context.isPreview && !source.hasData ? .example(at: date) : source))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WeatherWeekEntry>) -> Void) {
        let date = Date(), source = WidgetWeatherSnapshot.read()
        let expiries = [source.observedAt, source.fetchedAt].compactMap { $0?.addingTimeInterval(90 * 60 + 1) }.filter { $0 > date }
        let cityMidnights = WeatherWidgetModel.nextCityMidnight(after: date, timezone: source.timezone).map { [$0] } ?? []
        let dates = Array(Set(DayModel.midnights(after: date) + expiries + cityMidnights)).sorted()
        WidgetStore.write(["state": source.status(at: date), "hasData": source.hasData, "entries": dates.count], to: "weather-widget-result.json")
        completion(Timeline(entries: dates.map { WeatherWeekEntry(date: $0, weather: source) }, policy: .after(date.addingTimeInterval(1800))))
    }
}
struct WeatherWeekStrip: View {
    let date: Date
    @Environment(\.widgetRenderingMode) var mode
    var body: some View {
        GeometryReader { g in
            HStack(spacing: 0) {
                ForEach(Array(DayModel.week(for: date).enumerated()), id: \.offset) { i, day in
                    let today = MonthModel.calendar.isDate(day, inSameDayAs: date)
                    VStack(spacing: 5) {
                        Text(String(MonthModel.calendar.component(.day, from: day)))
                            .font(.system(size: 16, weight: today ? .bold : .medium, design: .rounded))
                            .frame(width: 27, height: 27)
                            .foregroundStyle(today && mode == .fullColor ? Color.white : Color.primary)
                            .background { if today { Circle().fill(mode == .fullColor ? Color.blue : Color.primary.opacity(0.12)) } }
                        Text(["一", "二", "三", "四", "五", "六", "日"][i]).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
                    }.frame(width: g.size.width / 7)
                }
            }
        }.frame(height: 47).padding(.horizontal, 4).padding(.vertical, 6)
            .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}
struct WeatherWeekSymbol: View {
    let code: Int
    let isDay: Bool
    @Environment(\.widgetRenderingMode) var mode
    var body: some View {
        Group {
            if mode != .fullColor {
                Image(systemName: WeatherWidgetModel.condition(code, isDay: isDay).1)
                    .symbolRenderingMode(.monochrome).foregroundStyle(.primary)
            } else if !isDay && [0, 1, 2].contains(code) {
                Image(systemName: WeatherWidgetModel.condition(code, isDay: false).1)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(code == 0 ? Color(red: 1, green: 0.75, blue: 0.20) : Color(red: 0.19, green: 0.62, blue: 1),
                                     code == 0 ? Color(red: 0.42, green: 0.72, blue: 1) : Color(red: 1, green: 0.79, blue: 0.29))
            } else if [1, 2].contains(code) && isDay {
                ZStack {
                    Circle().fill(Color.yellow).frame(width: 20, height: 20).offset(x: 8, y: -6)
                    Image(systemName: "cloud.fill").font(.system(size: 29)).foregroundStyle(Color(white: 0.82)).offset(x: -3, y: 4)
                }.frame(width: 39, height: 34)
            } else if code == 3 {
                Image(systemName: "cloud.fill").foregroundStyle(Color(white: 0.75))
            } else {
                Image(systemName: WeatherWidgetModel.condition(code, isDay: isDay).1).symbolRenderingMode(.multicolor)
            }
        }.accessibilityLabel(WeatherWidgetModel.condition(code, isDay: isDay).0)
    }
}

private func weatherConditionText(_ weather: WidgetWeatherSnapshot, state: String) -> String {
    let label = WeatherWidgetModel.condition(weather.code ?? 3, isDay: weather.isDay ?? true).0
    switch state {
    case "example": return label + " · 示例"
    case "stale": return label + " · 上次天气"
    case "error": return label + " · 同步暂停"
    default: return label
    }
}

struct WeatherWeekWidgetView: View {
    let entry: WeatherWeekEntry
    var body: some View {
        let w = entry.weather, state = w.status(at: entry.date)
        VStack(spacing: 6) {
            HStack(alignment: .center) {
                if w.hasData {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(Int(w.temperature!.rounded()))°C").font(.system(size: 34, weight: .semibold, design: .rounded)).monospacedDigit()
                        Text(weatherConditionText(w, state: state)).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 10)
                    HStack(spacing: 10) {
                        VStack(alignment: .trailing, spacing: 5) {
                            Text(w.city).font(.system(size: 11, weight: .medium)).lineLimit(1).privacySensitive()
                            if let day = w.today(at: entry.date) {
                                Text("低 \(Int(day.minimum.rounded()))°  高 \(Int(day.maximum.rounded()))°")
                                    .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                            } else { Text("高低温待更新").font(.system(size: 9)).foregroundStyle(.secondary) }
                        }
                        WeatherWeekSymbol(code: w.code ?? 3, isDay: w.isDay ?? true)
                            .font(.system(size: 29)).frame(width: 40)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(state == "error" ? "天气暂不可用" : state == "disabled" ? "天气未启用" : state == "waiting" ? "等待天气更新" : "连接球球天气")
                            .font(.system(size: 17, weight: .semibold))
                        Text(state == "disconnected" ? "点击连接，沿用球球已选城市" : "打开球球日历，设置天气城市")
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    WeatherWeekSymbol(code: 2, isDay: true).font(.system(size: 31))
                }
            }.frame(maxHeight: .infinity)
            WeatherWeekStrip(date: entry.date)

        }.frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.035), .clear], startPoint: .top, endPoint: .bottom) }
        .accessibilityHint("天气数据由 Open-Meteo 提供，点击打开球球日历。")
        .widgetURL(WidgetStore.link(state == "disconnected" ? "connect-weather" : "calendar"))
    }
}

struct WeatherCardWidgetView: View {
    let entry: WeatherWeekEntry
    var body: some View {
        let w = entry.weather, state = w.status(at: entry.date)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Text("WEATHER").font(.system(size: 10, weight: .semibold))
                Spacer(minLength: 2)
                if w.hasData { Text(w.city).font(.system(size: 9, weight: .medium)).lineLimit(1).privacySensitive() }
            }.foregroundStyle(.secondary)
            if w.hasData {
                Text("\(Int(w.temperature!.rounded()))°C")
                    .font(.system(size: 40, weight: .medium, design: .rounded))
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
                HStack(spacing: 8) {
                    WeatherWeekSymbol(code: w.code ?? 3, isDay: w.isDay ?? true)
                        .font(.system(size: 22)).scaleEffect(0.78).frame(width: 30, height: 25)
                    Text(weatherConditionText(w, state: state))
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                HStack {
                    temperatureLimit("最低", value: w.today(at: entry.date)?.minimum)
                    Spacer(minLength: 8)
                    temperatureLimit("最高", value: w.today(at: entry.date)?.maximum)
                }

            } else {
                Spacer(minLength: 0)
                Image(systemName: "cloud.sun").font(.system(size: 28)).foregroundStyle(.secondary)
                Text(state == "error" ? "天气暂不可用" : state == "disabled" ? "天气未启用" : state == "waiting" ? "等待天气更新" : "连接球球天气")
                    .font(.system(size: 15, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                Text("打开球球，沿用已选城市").font(.system(size: 9)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { LinearGradient(colors: [.blue.opacity(0.035), .clear], startPoint: .top, endPoint: .bottom) }
            .accessibilityHint("天气数据由 Open-Meteo 提供，点击打开球球日历。")
        .widgetURL(WidgetStore.link(state == "disconnected" ? "connect-weather" : "calendar"))
    }
    private func temperatureLimit(_ label: String, value: Double?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).font(.system(size: 8, weight: .medium)).foregroundStyle(.secondary)
            Text(value.map { "\(Int($0.rounded()))°" } ?? "—")
                .font(.system(size: 15, weight: .medium, design: .rounded)).monospacedDigit()
        }.accessibilityElement(children: .combine)
    }
}
struct QiuqiuWeatherCardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeWeatherCardProbe", provider: WeatherWeekProvider()) { WeatherCardWidgetView(entry: $0) }
            .configurationDisplayName("天气 · 天气卡片")
            .description("当前天气与当地今日高低温，沿用球球已选城市。天气数据由 Open-Meteo 提供。")
            .supportedFamilies([.systemSmall])
    }
}
struct QiuqiuWeatherWeekWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeWeatherWeekProbe", provider: WeatherWeekProvider()) { WeatherWeekWidgetView(entry: $0) }
            .configurationDisplayName("天气 · 天气周历").description("沿用球球已选城市的天气，搭配一周日期。天气数据由 Open-Meteo 提供。").supportedFamilies([.systemMedium])
    }
}
