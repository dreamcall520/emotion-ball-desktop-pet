import AppKit
import Foundation
import Darwin
let args = CommandLine.arguments
if args.count != 3 { exit(64) }
let phase = args[1], folder = URL(fileURLWithPath: args[2], isDirectory: true)
guard ["child", "authorize", "resume", "revoke"].contains(phase) else { exit(64) }
let fm = FileManager.default
func writeScript(_ name: String) -> [String: Any] {
    let target = folder.appendingPathComponent(name + ".sh")
    var result: [String: Any] = ["dataWritten": false, "chmod700": false]
    do {
        try Data("#!/bin/sh\n/usr/bin/printf 'synthetic-executable-ok\\n'\n".utf8).write(to: target, options: .atomic)
        result["dataWritten"] = true
        let code = Darwin.chmod(target.path, mode_t(0o700))
        result["chmod700"] = code == 0
        if code != 0 { result["chmodErrno"] = errno }
        if let attributes = try? fm.attributesOfItem(atPath: target.path), let mode = attributes[.posixPermissions] { result["mode"] = mode }
    } catch { result["writeErrorCode"] = (error as NSError).code }
    return result
}
func emit(_ object: [String: Any]) { let data=try! JSONSerialization.data(withJSONObject:object,options:[.sortedKeys]);FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data("\n".utf8)) }
if phase == "child" { emit(writeScript("helper")); exit(0) }
let support=try fm.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
let storage=support.appendingPathComponent("QiuqiuExecutableWriteProbe",isDirectory:true)
try fm.createDirectory(at:storage,withIntermediateDirectories:true)
let bookmarkFile=storage.appendingPathComponent("synthetic-script.bookmark")
var granted:URL?,result:[String:Any]=["phase":phase,"providerDataRead":false,"modelRequests":0]
if phase == "authorize" {
    _ = NSApplication.shared;NSApp.setActivationPolicy(.regular);NSApp.finishLaunching();NSApp.activate(ignoringOtherApps:true)
    let panel=NSOpenPanel();panel.title="球球插件脚本写入验证：仅合成目录";panel.message="只在临时合成目录创建仅printf的脚本；不选真实工具目录。";panel.prompt="允许合成脚本测试";panel.canChooseFiles=false;panel.canChooseDirectories=true;panel.allowsMultipleSelection=false;panel.directoryURL=folder
    if panel.runModal() == .OK,let selected=panel.url,selected.resolvingSymlinksInPath().standardizedFileURL.path == folder.resolvingSymlinksInPath().standardizedFileURL.path {
        let data=try selected.bookmarkData(options:[.withSecurityScope],includingResourceValuesForKeys:nil,relativeTo:nil);try data.write(to:bookmarkFile,options:.atomic);granted=selected;result["bookmarkSaved"]=true
    } else {result["bookmarkSaved"]=false}
} else if phase == "resume" {
    var stale=false;let data=try Data(contentsOf:bookmarkFile);granted=try URL(resolvingBookmarkData:data,options:[.withSecurityScope],relativeTo:nil,bookmarkDataIsStale:&stale);result["bookmarkStale"]=stale
} else if phase == "revoke" {
    if fm.fileExists(atPath:bookmarkFile.path){try fm.removeItem(at:bookmarkFile)};result["bookmarkRemoved"] = !fm.fileExists(atPath:bookmarkFile.path)
}
if let granted=granted {
    let active=granted.startAccessingSecurityScopedResource();result["scopeActivated"]=active;result["parentScript"]=writeScript("parent")
    let task=Process(),output=Pipe();task.executableURL=Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/script-helper");task.arguments=["child",folder.path];task.standardOutput=output;task.standardError=FileHandle.nullDevice
    do{try task.run();let data=output.fileHandleForReading.readDataToEndOfFile();task.waitUntilExit();result["inheritedHelper"]=["exitCode":Int(task.terminationStatus),"result":(try? JSONSerialization.jsonObject(with:data)) ?? NSNull()]}catch{result["helperErrorCode"]=(error as NSError).code}
    if active{granted.stopAccessingSecurityScopedResource()}
} else {result["parentScript"]=writeScript("revoked-parent")}
emit(result)
