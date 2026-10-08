// Reads every text line in ONE image with Apple's Vision framework and prints a flat JSON array:
//   [{"text", "confidence", "x", "y", "w", "h"}]
// Boxes are normalised to the image (0..1) with the origin at the TOP-LEFT. Vision reports bottom-left,
// so y is flipped here. This is the shape design_engine.measure.ocr._vision parses.
//
// Adapted from the previous Socialytics session's checks/ocr.swift (2026-10-07), which wrapped the lines
// per file; the engine calls this once per image, so the wrapper is dropped and a bad path is an error.
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments.dropFirst()
guard args.count == 1, let path = args.first else {
    FileHandle.standardError.write("usage: ocr <image>\n".data(using: .utf8)!)
    exit(2)
}
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("ocr: could not load \(path)\n".data(using: .utf8)!)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([request]) } catch {
    FileHandle.standardError.write("ocr: \(error)\n".data(using: .utf8)!)
    exit(1)
}

var lines: [[String: Any]] = []
for obs in request.results ?? [] {
    guard let top = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox
    lines.append([
        "text": top.string,
        "confidence": Double(top.confidence),
        "x": Double(b.origin.x),
        "y": Double(1 - b.origin.y - b.size.height),
        "w": Double(b.size.width),
        "h": Double(b.size.height),
    ])
}
lines.sort { ($0["y"] as! Double) < ($1["y"] as! Double) }
let data = try! JSONSerialization.data(withJSONObject: lines, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
