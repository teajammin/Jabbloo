// Removes the flat background from a PNG, in place.
//
//   swift scripts/strip-background.swift <file.png> [luminance-threshold]
//
// Flood-fills inward from the edges rather than keying out light pixels
// globally, so pale areas INSIDE the artwork survive — the axe's cream bevel
// would be punched full of holes by a naive white-key.
//
// macOS only (AppKit). Also useful later for player-uploaded images.

import Foundation
import AppKit

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("usage: strip-background.swift <file.png> [threshold]\n".data(using: .utf8)!)
    exit(2)
}
let path = args[1]
let threshold = args.count > 2 ? Int(args[2]) ?? 236 : 236

guard let img = NSImage(contentsOfFile: path) else { fatalError("cannot open \(path)") }
var rect = CGRect(origin: .zero, size: img.size)
guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    fatalError("cannot decode \(path)")
}

let w = cg.width, h = cg.height
var px = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8,
                    bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

@inline(__always) func lum(_ i: Int) -> Int {
    (299 * Int(px[i]) + 587 * Int(px[i + 1]) + 114 * Int(px[i + 2])) / 1000
}

// Flood fill from every edge pixel.
var seen = [Bool](repeating: false, count: w * h)
var stack: [Int] = []
for x in 0..<w { stack.append(x); stack.append((h - 1) * w + x) }
for y in 0..<h { stack.append(y * w); stack.append(y * w + w - 1) }

// Anything lighter than this is background-ish; the band below `threshold`
// gets partial alpha so edges stay soft instead of jagged.
let soft = threshold - 40
var cleared = 0

while let p = stack.popLast() {
    if seen[p] { continue }
    let i = p * 4
    let l = lum(i)
    if l < soft { continue }                 // reached the artwork
    seen[p] = true
    px[i + 3] = l >= threshold ? 0 : UInt8(max(0, min(255, (threshold - l) * 255 / 40)))
    if px[i + 3] == 0 { cleared += 1 }
    let x = p % w, y = p / w
    if x > 0 { stack.append(p - 1) }
    if x < w - 1 { stack.append(p + 1) }
    if y > 0 { stack.append(p - w) }
    if y < h - 1 { stack.append(p + w) }
}

let out = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8,
                    bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let rep = NSBitmapImageRep(cgImage: out.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))

let pct = Double(cleared) / Double(w * h) * 100
print(String(format: "%@: cleared %d px (%.1f%% of %dx%d)", (path as NSString).lastPathComponent, cleared, pct, w, h))
