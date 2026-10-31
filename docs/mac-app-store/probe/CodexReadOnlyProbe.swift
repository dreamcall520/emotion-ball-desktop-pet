import AppKit
import Foundation

// Read only auth.json from the user-selected .codex folder. No history scan,
// refresh/write, model turn, remote command, saved token or persistent bookmark.
final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
func window(_ value: Any?) -> [String: Any]? {
    guard let raw = value as? [String: Any], let used = raw["used_percent"] as? Double,
        used.isFinite, used >= 0, used <= 100 else { return nil }
    var result: [String: Any] = ["usedPercent": used]
    if let seconds = raw["limit_window_seconds"] as? Double, seconds.isFinite, seconds > 0 { result["windowSeconds"] = seconds }
    if let reset = raw["reset_at"] as? Double, reset.isFinite, reset > 0 { result["resetAtUnixSeconds"] = reset }
    return result
}
_ = NSApplication.shared
NSApp.setActivationPolicy(.regular)
NSApp.finishLaunching()
NSApp.activate(ignoringOtherApps: true)
let panel = NSOpenPanel()
panel.title = "球球商店验证 · Codex 真实额度只读查询"
panel.message = "请选择 .codex 目录。仅用 auth.json 中现有登录态向 chatgpt.com 查询额度；不发送聊天、不刷新或保存令牌。"
panel.prompt = "只读查询额度"
panel.canChooseFiles = false; panel.canChooseDirectories = true
panel.allowsMultipleSelection = false; panel.showsHiddenFiles = true
if panel.runModal() != .OK { emit(["state": "cancelled", "modelCalls": 0]); exit(0) }
guard let selected = panel.url, selected.lastPathComponent == ".codex" else {
    emit(["state": "error", "code": "SELECT_CODEX_DIRECTORY", "modelCalls": 0]); exit(2)
}
let active = selected.startAccessingSecurityScopedResource()
func finish(_ value: [String: Any], _ code: Int32 = 0) -> Never {
    if active { selected.stopAccessingSecurityScopedResource() }
    emit(value); exit(code)
}
let authURL = selected.appendingPathComponent("auth.json")
guard let info = try? authURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .isSymbolicLinkKey]),
    info.isRegularFile == true, info.isSymbolicLink != true, let size = info.fileSize, size > 0, size <= 1024 * 1024,
    let data = try? Data(contentsOf: authURL),
    let auth = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
    let tokens = auth["tokens"] as? [String: Any], let access = tokens["access_token"] as? String,
    !access.isEmpty, access.count < 32768, !access.contains("\r"), !access.contains("\n") else {
    finish(["state": "error", "code": "CODEX_LOGIN_UNAVAILABLE", "modelCalls": 0], 2)
}
var request = URLRequest(url: URL(string: "https://chatgpt.com/backend-api/wham/usage")!)
request.httpMethod = "GET"
request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Accept")
request.setValue("QiuqiuMacAppStoreReadOnlyProbe/1", forHTTPHeaderField: "User-Agent")
if let account = tokens["account_id"] as? String, !account.isEmpty, account.count <= 256,
    !account.contains("\r"), !account.contains("\n") {
    request.setValue(account, forHTTPHeaderField: "ChatGPT-Account-Id")
}
let configuration = URLSessionConfiguration.ephemeral
configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
let delegate = RejectRedirects()
let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
let done = DispatchSemaphore(value: 0)
let resultLock = NSLock()
var result: [String: Any] = ["state": "error", "code": "TIMEOUT", "modelCalls": 0]
func setResult(_ value: [String: Any]) { resultLock.lock(); result = value; resultLock.unlock() }
let task = session.dataTask(with: request) { body, response, error in
    defer { done.signal() }
    guard error == nil, let http = response as? HTTPURLResponse else {
        setResult(["state": "error", "code": "NETWORK_UNAVAILABLE", "modelCalls": 0]); return
    }
    guard http.statusCode == 200 else {
        setResult(["state": "error", "httpStatus": http.statusCode, "code": [401,403].contains(http.statusCode) ? "LOGIN_OR_ACCESS_REQUIRED" : "HTTP_ERROR", "modelCalls": 0]); return
    }
    guard let body, body.count <= 1024 * 1024,
        let raw = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
        setResult(["state": "error", "code": "UNSUPPORTED_RESPONSE", "modelCalls": 0]); return
    }
    let limits = raw["rate_limit"] as? [String: Any]
    let windows = [window(limits?["primary_window"]), window(limits?["secondary_window"])].compactMap { $0 }
    guard !windows.isEmpty else {
        setResult(["state": "error", "code": "NO_ACCOUNT_WINDOWS", "modelCalls": 0]); return
    }
    setResult(["state": "verified", "httpStatus": 200, "windows": windows,
        "modelCalls": 0, "source": "user-selected Codex auth + native HTTPS",
        "tokenPersisted": false, "authModified": false, "sandboxedNativeProbeOnly": true])
}
task.resume()
if done.wait(timeout: .now() + 22) == .timedOut { task.cancel() }
session.invalidateAndCancel()
resultLock.lock(); let snapshot = result; resultLock.unlock()
finish(snapshot, snapshot["state"] as? String == "verified" ? 0 : 2)
