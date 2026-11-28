// A small calendar template with clear binding and four optically spaced marks.
// The existing Qiuqiu application and status icons are intentionally untouched.
import AppKit
let output = URL(fileURLWithPath: CommandLine.arguments[1])
for scale in [1, 2] {
    let side = 18 * scale
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: side, height: side)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current!.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    NSColor.black.setStroke()
    let outline = NSBezierPath(roundedRect: NSRect(x: 2, y: 1.5, width: 14, height: 13.3), xRadius: 2, yRadius: 2)
    outline.lineWidth = 1.35; outline.stroke()
    let binding = NSBezierPath(); binding.lineWidth = 1.35; binding.lineCapStyle = .round
    for x in [5.3, 12.7] { binding.move(to: NSPoint(x: x, y: 13.2)); binding.line(to: NSPoint(x: x, y: 16.5)) }
    binding.move(to: NSPoint(x: 2.4, y: 11)); binding.line(to: NSPoint(x: 15.6, y: 11)); binding.stroke()
    NSColor.black.setFill()
    for x in [6.2, 11.6] { for y in [4.6, 7.6] {
        NSBezierPath(roundedRect: NSRect(x: x-0.7, y: y-0.7, width: 1.4, height: 1.4), xRadius: 0.35, yRadius: 0.35).fill()
    } }
    NSGraphicsContext.restoreGraphicsState()
    let suffix = scale == 1 ? "" : "@2x"
    try rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("calendar-iconTemplate\(suffix).png"))
}
