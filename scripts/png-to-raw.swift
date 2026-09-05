// Decodes PNGs to raw RGBA sidecar files: <input>.raw, laid out as
// width (u32 LE), height (u32 LE), then RGBA pixels.
//
//   swift scripts/png-to-raw.swift out/ a.png b.png ...
//
// Node has no PNG decoder available here and the raster lib only writes. All
// files are handled in one invocation because `swift` compiles the script on
// every run, and piping raw pixels back through stdout overflows the buffer.

import Foundation
import AppKit

let args = CommandLine.arguments
guard args.count > 2 else { exit(2) }
let outDir = args[1]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

for path in args.dropFirst(2) {
    guard let img = NSImage(contentsOfFile: path) else { continue }
    var r = CGRect(origin: .zero, size: img.size)
    guard let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil) else { continue }
    let w = cg.width, h = cg.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

    var data = Data()
    var wv = UInt32(w).littleEndian, hv = UInt32(h).littleEndian
    withUnsafeBytes(of: &wv) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: &hv) { data.append(contentsOf: $0) }
    data.append(Data(px))

    let name = ((path as NSString).lastPathComponent as NSString).deletingPathExtension
    try! data.write(to: URL(fileURLWithPath: "\(outDir)/\(name).raw"))
}
print("decoded \(args.count - 2) files")
