import Foundation

@main struct QiuqiuWidgetBridgeMain {
    static func main() {
        var result: [String: Any] = ["ok": false, "state": "invalid"]
        var status: Int32 = 2
        if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--sync" {
            do {
                var input = Data()
                while true {
                    let chunk = try FileHandle.standardInput.read(upToCount: 64 * 1024) ?? Data()
                    if chunk.isEmpty { break }
                    guard input.count + chunk.count <= 16 * 1024 * 1024 else { throw TodoReadError.invalid }
                    input.append(chunk)
                }
                let request = try WidgetSyncInput(input)
                do { result = try WidgetBridgeSync.sync(request); status = 0 }
                catch { result = ["ok": false, "state": "unavailable"]; status = 3 }
            } catch { }
        }
        let output = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])) ?? Data("{\"ok\":false,\"state\":\"invalid\"}".utf8)
        FileHandle.standardOutput.write(output + Data([10]))
        exit(status)
    }
}
