import Foundation
import Darwin

let fm=FileManager.default
func emit(_ value:[String:Any]) { let data=try! JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]);FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data("\n".utf8)) }
guard CommandLine.arguments.count==2 else {exit(64)}
let fixture=URL(fileURLWithPath:CommandLine.arguments[1])
let support=try fm.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
let work=support.appendingPathComponent("QiuqiuManagedCodexProbe/"+UUID().uuidString,isDirectory:true)
try fm.createDirectory(at:work,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
let home=work.appendingPathComponent(".codex",isDirectory:true)
try fm.createDirectory(at:home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
let server=socket(AF_INET,SOCK_STREAM,0)
var address=sockaddr_in();address.sin_family=sa_family_t(AF_INET);address.sin_addr.s_addr=inet_addr("127.0.0.1");address.sin_port=0
let listening=withUnsafePointer(to:&address){p in p.withMemoryRebound(to:sockaddr.self,capacity:1){Darwin.bind(server,$0,socklen_t(MemoryLayout<sockaddr_in>.size))}}
let bindError=listening==0 ? 0 : errno
if server>=0 {close(server)}
let task=Process(),input=Pipe(),output=Pipe(),done=DispatchSemaphore(value:0),lock=NSLock()
task.executableURL=Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/codex")
task.currentDirectoryURL=work
task.environment=["HOME":work.path,"CODEX_HOME":home.path,"PATH":"/usr/bin:/bin","TMPDIR":NSTemporaryDirectory()]
task.arguments=["app-server","--listen","stdio://"]
task.standardInput=input;task.standardOutput=output;task.standardError=FileHandle.nullDevice
var buffer=Data(),initialized=false,accountReply=false,authenticated=false,invalid=false
func send(_ value:[String:Any]){let data=try! JSONSerialization.data(withJSONObject:value);input.fileHandleForWriting.write(data);input.fileHandleForWriting.write(Data("\n".utf8))}
output.fileHandleForReading.readabilityHandler={handle in
 let data=handle.availableData
 if data.isEmpty{done.signal();return}
 lock.lock();defer{lock.unlock()};buffer.append(data)
 if buffer.count>1024*1024{invalid=true;done.signal();return}
 while let index=buffer.firstIndex(of:10){let line=buffer[..<index];buffer.removeSubrange(...index)
  guard let packet=(try? JSONSerialization.jsonObject(with:line)) as? [String:Any],let id=packet["id"] as? Int else {continue}
  if id==1 {initialized=packet["result"] != nil;if initialized{send(["method":"initialized"]);send(["id":2,"method":"account/read","params":["refreshToken":false]])}else{done.signal()}}
  if id==2 {accountReply=packet["result"] != nil;let result=packet["result"] as? [String:Any];authenticated=result?["account"] as? [String:Any] != nil;done.signal()}
 }
}
var launched=false,launchError=0,timedOut=false
 do {try task.run();launched=true;send(["id":1,"method":"initialize","params":["clientInfo":["name":"qiuqiu_sandbox_probe","version":"1.0"],"capabilities":["experimentalApi":true]]]);timedOut=done.wait(timeout:.now()+20) == .timedOut;if task.isRunning{task.terminate()};task.waitUntilExit()}catch{launchError=(error as NSError).code}
output.fileHandleForReading.readabilityHandler=nil
lock.lock();let result:[String:Any]=["syntheticExternalFileReadable":fm.isReadableFile(atPath:fixture.path),"loopbackBindAllowed":listening==0,"loopbackBindErrno":Int(bindError),"bundledHelperLaunched":launched,"launchError":launchError,"initializeReply":initialized,"accountReply":accountReply,"authenticated":authenticated,"timedOut":timedOut,"invalidOutput":invalid,"helperExitCode":launched ? Int(task.terminationStatus) : -1,"modelRequests":0,"originalCredentialsRead":false];lock.unlock()
emit(result)
try? fm.removeItem(at:work)
