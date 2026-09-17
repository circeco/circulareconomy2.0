#!/usr/bin/env python3
"""Scale the Circeco designer icon master to PWA / home-screen sizes.

The 512×512 file frontend/src/assets/icons/app-icon.png is the source of truth
(pixel-identical to the designer asset). 512 outputs are byte copies. Smaller
sizes are LANCZOS downscales of that PNG so the baked rounded coral frame and
rounded logo corners stay in proportion. Do not redraw the mark.
"""

from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "frontend" / "src" / "assets" / "icons"
MASTER = ICONS / "app-icon.png"

EXACT_COPIES = (
    "android-chrome-512x512.png",
    "icon-512-maskable.png",
)

LANCZOS_SIZES = (
    (180, "apple-touch-icon.png"),
    (192, "android-chrome-192x192.png"),
    (192, "icon-192-maskable.png"),
    (32, "favicon-32x32.png"),
    (16, "favicon-16x16.png"),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if not MASTER.is_file():
        print(f"missing designer master: {MASTER}", file=sys.stderr)
        return 1

    master = Image.open(MASTER)
    if master.size != (512, 512):
        print(f"master must be 512x512, got {master.size}", file=sys.stderr)
        return 1
    src = master.convert("RGBA")
    master_digest = sha256(MASTER)

    for name in EXACT_COPIES:
        dest = ICONS / name
        shutil.copyfile(MASTER, dest)
        if sha256(dest) != master_digest:
            print(f"{dest} is not byte-identical to {MASTER}", file=sys.stderr)
            return 1

    for size, name in LANCZOS_SIZES:
        dest = ICONS / name
        src.resize((size, size), Image.Resampling.LANCZOS).save(dest, format="PNG")

    ico = src.resize((32, 32), Image.Resampling.LANCZOS)
    ico.save(
        ICONS / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32)],
    )

    print("Wrote (512 copies byte-identical to app-icon.png):")
    for name in EXACT_COPIES:
        print(f"  {ICONS / name}")
    for _, name in LANCZOS_SIZES:
        print(f"  {ICONS / name}")
    print(f"  {ICONS / 'favicon.ico'}")
    print(f"master sha256 {master_digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
