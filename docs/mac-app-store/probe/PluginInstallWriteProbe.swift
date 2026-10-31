import AppKit
import Foundation

let args = CommandLine.arguments
if args.count != 3 { exit(64) }
let phase = args[1], folder = URL(fileURLWithPath: args[2], isDirectory: true)
guard ["child", "inspect", "authorize", "resume", "revoke"].contains(phase) else { exit(64) }
let fm = FileManager.default
func attemptWrite(_ suffix: String) -> [String: Any] {
    let destination = folder.appendingPathComponent("synthetic-" + suffix + ".json")
    do {
        try Data("{\"synthetic\":true}\n".utf8).write(to: destination, options: .atomic)
        return ["written": true, "readback": (try? String(contentsOf: destination, encoding: .utf8)) == "{\"synthetic\":true}\n"]
    } catch { return ["written": false, "errorCode": (error as NSError).code] }
}
func runHelper() -> [String: Any] {
    let task = Process(), output = Pipe()
    task.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/write-helper")
    task.arguments = ["child", folder.path]
    task.standardOutput = output; task.standardError = FileHandle.nullDevice
    do {
        try task.run(); let data = output.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
        return ["launched": true, "exitCode": Int(task.terminationStatus), "result": (try? JSONSerialization.jsonObject(with: data)) ?? NSNull()]
    } catch { return ["launched": false, "errorCode": (error as NSError).code] }
}
func emit(_ result: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
}
if phase == "child" { emit(attemptWrite("child")); exit(0) }
let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
let storage = support.appendingPathComponent("QiuqiuPluginWriteProbe", isDirectory: true)
try fm.createDirectory(at: storage, withIntermediateDirectories: true)
let bookmarkFile = storage.appendingPathComponent("synthetic-write.bookmark")
var result: [String: Any] = ["phase": phase, "before": attemptWrite("before-" + phase), "providerDataRead": false, "modelRequests": 0]
var selected: URL?
if phase == "authorize" {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.regular); NSApp.finishLaunching(); NSApp.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.title = "球球插件安装边界验证：仅合成目录"
    panel.message = "只允许临时合成目录写入测试；不选择任何真实 AI 工具目录。"
    panel.prompt = "允许合成写入"
    panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false
    panel.directoryURL = folder
    if panel.runModal() == .OK, let choice = panel.url,
       choice.resolvingSymlinksInPath().standardizedFileURL.path == folder.resolvingSymlinksInPath().standardizedFileURL.path {
        // Deliberately no securityScopeAllowOnlyReadAccess: the user selected a
        // synthetic write scope under user-selected.read-write entitlement.
        let bookmark = try choice.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        try bookmark.write(to: bookmarkFile, options: .atomic)
        selected = choice; result["bookmarkSaved"] = true
    } else { result["bookmarkSaved"] = false }
} else if phase == "resume" {
    var stale = false
    let bookmark = try Data(contentsOf: bookmarkFile)
    selected = try URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
    result["bookmarkStale"] = stale
} else if phase == "revoke" {
    if fm.fileExists(atPath: bookmarkFile.path) { try fm.removeItem(at: bookmarkFile) }
    result["bookmarkRemoved"] = !fm.fileExists(atPath: bookmarkFile.path)
}
if let selected = selected {
    let active = selected.startAccessingSecurityScopedResource(); result["scopeActivated"] = active
    result["parentWrite"] = attemptWrite("parent-" + phase); result["inheritedHelperWrite"] = runHelper()
    if active { selected.stopAccessingSecurityScopedResource() }
} else {
    result["parentWrite"] = attemptWrite("parent-" + phase); result["inheritedHelperWrite"] = runHelper()
}
emit(result)
