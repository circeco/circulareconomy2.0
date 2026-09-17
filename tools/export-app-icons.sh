#!/usr/bin/env bash
# Rasterize Circeco PWA icons from the vector masters.
# Geometry matches frontend/src/assets/icons/app-icon.svg and app-icon-maskable.svg.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/frontend/src/assets/icons"
CORAL='#FF5252'
TEAL_TL='#0c343c'
TEAL_TR='#144f5d'
TEAL_BL='#46818f'
TEAL_BR='#76a4b1'

draw_mark() {
  local size="$1"
  local pad="$2"
  local cell="$3"
  local out="$4"
  local x1="$pad"
  local y1="$pad"
  local x2=$((pad + cell - 1))
  local y2=$((pad + cell - 1))
  local x3=$((pad + cell))
  local y3=$((pad + cell))
  local x4=$((pad + 2 * cell - 1))
  local y4=$((pad + 2 * cell - 1))

  magick -size "${size}x${size}" "xc:${CORAL}" \
    -fill "$TEAL_TL" -draw "rectangle ${x1},${y1} ${x2},${y2}" \
    -fill "$TEAL_TR" -draw "rectangle ${x3},${y1} ${x4},${y2}" \
    -fill "$TEAL_BL" -draw "rectangle ${x1},${y3} ${x2},${y4}" \
    -fill "$TEAL_BR" -draw "rectangle ${x3},${y3} ${x4},${y4}" \
    -alpha off -type TrueColor -define png:color-type=2 \
    "PNG24:${out}"
}

# any / iOS: ~10% coral inset (102/1024 in the SVG master)
draw_mark 180 18 72 "$ICONS/apple-touch-icon.png"
draw_mark 192 19 77 "$ICONS/android-chrome-192x192.png"
draw_mark 512 51 205 "$ICONS/android-chrome-512x512.png"

# maskable: logo inside the 80% safe circle (232/1024 inset in the SVG master)
draw_mark 192 44 52 "$ICONS/icon-192-maskable.png"
draw_mark 512 116 140 "$ICONS/icon-512-maskable.png"

echo "Wrote:"
printf '  %s\n' \
  "$ICONS/apple-touch-icon.png" \
  "$ICONS/android-chrome-192x192.png" \
  "$ICONS/android-chrome-512x512.png" \
  "$ICONS/icon-192-maskable.png" \
  "$ICONS/icon-512-maskable.png"
