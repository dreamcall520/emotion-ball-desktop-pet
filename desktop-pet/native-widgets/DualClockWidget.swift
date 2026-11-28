import SwiftUI
import WidgetKit

enum DualClockModel {
    struct Hands: Equatable {
        let hourDegrees: Double
        let minuteDegrees: Double
    }
    static func hands(at date: Date, calendar: Calendar = MonthModel.calendar) -> Hands {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let hour = Double(parts.hour ?? 0), minute = Double(parts.minute ?? 0)
        return Hands(hourDegrees: (hour.truncatingRemainder(dividingBy: 12) + minute / 60) * 30,
                     minuteDegrees: minute * 6)
    }
    static func dates(after date: Date, calendar: Calendar = MonthModel.calendar) -> [Date] {
        let minute = calendar.dateInterval(of: .minute, for: date)!.start
        // A compact, minute-resolution timeline; no synthetic second-hand animation.
        return [date] + (1...30).map { minute.addingTimeInterval(Double($0) * 60) }
    }
    static func dateLabel(_ date: Date, calendar: Calendar = MonthModel.calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year!)年\(parts.month!)月\(parts.day!)日"
    }
    static func weekdayLabel(_ date: Date, calendar: Calendar = MonthModel.calendar) -> String {
        ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][calendar.component(.weekday, from: date) - 1]
    }
}

struct DualClockEntry: TimelineEntry { let date: Date }
struct DualClockProvider: TimelineProvider {
    func placeholder(in context: Context) -> DualClockEntry { DualClockEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (DualClockEntry) -> Void) { completion(DualClockEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DualClockEntry>) -> Void) {
        completion(Timeline(entries: DualClockModel.dates(after: Date()).map { DualClockEntry(date: $0) }, policy: .atEnd))
    }
}

struct DualClockDial: View {
    let date: Date
    @Environment(\.widgetRenderingMode) private var renderingMode
    var body: some View {
        DualClockDialArtwork(date: date, monochrome: renderingMode != .fullColor)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("时针和分针，表盘按分钟更新")
            .accessibilityValue(Text(date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB"))))
    }
}

struct DualClockDialArtwork: View {
    let date: Date
    let monochrome: Bool
    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let radius = min(size.width, size.height) / 2 - 1
            let hands = DualClockModel.hands(at: date)
            ZStack {
                DualClockDialFace(monochrome: monochrome)
                DualClockHandView(angle: hands.hourDegrees, length: radius * 0.48, tail: 0, width: 4, color: .white, bounds: size)
                DualClockHandView(angle: hands.minuteDegrees, length: radius * 0.77, tail: radius * 0.08, width: 2.7, color: .white, bounds: size)
                // The red stroke belongs to the minute hand, not a simulated second hand.
                DualClockHandView(angle: hands.minuteDegrees, length: radius * 0.79, tail: radius * 0.11, width: 0.85, color: Color(red: 0.98, green: 0.34, blue: 0.24), bounds: size)
                Circle().fill(.white).frame(width: 6, height: 6)
                Circle().fill(Color(red: 0.98, green: 0.34, blue: 0.24)).frame(width: 3.6, height: 3.6)
            }
            .frame(width: size.width, height: size.height, alignment: .center)
            .transition(.identity)
        }
    }
}

// Each hand occupies the same fixed dial rectangle; the path itself never changes with time.
// Only its rotation changes, always around that rectangle's shared center.
struct DualClockHandShape: Shape {
    let length: CGFloat
    let tail: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.midY + tail))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.midY - length))
        return path
    }
}

struct DualClockHandView: View {
    let angle: Double
    let length: CGFloat
    let tail: CGFloat
    let width: CGFloat
    let color: Color
    let bounds: CGSize
    var body: some View {
        DualClockHandShape(length: length, tail: tail)
            .stroke(color, style: StrokeStyle(lineWidth: width, lineCap: .round))
            .frame(width: bounds.width, height: bounds.height)
            .rotationEffect(.degrees(angle), anchor: .center)
            .animation(nil, value: angle)
            .transition(.identity)
    }
}

struct DualClockDialFace: View {
    let monochrome: Bool
    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) / 2 - 1
            let face = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
            // Accented/vibrant rendering replaces RGB with a single tint while preserving alpha.
            // Keep the face transparent so its filled circle cannot hide the ticks and hands.
            if !monochrome {
                context.fill(face, with: .radialGradient(Gradient(colors: [Color(white: 0.18), Color(white: 0.075)]), center: CGPoint(x: center.x - radius * 0.3, y: center.y - radius * 0.35), startRadius: 0, endRadius: radius * 1.7))
            }
            context.stroke(face, with: .color(.white.opacity(monochrome ? 0.25 : 0.12)), lineWidth: 0.7)
            func point(_ degrees: Double, _ distance: CGFloat) -> CGPoint {
                let angle = (degrees - 90) * .pi / 180
                return CGPoint(x: center.x + cos(angle) * distance, y: center.y + sin(angle) * distance)
            }
            for tick in 0..<60 {
                let major = tick % 5 == 0
                var mark = Path()
                mark.move(to: point(Double(tick) * 6, radius - (major ? 10 : 7)))
                mark.addLine(to: point(Double(tick) * 6, radius - 3.5))
                context.stroke(mark, with: .color(.white.opacity(major ? 0.92 : 0.72)), style: StrokeStyle(lineWidth: major ? 1.3 : 0.65, lineCap: .round))
            }
        }
    }
}

struct DualClockView: View {
    let entry: DualClockEntry
    var usesLiveText = true
    var body: some View {
        GeometryReader { geometry in
            let dialSize = min(136, geometry.size.height)
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 9) {
                    clockText.font(.system(size: 45, weight: .semibold, design: .rounded))
                        .tracking(-1.8).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(DualClockModel.dateLabel(entry.date)).font(.system(size: 12, weight: .medium))
                        Text(DayModel.lunar(for: entry.date).replacingOccurrences(of: "农历 ", with: "农历")).font(.system(size: 11, weight: .medium))
                        Text(DualClockModel.weekdayLabel(entry.date)).font(.system(size: 11, weight: .medium))
                    }.foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.85)

                }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                DualClockDial(date: entry.date).frame(width: dialSize, height: dialSize)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .containerBackground(for: .widget) { AccentSurface() }
        .widgetURL(WidgetStore.link("calendar"))
    }
    @ViewBuilder private var clockText: some View {
        if #available(macOS 15.0, *), usesLiveText {
            Text(.currentDate, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB")))
        } else {
            Text(entry.date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB")))
        }
    }
}

struct QiuqiuDualClockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QiuqiuNativeDualClockProbe", provider: DualClockProvider()) { DualClockView(entry: $0) }
            .configurationDisplayName("时间 · 双时钟")
            .description("数字与黑色表盘，一起查看时间、日期和农历。表盘按分钟更新。")
            .supportedFamilies([.systemMedium])
    }
}
