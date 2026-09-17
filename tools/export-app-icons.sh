#!/usr/bin/env bash
# Scale Circeco PWA / home-screen icons from the designer raster master
# (frontend/src/assets/icons/app-icon.png). 512 outputs stay byte-identical
# to that PNG; 180/192 (and favicons) are LANCZOS downscales so the baked
# rounded coral frame stays uniform. Vector geometry lives in app-icon.svg
# and app-icon-maskable.svg for editing — do not rasterize a sharp-square mark.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONUNBUFFERED=1

if ! python3 -c "from PIL import Image" 2>/dev/null; then
  echo "Pillow is required: python3 -m pip install Pillow" >&2
  exit 1
fi

exec python3 "$ROOT/tools/export-app-icons.py"
