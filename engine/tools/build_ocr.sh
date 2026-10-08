#!/usr/bin/env bash
# Builds the Apple Vision OCR helper into engine/bin/ocr (macOS only; the rapidocr backend is the portable path).
set -euo pipefail
mkdir -p "$(dirname "$0")/../bin"
swiftc -O -o "$(dirname "$0")/../bin/ocr" "$(dirname "$0")/ocr.swift"
