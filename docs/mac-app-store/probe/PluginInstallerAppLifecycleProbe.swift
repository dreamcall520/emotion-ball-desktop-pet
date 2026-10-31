import AppKit
import Foundation

let args = CommandLine.arguments
let targetID = "local.xiaokun.emotionball.lifecyclefixture"
let fm = FileManager.default
func emit(_ result: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
}
func runLoop(until condition: () -> Bool, timeout: TimeInterval = 8) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
    return condition()
}
if args.count > 1 && args[1] == "fixture" {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.accessory)
    NSApp.finishLaunching()
    NSApp.run()
    exit(0)
}
func launchFixture(_ targetURL: URL) -> [String: Any] {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    var completed = false, errorCode: Int? = nil
    NSWorkspace.shared.openApplication(at: targetURL, configuration: configuration) { _, error in
        errorCode = error.map { ($0 as NSError).code }; completed = true
    }
    var result: [String: Any] = ["launchCallbackObserved": runLoop(until: { completed })]
    if let errorCode = errorCode { result["launchErrorCode"] = errorCode }
    result["relaunchedObserved"] = runLoop(until: { NSRunningApplication.runningApplications(withBundleIdentifier: targetID).count == 1 })
    return result
}
func testLifecycle(_ targetURL: URL) -> [String: Any] {
    let before = NSRunningApplication.runningApplications(withBundleIdentifier: targetID)
    var result: [String: Any] = ["runningBeforeCount": before.count, "matchedOnlyFixedFixtureBundle": true]
    guard before.count == 1, let target = before.first else { return result }
    result["normalTerminateAccepted"] = target.terminate()
    let gone = runLoop(until: { NSRunningApplication.runningApplications(withBundleIdentifier: targetID).isEmpty })
    result["normalTerminateObserved"] = gone
    if gone { result.merge(launchFixture(targetURL)) { _, next in next } }
    return result
}
if args.count == 3 && args[1] == "child" { emit(testLifecycle(URL(fileURLWithPath: args[2]))); exit(0) }
if args.count == 3 && args[1] == "child-launch" { emit(launchFixture(URL(fileURLWithPath: args[2]))); exit(0) }
if args.count != 2 && !(args.count == 3 && args[2] == "launch-only") { exit(64) }
let targetURL = URL(fileURLWithPath: args[1])
let task = Process(), output = Pipe()
task.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/lifecycle-helper")
task.arguments = [args.count == 3 ? "child-launch" : "child", targetURL.path]; task.standardOutput = output; task.standardError = FileHandle.nullDevice
var report: [String: Any] = ["parentObservedCount": NSRunningApplication.runningApplications(withBundleIdentifier: targetID).count]
do { try task.run(); let data = output.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit(); report["inheritedHelper"] = ["exitCode": Int(task.terminationStatus), "result": (try? JSONSerialization.jsonObject(with: data)) ?? NSNull()] }
catch { report["helperLaunchErrorCode"] = (error as NSError).code }
emit(report)
