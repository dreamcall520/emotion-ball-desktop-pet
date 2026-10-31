import AppKit
import Foundation
import SQLite3
import Darwin

let args = CommandLine.arguments
if args.count < 3 { exit(64) }
let phase = args[1], folder = URL(fileURLWithPath: args[2])
guard ["child", "inspect", "authorize", "resume", "revoke"].contains(phase),
    let testPort = UInt16(args.count > 3 ? args[3] : "48571"), testPort > 0 else { exit(64) }
let fm = FileManager.default
func socketPing(_ endpoint: String) -> [String: Any] {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 { return ["connected": false, "errno": errno] }
    defer { close(fd) }
    var tv = timeval(tv_sec: 2, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(endpoint.utf8) + [0]
    if bytes.count > MemoryLayout.size(ofValue: address.sun_path) { return ["connected": false, "error": "path-too-long"] }
    withUnsafeMutableBytes(of: &address.sun_path) { raw in raw.copyBytes(from: bytes) }
    let connected = withUnsafePointer(to: &address) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    if connected != 0 { return ["connected": false, "errno": errno] }
    let payload = Array("ping\n".utf8)
    _ = payload.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, payload.count) }
    var buffer = [UInt8](repeating: 0, count: 32)
    let count = Darwin.read(fd, &buffer, buffer.count)
    return ["connected": true, "pong": count > 0 && String(decoding: buffer.prefix(max(0,count)), as: UTF8.self) == "pong\n"]
}
func loopbackPing() -> [String: Any] {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    if fd < 0 { return ["connected": false, "errno": errno] }
    defer { close(fd) }
    var tv = timeval(tv_sec: 2, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var address = sockaddr_in()
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = testPort.bigEndian
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let status = withUnsafePointer(to: &address) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    if status != 0 { return ["connected": false, "errno": errno] }
    let payload = Array("ping\n".utf8)
    _ = payload.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, payload.count) }
    var buffer = [UInt8](repeating: 0, count: 32)
    let count = Darwin.read(fd, &buffer, buffer.count)
    return ["connected": true, "pong": count > 0 && String(decoding: buffer.prefix(max(0,count)), as: UTF8.self) == "pong\n"]
}
func externalExecutable() -> [String: Any] {
    let task = Process()
    task.executableURL = folder.appendingPathComponent("external-tool")
    task.standardOutput = FileHandle.nullDevice; task.standardError = FileHandle.nullDevice
    do { try task.run(); task.waitUntilExit(); return ["launched": true, "exitCode": Int(task.terminationStatus)] }
    catch { return ["launched": false, "errorCode": (error as NSError).code] }
}
func inspectFolder() -> [String: Any] {
    var db: OpaquePointer?
    let opened = sqlite3_open_v2(folder.appendingPathComponent("fixture.sqlite").path, &db, SQLITE_OPEN_READONLY, nil)
    defer { if db != nil { sqlite3_close(db) } }
    var count = -1
    if opened == SQLITE_OK {
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT count(*) FROM tasks", -1, &stmt, nil) == SQLITE_OK {
            if sqlite3_step(stmt) == SQLITE_ROW { count = Int(sqlite3_column_int(stmt, 0)) }
        }
        sqlite3_finalize(stmt)
    }
    return ["jsonReadable": (try? Data(contentsOf: folder.appendingPathComponent("fixture.json"))) != nil,
        "sqliteReadOnlyRowCount": count, "unixSocket": socketPing(folder.appendingPathComponent("ipc.sock").path), "loopbackTCP": loopbackPing(), "externalExecutable": externalExecutable()]
}
func runHelper(_ name: String) -> [String: Any] {
    let task = Process(), pipe = Pipe()
    task.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/" + name)
    task.arguments = ["child", folder.path, args.count > 3 ? args[3] : "48571"]
    task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
    do {
        try task.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        return ["launched": true, "exitCode": Int(task.terminationStatus),
            "result": (try? JSONSerialization.jsonObject(with: data)) ?? NSNull()]
    } catch { return ["launched": false, "errorCode": (error as NSError).code] }
}
func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
}
if phase == "child" { emit(inspectFolder()); exit(0) }
let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
let storage = support.appendingPathComponent("QiuqiuMASAuthorizationProbe", isDirectory: true)
try fm.createDirectory(at: storage, withIntermediateDirectories: true)
let bookmarkFile = storage.appendingPathComponent("synthetic-directory.bookmark")
var result: [String: Any] = ["phase": phase, "before": inspectFolder(), "providerCredentialsRead": false, "providerNetworkCalls": false]
var granted: URL?
if phase == "authorize" {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.regular); NSApp.finishLaunching(); NSApp.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.title = "球球上架验证：只授权合成测试目录"
    panel.message = "仅含测试 JSON、SQLite 和本机假通信接口，不选择真实 AI 工具目录。"
    panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false
    panel.directoryURL = folder
    if panel.runModal() == .OK, let selected = panel.url, selected.resolvingSymlinksInPath().standardizedFileURL.path == folder.resolvingSymlinksInPath().standardizedFileURL.path {
        let bookmark = try selected.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess], includingResourceValuesForKeys: nil, relativeTo: nil)
        try bookmark.write(to: bookmarkFile, options: .atomic)
        granted = selected; result["bookmarkSaved"] = true
    } else { result["bookmarkSaved"] = false }
} else if phase == "resume" {
    var stale = false
    let bookmark = try Data(contentsOf: bookmarkFile)
    granted = try URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
    result["bookmarkStale"] = stale
} else if phase == "revoke" {
    if fm.fileExists(atPath: bookmarkFile.path) { try fm.removeItem(at: bookmarkFile) }
    result["bookmarkRemoved"] = !fm.fileExists(atPath: bookmarkFile.path)
}
if let selected = granted {
    let active = selected.startAccessingSecurityScopedResource()
    result["scopeActivated"] = active
    result["after"] = inspectFolder()
    result["bundledInheritedHelper"] = runHelper("ping-helper")
    if active { selected.stopAccessingSecurityScopedResource() }
} else { result["after"] = inspectFolder(); result["bundledInheritedHelper"] = runHelper("ping-helper") }
emit(result)
