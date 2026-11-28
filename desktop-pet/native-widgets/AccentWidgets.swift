import SwiftUI
import WidgetKit

struct AccentEntry: TimelineEntry { let date: Date; let todo: AccentTodoSummary }
struct AccentProvider: TimelineProvider {
    func placeholder(in context: Context) -> AccentEntry { let now=Date(); return AccentEntry(date:now,todo:.make(.example(at:now),at:now)) }
    func getSnapshot(in context: Context, completion: @escaping (AccentEntry) -> Void) {
        let now=Date(), source=TodoSnapshot.read()
        completion(AccentEntry(date:now,todo:.make(context.isPreview && source.syncedAt == nil ? .example(at:now):source,at:now)))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AccentEntry>) -> Void) {
        let source=TodoSnapshot.read(), now=Date()
        // Large family archives exceeded WidgetKit's size limit at 145 entries.
        // Keep five-minute resolution, renew after roughly two hours instead.
        let entries=AccentTimeModel.dates(after:now).prefix(25).map { AccentEntry(date:$0,todo:.make(source,at:$0)) }
        completion(Timeline(entries:entries,policy:.atEnd))
    }
}

enum AccentPalette {
    static let blue=Color(red:0.30,green:0.48,blue:0.91)
    static let coral=Color(red:0.91,green:0.36,blue:0.34)
    static let gold=Color(red:0.94,green:0.70,blue:0.24)
    static func color(_ value:Double)->Color {
        let t=min(1,max(0,value))
        if t<0.5 { let p=t*2; return Color(red:0.30+(0.91-0.30)*p,green:0.48+(0.36-0.48)*p,blue:0.91+(0.34-0.91)*p) }
        let p=(t-0.5)*2;return Color(red:0.91+(0.94-0.91)*p,green:0.36+(0.70-0.36)*p,blue:0.34+(0.24-0.34)*p)
    }
}
struct AccentSurface: View {
    @Environment(\.colorScheme) var scheme
    var body: some View { scheme == .dark ? Color(white:0.11) : Color(red:0.995,green:0.993,blue:0.985) }
}
struct AccentClock: View {
    let date: Date
    var body: some View {
        if #available(macOS 15.0, *) {
            Text(.currentDate,format:.dateTime.hour(.twoDigits(amPM:.omitted)).minute(.twoDigits).locale(Locale(identifier:"en_GB")))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        } else {
            Text(date,format:.dateTime.hour(.twoDigits(amPM:.omitted)).minute(.twoDigits).locale(Locale(identifier:"en_GB")))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}
struct AccentRule: View {
    var count=30
    @Environment(\.widgetRenderingMode) var mode
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing:2) {
                ForEach(0..<count,id:\.self) { i in Capsule().fill(mode == .fullColor ? AccentPalette.color(Double(i)/Double(count-1)) : Color.primary.opacity(0.35)).frame(width:max(1,(geometry.size.width-CGFloat(count-1)*2)/CGFloat(count))) }
            }
        }.frame(height:2)
    }
}
struct AccentRing: View {
    let fraction:Double
    let color:Color
    var body: some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.06),lineWidth:3)
            Circle().trim(from:0,to:fraction).stroke(color,style:StrokeStyle(lineWidth:3,lineCap:.round)).rotationEffect(.degrees(-90))
        }.frame(width:23,height:23)
    }
}
struct AccentArc: View {
    let fraction:Double
    @Environment(\.widgetRenderingMode) var mode
    var body: some View {
        GeometryReader { geometry in
            let radius=min(geometry.size.width/2-7,geometry.size.height-9)
            ForEach(0..<31,id:\.self) { index in
                let t=Double(index)/30, angle=Double.pi+t*Double.pi
                Capsule().fill(t <= fraction ? (mode == .fullColor ? AccentPalette.color(t) : Color.primary) : Color.primary.opacity(0.07))
                    .frame(width:2,height:6)
                    .rotationEffect(.radians(angle+Double.pi/2))
                    .position(x:geometry.size.width/2+radius*cos(angle),y:geometry.size.height-4+radius*sin(angle))
            }
        }
        .overlay(alignment:.bottom) {
            VStack(spacing:3) {
                Text("今日已过").font(.system(size:9,weight:.medium)).foregroundStyle(.secondary)
                Text("\(Int((fraction*100).rounded()))%")
                    .font(.system(size:20,weight:.semibold,design:.rounded)).monospacedDigit()
            }.padding(.bottom,2)
        }
    }
}
struct AccentFootnote: View {
    let todo:AccentTodoSummary
    var body: some View {
        Group {
            if todo.state == "waiting" { Text("等待球球保存事项 · 自动同步") }
            else if todo.state == "example" { Text("示例 · 连接后显示你的待办") }
            else if todo.state == "error" { Text(todo.connected ? "同步暂停 · 保留上次结果":"待办尚未连接") }
            else if let date=todo.syncedAt { Text("待办同步于 ") + Text(date,format:.dateTime.hour(.twoDigits(amPM:.omitted)).minute(.twoDigits).locale(Locale(identifier:"en_GB"))) }
            else { Text("点击连接球球待办") }
        }.font(.system(size:8,weight:.medium)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
    }
}
struct AccentStatusPill: View {
    let completed:Bool
    @Environment(\.widgetRenderingMode) var mode
    var body: some View {
        Group {
            if completed { Image(systemName:"checkmark").font(.system(size:7,weight:.bold)).foregroundStyle(mode == .fullColor ? Color.white:Color.primary) }
            else { Text("待办").font(.system(size:7,weight:.medium)).foregroundStyle(.secondary) }
        }
        .frame(width:25,height:12)
        .background(completed ? (mode == .fullColor ? AccentPalette.coral:Color.primary.opacity(0.18)):Color.primary.opacity(0.05),in:Capsule())
        .accessibilityLabel(completed ? "已完成":"未完成")
    }
}

struct AccentTimeProgressView: View {
    let entry:AccentEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let day=AccentTimeModel.fraction(.day,at:entry.date)
        HStack(spacing:25) {
            VStack(spacing:6) {
                HStack {Text("TIME").font(.system(size:9,weight:.medium));Spacer();Text(entry.date,format:.dateTime.month().day()).font(.system(size:9))}.foregroundStyle(.secondary)
                AccentClock(date:entry.date).font(.system(size:34,weight:.semibold,design:.rounded)).frame(maxWidth:.infinity)
                AccentArc(fraction:day).frame(height:75)
            }.frame(maxWidth:.infinity)
            if family == .systemMedium {
                VStack(alignment:.leading,spacing:14) {
                    Text("把时间留给重要的事").font(.system(size:10,weight:.medium)).foregroundStyle(.secondary)
                    progressRow("本月",.month,AccentPalette.coral)
                    progressRow("今年",.year,AccentPalette.gold)
                    Text(DayModel.lunar(for:entry.date)).font(.system(size:9)).foregroundStyle(.secondary)
                }.frame(maxWidth:.infinity,alignment:.leading)
            }
        }.frame(maxWidth:.infinity,maxHeight:.infinity)
        .containerBackground(for:.widget){AccentSurface()}
        .widgetURL(WidgetStore.link("calendar"))
    }
    func progressRow(_ title:String,_ component:Calendar.Component,_ color:Color)->some View {
        let fraction=AccentTimeModel.fraction(component,at:entry.date)
        return HStack(spacing:8) {AccentRing(fraction:fraction,color:color);Text(title).font(.system(size:11,weight:.medium));Spacer(minLength:0);Text("\(Int((fraction*100).rounded()))%").font(.system(size:11,weight:.medium,design:.rounded)).foregroundStyle(.secondary)}
    }
}

struct AccentOverviewView: View {
    let entry:AccentEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let week=DayModel.week(for:entry.date), c=MonthModel.calendar
        VStack(alignment:.leading,spacing:7) {
            HStack(alignment:.center,spacing:16) {
                VStack(alignment:.leading,spacing:1) {
                    AccentClock(date:entry.date).font(.system(size:31,weight:.semibold,design:.rounded))
                    Text(entry.date,format:.dateTime.weekday(.wide)).font(.system(size:9,weight:.medium)).foregroundStyle(.secondary)
                }.frame(width:118,alignment:.leading)
                HStack(spacing:0) {
                    ForEach(Array(week.enumerated()),id:\.offset) { index,date in
                        let today=c.isDate(date,inSameDayAs:entry.date)
                        VStack(spacing:5) {
                            Text(String(c.component(.day,from:date))).font(.system(size:10,weight:today ? .bold:.medium,design:.rounded)).fixedSize()
                                .foregroundStyle(today ? AccentPalette.coral:Color.primary)
                            Text(["一","二","三","四","五","六","日"][index]).font(.system(size:7)).foregroundStyle(.secondary)
                        }.frame(maxWidth:.infinity)
                    }
                }.frame(maxWidth:.infinity)
            }
            AccentRule()
            HStack(alignment:.top,spacing:14) {
                VStack(alignment:.leading,spacing:7) {
                    if entry.todo.connected {
                        ForEach(Array(entry.todo.rows.prefix(family == .systemLarge ? 4:2))) { item in
                            HStack(spacing:5) {Text(item.title).font(.system(size:9,weight:.medium)).lineLimit(1);Spacer(minLength:0);AccentStatusPill(completed:item.completed)}
                                .padding(.horizontal,6).padding(.vertical,4)
                                .background(Color.primary.opacity(0.03),in:RoundedRectangle(cornerRadius:7)).privacySensitive()
                        }
                        if entry.todo.rows.isEmpty { Text(entry.todo.total == 0 ? "今天还没有待办":"今天都完成了").font(.system(size:11)).foregroundStyle(.secondary) }
                    } else {
                        Text("今日待办").font(.system(size:11,weight:.medium))
                        Link(entry.todo.state == "waiting" ? "等待待办数据" : "连接球球待办",destination:WidgetStore.link("todos")).font(.system(size:10)).foregroundStyle(AccentPalette.blue)
                    }
                }.frame(maxWidth:.infinity,alignment:.leading)
                VStack(alignment:.leading,spacing:10) {
                    HStack(spacing:7) {VStack(alignment:.leading,spacing:3){Text("今日约剩 \(AccentTimeModel.remainingHours(at:entry.date)) 小时").font(.system(size:10,weight:.medium));Text("慢慢来，也来得及").font(.system(size:7)).foregroundStyle(.secondary)};Spacer(minLength:0);AccentRing(fraction:1-AccentTimeModel.fraction(.day,at:entry.date),color:AccentPalette.blue)}
                    HStack(spacing:7) {VStack(alignment:.leading,spacing:3){Text("本月还有 \(AccentTimeModel.remainingMonthDays(at:entry.date)) 天").font(.system(size:10,weight:.medium));Text("留一点期待给明天").font(.system(size:7)).foregroundStyle(.secondary)};Spacer(minLength:0);AccentRing(fraction:1-AccentTimeModel.fraction(.month,at:entry.date),color:AccentPalette.coral)}
                }.frame(maxWidth:.infinity,alignment:.leading)
            }
            if family == .systemLarge {
                Spacer(minLength:4)
                HStack {Text("今日待办").font(.system(size:12,weight:.semibold));Spacer();if entry.todo.connected {Text("\(entry.todo.done) / \(entry.todo.total) 完成").font(.system(size:10)).foregroundStyle(.secondary)} else {Text(entry.todo.state == "waiting" ? "待同步" : "待连接").font(.system(size:10)).foregroundStyle(.secondary)}}
                AccentRule()
                if !entry.todo.connected { Text(entry.todo.state == "waiting" ? "在球球保存事项后，会自动出现在这里。" : "连接后，把今天的计划放在这里。").font(.system(size:12)).foregroundStyle(.secondary).padding(.vertical,10) }
                else {ForEach(Array(entry.todo.rows.dropFirst(4).prefix(3))) { item in HStack {Image(systemName:item.completed ? "checkmark.circle.fill":"circle").foregroundStyle(AccentPalette.blue);Text(item.title).lineLimit(1);Spacer()}.font(.system(size:12)).privacySensitive()}}
            }
            Spacer(minLength:0)
            AccentFootnote(todo:entry.todo)
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.leading)
        .containerBackground(for:.widget){AccentSurface()}
        .widgetURL(WidgetStore.link("calendar"))
    }
}

struct AccentTodoView: View {
    let entry:AccentEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        VStack(alignment:.leading,spacing:6) {
            HStack {AccentClock(date:entry.date).font(.system(size:14,weight:.semibold,design:.rounded));Spacer();Text("今日待办").font(.system(size:12,weight:.medium)).foregroundStyle(AccentPalette.blue)}
            AccentRule(count:family == .systemSmall ? 18:34)
            if entry.todo.connected {
                ForEach(Array(entry.todo.rows.prefix(4))) { item in
                    HStack(spacing:7) {Text(item.title).font(.system(size:family == .systemSmall ? 10:12,weight:.medium)).lineLimit(1).privacySensitive();Spacer(minLength:0);AccentStatusPill(completed:item.completed)}
                    if item.id != entry.todo.rows.prefix(4).last?.id { AccentRule(count:family == .systemSmall ? 18:34).opacity(0.65).frame(height:1) }
                }
                if entry.todo.rows.isEmpty { Spacer();Text(entry.todo.total == 0 ? "今天还没有待办":"今天都完成了").font(.system(size:15,weight:.medium)).foregroundStyle(.secondary);Spacer() }
            } else {
                Spacer();Text(entry.todo.state == "waiting" ? "等待待办数据" : "连接球球待办").font(.system(size:17,weight:.semibold));Text(entry.todo.state == "waiting" ? "在球球保存事项后自动同步" : "连接后显示今日事项").font(.system(size:10)).foregroundStyle(.secondary);Spacer()
            }
            Spacer(minLength:0)
            HStack {AccentFootnote(todo:entry.todo);if family == .systemMedium && entry.todo.connected {Spacer();Text("\(entry.todo.done)/\(entry.todo.total) 已完成").font(.system(size:9)).foregroundStyle(.secondary)}}
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.leading)
        .containerBackground(for:.widget){AccentSurface()}
        .widgetURL(WidgetStore.link("todos"))
    }
}
struct QiuqiuAccentOverviewWidget: Widget {
    var body:some WidgetConfiguration {StaticConfiguration(kind:"QiuqiuNativeAccentOverviewProbe",provider:AccentProvider()){AccentOverviewView(entry:$0)}.configurationDisplayName("总览 · 轻彩总览").description("时间、一周与今日事项，轻轻放在一起。").supportedFamilies([.systemMedium,.systemLarge])}
}
struct QiuqiuTimeProgressWidget: Widget {
    var body:some WidgetConfiguration {StaticConfiguration(kind:"QiuqiuNativeTimeProgressProbe",provider:AccentProvider()){AccentTimeProgressView(entry:$0)}.configurationDisplayName("时间 · 时光进度").description("看看今天、本月与今年走过了多少。").supportedFamilies([.systemSmall,.systemMedium])}
}
struct QiuqiuAccentTodoWidget: Widget {
    var body:some WidgetConfiguration {StaticConfiguration(kind:"QiuqiuNativeAccentTodoProbe",provider:AccentProvider()){AccentTodoView(entry:$0)}.configurationDisplayName("待办 · 轻彩待办").description("细彩线与小胶囊，记录今日事项。").supportedFamilies([.systemSmall,.systemMedium])}
}
