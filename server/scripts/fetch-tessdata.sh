#!/usr/bin/env bash
# Downloads the bundled Tesseract language data into server/tessdata (build time only).
# The OCR worker reads these files locally and never downloads language data at runtime.
set -euo pipefail
cd "$(dirname "$0")/../tessdata"
BASE="https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0"
for lang in eng nor; do
  curl -fsSL -o "${lang}.traineddata" "${BASE}/${lang}.traineddata"
done
shasum -a 256 *.traineddata > SHA256SUMS
cat SHA256SUMS
