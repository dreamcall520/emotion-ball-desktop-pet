import Foundation

// Uses synthetic files only. Never opens a provider's settings, tokens or database.
let args = CommandLine.arguments
if args.count != 3 { exit(64) }
let fixture = URL(fileURLWithPath: args[1])
let helper = URL(fileURLWithPath: args[2])
func run(_ executable: String, _ arguments: [String]) -> [String: Any] {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: executable)
    task.arguments = arguments
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    do {
        try task.run(); task.waitUntilExit()
        return ["launched": true, "exitCode": Int(task.terminationStatus)]
    } catch {
        return ["launched": false, "errorCode": (error as NSError).code]
    }
}
let readable = (try? Data(contentsOf: fixture)) != nil
let result: [String: Any] = [
    "kind": "native-adhoc-sandbox-diagnostic-not-MAS-acceptance",
    "syntheticExternalFileReadable": readable,
    "systemTrue": run("/usr/bin/true", []),
    "syntheticExternalHelper": run(helper.path, []),
    "providerCredentialsRead": false,
    "providerNetworkCalls": false
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
