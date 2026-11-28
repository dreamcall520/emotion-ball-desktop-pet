import Foundation
import WidgetKit
import Darwin

// Runs in the containing Electron process, whose main bundle owns the extension.
@_cdecl("qiuqiu_widget_center_reload")
public func qiuqiuWidgetCenterReload(_ kinds: UnsafePointer<UnsafePointer<CChar>?>?, _ count: Int32) -> Int32 {
    guard count >= 0, count <= 16, count == 0 || kinds != nil else { return -1 }
    for index in 0..<Int(count) {
        guard let kind = kinds?[index] else { return -1 }
        WidgetCenter.shared.reloadTimelines(ofKind: String(cString: kind))
    }
    return count
}

@_cdecl("qiuqiu_widget_center_bundle_identifier")
public func qiuqiuWidgetCenterBundleIdentifier() -> UnsafeMutablePointer<CChar>? {
    guard let identifier = Bundle.main.bundleIdentifier else { return nil }
    return strdup(identifier)
}
