import Foundation

@main struct ConfigLocationAcceptance {
    static func main() throws {
        let executable = URL(fileURLWithPath: CommandLine.arguments[0])
        let result: [String: Any] = ["group": WidgetStore.group,
            "link": WidgetStore.link("todos").absoluteString,
            "candidateCount": WidgetStore.configurationURLs(for: executable).count]
        print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: .sortedKeys), as: UTF8.self))
    }
}
