// Extracts the bubble-letter alphabet from the design brief into individual
// transparent PNG sprites, so titles, character names and weapon names can all
// be spelled in the game's own lettering.
//
//   swift scripts/extract-letters.swift [path/to/SUMMER PROJECTS.pdf]
//
// Output: public/letters/{A..Z,excl,query,dot,comma}.png + manifest.json
//
// macOS only (PDFKit + AppKit). It is a one-off asset pipeline, not part of the
// game build — run it again only if the source artwork changes.

import Foundation
import PDFKit
import AppKit

let defaultPDF = NSString(string: "~/Downloads/SUMMER PROJECTS.pdf").expandingTildeInPath
let pdfPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : defaultPDF
let alphabetPage = 3        // page 4, zero-based
let renderScale: CGFloat = 5.0
let outDir = "public/letters"

// ---------------------------------------------------------------- rasterise

func renderPage(_ path: String, _ index: Int, _ scale: CGFloat) -> (w: Int, h: Int, px: [UInt8]) {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
        fatalError("Could not open PDF at \(path)")
    }
    guard let page = doc.page(at: index) else {
        fatalError("PDF has no page \(index + 1)")
    }

    let box = page.bounds(for: .mediaBox)
    let W = Int(box.width * scale), H = Int(box.height * scale)
    var buf = [UInt8](repeating: 0, count: W * H * 4)

    let ctx = CGContext(data: &buf, width: W, height: H, bitsPerComponent: 8,
                        bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -box.origin.x, y: -box.origin.y)
    page.draw(with: .mediaBox, to: ctx)

    return (W, H, buf)
}

func writePNG(_ px: [UInt8], _ w: Int, _ h: Int, _ path: String) {
    var data = px
    let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8,
                        bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!
        .write(to: URL(fileURLWithPath: path))
}

let (W, H, px) = renderPage(pdfPath, alphabetPage, renderScale)

@inline(__always) func lum(_ i: Int) -> Int {
    (299 * Int(px[i]) + 587 * Int(px[i + 1]) + 114 * Int(px[i + 2])) / 1000
}

// ------------------------------------------------------------- segmentation

// The alphabet occupies the upper portion of the page, above the body text.
let regionBottom = Int(Double(H) * 0.45)
let INK = 232

/// Contiguous runs where a projection exceeds `thresh`.
func bands(_ counts: [Int], to: Int, minRun: Int, thresh: Int) -> [(Int, Int)] {
    var out: [(Int, Int)] = []
    var start = -1
    for i in 0..<to {
        if counts[i] > thresh {
            if start < 0 { start = i }
        } else if start >= 0 {
            if i - start >= minRun { out.append((start, i)) }
            start = -1
        }
    }
    if start >= 0 && to - start >= minRun { out.append((start, to)) }
    return out
}

var rowInk = [Int](repeating: 0, count: H)
for y in 0..<regionBottom {
    var c = 0
    for x in 0..<W where lum((y * W + x) * 4) < INK { c += 1 }
    rowInk[y] = c
}

let rows = bands(rowInk, to: regionBottom, minRun: 40, thresh: 2)

// Rows may come back bottom-up depending on the raster origin; the alphabet's
// last row is the short one (Y Z ! ? . ,), so if the FIRST detected row is the
// short one, the page was rasterised upside down relative to reading order.
func glyphCount(_ row: (Int, Int)) -> Int {
    var colInk = [Int](repeating: 0, count: W)
    for x in 0..<W {
        var c = 0
        for y in row.0..<row.1 where lum((y * W + x) * 4) < INK { c += 1 }
        colInk[x] = c
    }
    return bands(colInk, to: W, minRun: 8, thresh: 0).count
}

var orderedRows = rows
if let first = rows.first, let last = rows.last,
   rows.count > 1, glyphCount(first) < glyphCount(last) {
    orderedRows = rows.reversed()
    FileHandle.standardError.write("note: rows reversed to reading order\n".data(using: .utf8)!)
}

let labels: [[String]] = [
    ["A", "B", "C", "D", "E", "F", "G", "H"],
    ["I", "J", "K", "L", "M", "N", "O", "P"],
    ["Q", "R", "S", "T", "U", "V", "W", "X"],
    ["Y", "Z", "excl", "query", "dot", "comma"],
]

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

var manifest: [String: [String: Int]] = [:]

for (ri, row) in orderedRows.enumerated() {
    guard ri < labels.count else { break }

    var colInk = [Int](repeating: 0, count: W)
    for x in 0..<W {
        var c = 0
        for y in row.0..<row.1 where lum((y * W + x) * 4) < INK { c += 1 }
        colInk[x] = c
    }
    let cols = bands(colInk, to: W, minRun: 8, thresh: 0)

    for (ci, col) in cols.enumerated() {
        guard ci < labels[ri].count else { break }
        let name = labels[ri][ci]

        // Tighten the box vertically around this glyph alone.
        var top = row.1, bot = row.0
        for y in row.0..<row.1 {
            for x in col.0..<col.1 where lum((y * W + x) * 4) < INK {
                top = min(top, y); bot = max(bot, y); break
            }
        }

        let pad = 6
        let x0 = max(0, col.0 - pad), x1 = min(W, col.1 + pad)
        let y0 = max(0, top - pad), y1 = min(H, bot + pad + 1)
        let gw = x1 - x0, gh = y1 - y0
        if gw < 10 || gh < 10 { continue }

        var out = [UInt8](repeating: 0, count: gw * gh * 4)
        for y in 0..<gh {
            for x in 0..<gw {
                let s = ((y0 + y) * W + (x0 + x)) * 4
                let d = (y * gw + x) * 4
                out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255
            }
        }

        // Flood-fill the paper inward from the edges. Done this way rather than
        // keying out white globally so the glossy highlight INSIDE each letter
        // survives — the shine is part of the artwork, not background.
        var seen = [Bool](repeating: false, count: gw * gh)
        var stack: [Int] = []
        for x in 0..<gw { stack.append(x); stack.append((gh - 1) * gw + x) }
        for y in 0..<gh { stack.append(y * gw); stack.append(y * gw + gw - 1) }

        while let p = stack.popLast() {
            if seen[p] { continue }
            let i = p * 4
            let l = (299 * Int(out[i]) + 587 * Int(out[i + 1]) + 114 * Int(out[i + 2])) / 1000
            if l < 200 { continue }     // reached the letter's outline
            seen[p] = true
            // Hard clear on paper white, feathered across the blend ring so
            // letters don't get a hard white fringe.
            out[i + 3] = l >= 235 ? 0 : UInt8(max(0, min(255, (235 - l) * 255 / 35)))
            let x = p % gw, y = p / gw
            if x > 0 { stack.append(p - 1) }
            if x < gw - 1 { stack.append(p + 1) }
            if y > 0 { stack.append(p - gw) }
            if y < gh - 1 { stack.append(p + gw) }
        }

        writePNG(out, gw, gh, "\(outDir)/\(name).png")
        manifest[name] = ["w": gw, "h": gh]
        print("  \(name)  \(gw)x\(gh)")
    }
}

let json = try! JSONSerialization.data(withJSONObject: manifest,
                                       options: [.sortedKeys, .prettyPrinted])
try! json.write(to: URL(fileURLWithPath: "\(outDir)/manifest.json"))

print("\nExtracted \(manifest.count) glyphs to \(outDir)/")
