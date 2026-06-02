#!/usr/bin/env python3
"""Generate 1080×1080 social-video cards for the Adsum IoT Coder launch.

Cards (matching the 30s shot list):
  hook.svg         — [0:00–0:03] the headline reveal: 5/6 vs 3/6, 3.8×
  context.svg      — [0:03–0:10] the 169k/200k context-overflow problem flash
  proof.svg        — [0:20–0:26] full benchmark proof, held 4s
  end.svg          — [0:26–0:30] brand + URLs + Marketplace

Outputs SVG + PNG into assets/social/. Run from repo root:
    python3 assets/social/scripts/generate.py
"""

from pathlib import Path
import base64
import subprocess

# ── Theme ─────────────────────────────────────────────────────────────────
BG = "#0a0a0a"              # near-black social bg
ADSUM = "#d76947"           # brand orange
ADSUM_GLOW = "#e88560"
CLAUDE = "#64748b"          # slate (lighter than report — visible on dark)
FG = "#ffffff"
MUTED = "#9ca3af"
DIM = "#4b5563"
DANGER = "#ef4444"
CARD = "#0f0f0f"
BORDER = "#1f2937"

FONT = "ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif"

SIZE = 1080
OUT = Path(__file__).resolve().parent.parent
BRANDING = OUT.parent / "branding"

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# ── Brand assets (base64-inlined so SVGs stay portable) ─────────────────
def _b64_png(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")

LOGO_HORIZONTAL = _b64_png(BRANDING / "Adsum IoT Coder - full.png")  # 2782×1113
LOGO_MARK = _b64_png(BRANDING / "adsum coder logo org2.png")          # 374×384

def img(href_data_uri: str, x: float, y: float, w: float, h: float) -> str:
    return f'<image href="data:image/png;base64,{href_data_uri}" x="{x}" y="{y}" width="{w}" height="{h}"/>'

def brand_header(*, x=48, y=50, height=100):
    """Horizontal logo top-left — used on hook/context/proof cards."""
    # Aspect 2782:1113 ≈ 2.5
    width = height * 2782 / 1113
    return img(LOGO_HORIZONTAL, x, y, width, height)

# ── SVG primitives ────────────────────────────────────────────────────────

def svg_open(w=SIZE, h=SIZE):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" font-family="{FONT}">'
    )

def bg(color=BG):
    return f'<rect width="{SIZE}" height="{SIZE}" fill="{color}"/>'

def text(x, y, content, *, size=48, color=FG, weight=500, anchor="start", letter=0):
    extras = []
    if anchor != "start":
        extras.append(f'text-anchor="{anchor}"')
    if letter:
        extras.append(f'letter-spacing="{letter}"')
    extra = " " + " ".join(extras) if extras else ""
    return (
        f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" '
        f'font-weight="{weight}"{extra}>{content}</text>'
    )

def rect(x, y, w, h, *, fill="#000", rx=0, stroke="none", sw=0):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke != "none" else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" rx="{rx}"{s}/>'

def line(x1, y1, x2, y2, *, stroke=BORDER, width=1):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{width}"/>'

# ── Card 1: HOOK ─────────────────────────────────────────────────────────
# [0:00–0:03] Massive contrast headline. Optimized for 1.5s readability.
def hook_card():
    p = [svg_open(), bg()]
    p.append(brand_header())

    # Tag
    p.append(text(SIZE/2, 220, "IOT-FIRMWAREDEBUGBENCH v0.1",
                  size=22, color=MUTED, weight=700, anchor="middle", letter=2))
    p.append(text(SIZE/2, 265, "Same model · Claude Haiku 4.5",
                  size=28, color=FG, weight=400, anchor="middle"))

    # Massive headline split
    p.append(text(SIZE * 0.28, 440, "5/6", size=200, color=ADSUM, weight=800, anchor="middle"))
    p.append(text(SIZE/2,      415, "VS",   size=42,  color=MUTED, weight=700, anchor="middle"))
    p.append(text(SIZE * 0.72, 440, "3/6", size=200, color=CLAUDE, weight=800, anchor="middle"))

    # Labels under
    p.append(text(SIZE * 0.28, 500, "Adsum IoT Coder",
                  size=30, color=FG, weight=600, anchor="middle"))
    p.append(text(SIZE * 0.72, 500, "Claude Code",
                  size=30, color=MUTED, weight=600, anchor="middle"))

    # Sub-headline: tasks resolved
    p.append(text(SIZE/2, 555, "tasks resolved on real nRF hardware",
                  size=26, color=DIM, weight=400, anchor="middle"))

    # Divider
    p.append(line(SIZE * 0.32, 610, SIZE * 0.68, 610, stroke=BORDER, width=1))

    # Big efficiency
    p.append(text(SIZE/2, 770, "3.8×", size=160, color=ADSUM, weight=800, anchor="middle"))
    p.append(text(SIZE/2, 820, "more token-efficient",
                  size=38, color=FG, weight=500, anchor="middle"))

    p.append("</svg>")
    return "\n".join(p)

# ── Card 2: CONTEXT OVERFLOW ─────────────────────────────────────────────
# [0:03–0:10] The 169k/200k problem, dramatic gauge.
def context_card():
    p = [svg_open(), bg()]
    p.append(brand_header())

    # Tag
    p.append(text(SIZE/2, 220, "WHEN A GENERAL AGENT RUNS OUT OF ROOM",
                  size=22, color=MUTED, weight=700, anchor="middle", letter=2))
    p.append(text(SIZE/2, 270, "Claude Code · L1-T2",
                  size=32, color=FG, weight=600, anchor="middle"))

    # Gauge: 1080 wide, draw at center
    # Gauge bar 800x60, x=140 to 940, y=350
    gauge_x = 140
    gauge_y = 360
    gauge_w = 800
    gauge_h = 80
    pct = 169 / 200  # 84.5%
    fill_w = int(gauge_w * pct)

    # Track
    p.append(rect(gauge_x, gauge_y, gauge_w, gauge_h, fill=CARD, rx=12,
                  stroke=BORDER, sw=2))
    # Fill (Claude slate — this card depicts Claude Code's failure)
    p.append(rect(gauge_x, gauge_y, fill_w, gauge_h, fill=CLAUDE, rx=12))

    # Threshold marker at 80%
    thresh_x = gauge_x + int(gauge_w * 0.8)
    p.append(line(thresh_x, gauge_y - 18, thresh_x, gauge_y + gauge_h + 18,
                  stroke=FG, width=2))
    p.append(text(thresh_x, gauge_y - 28, "80%",
                  size=22, color=FG, weight=600, anchor="middle"))

    # Axis labels
    p.append(text(gauge_x, gauge_y + gauge_h + 36, "0",
                  size=20, color=MUTED, weight=500))
    p.append(text(gauge_x + gauge_w, gauge_y + gauge_h + 36, "200k",
                  size=20, color=MUTED, weight=500, anchor="end"))

    # Headline number
    p.append(text(SIZE/2, 600, "169k", size=160, color=CLAUDE, weight=800, anchor="middle"))
    p.append(text(SIZE/2, 660, "tokens of 200k context window",
                  size=32, color=FG, weight=500, anchor="middle"))

    # Story
    p.append(text(SIZE/2, 750, "model loses early context", size=30, color=MUTED, weight=500, anchor="middle"))
    p.append(text(SIZE/2, 800, "27M tokens spent · task fails", size=32, color=FG, weight=700, anchor="middle"))

    p.append("</svg>")
    return "\n".join(p)

# ── Card 3: PROOF TABLE ──────────────────────────────────────────────────
# [0:20–0:26] Full results, held 4s.
def proof_card():
    p = [svg_open(), bg()]
    p.append(brand_header())

    # Header
    p.append(text(SIZE/2, 215, "IOT-FIRMWAREDEBUGBENCH v0.1 — RESULTS",
                  size=22, color=MUTED, weight=700, anchor="middle", letter=2))
    p.append(text(SIZE/2, 260, "Same model · Claude Haiku 4.5 · NCS v3.2.1",
                  size=24, color=FG, weight=400, anchor="middle"))

    # Comparison table: column headers
    col_a_x = SIZE * 0.55
    col_b_x = SIZE * 0.83
    row_h = 95

    # Header row
    y0 = 345
    p.append(text(col_a_x, y0, "Adsum IoT Coder",
                  size=22, color=ADSUM, weight=700, anchor="middle"))
    p.append(text(col_b_x, y0, "Claude Code",
                  size=22, color=CLAUDE, weight=700, anchor="middle"))

    # Rows
    rows = [
        ("Tasks resolved",    "5/6",   "3/6",   True),
        ("L1 (visible in logs)", "2/2", "1/2", False),
        ("L2 (inference)",   "2/2",   "2/2",   False),
        ("L3 (cross-device)", "1/2",  "0/2",   False),
        ("Tokens per task",  "1.86M", "7.15M", True),
    ]

    y = y0 + 60
    for label, a, b, highlight in rows:
        # Highlight bar for key rows
        if highlight:
            p.append(rect(60, y - 50, SIZE - 120, row_h - 10, fill="#1a1a1a", rx=8))

        p.append(text(80, y, label, size=30, color=FG, weight=500))
        p.append(text(col_a_x, y, a, size=44 if highlight else 32,
                      color=ADSUM if highlight else FG,
                      weight=800 if highlight else 600, anchor="middle"))
        p.append(text(col_b_x, y, b, size=44 if highlight else 32,
                      color=CLAUDE,
                      weight=600 if highlight else 500, anchor="middle"))

        y += row_h
        # Divider
        if not highlight:
            p.append(line(80, y - 50, SIZE - 80, y - 50, stroke=BORDER, width=1))

    # Big efficiency call-out at bottom
    p.append(rect(80, 920, SIZE - 160, 110, fill=ADSUM, rx=12))
    p.append(text(SIZE/2, 975, "3.8× more token-efficient overall",
                  size=44, color="#1a0a06", weight=800, anchor="middle"))
    p.append(text(SIZE/2, 1010, "up to 13× on individual tasks",
                  size=24, color="#1a0a06", weight=500, anchor="middle"))

    p.append("</svg>")
    return "\n".join(p)

# ── Card 4: END CARD ─────────────────────────────────────────────────────
# [0:26–0:30] Brand + URLs + Marketplace term + Apache 2.0
def end_card():
    p = [svg_open(), bg()]

    # HERO: full horizontal logo, centered, big
    # Aspect 2782:1113. Width 720 → height 720 * 1113/2782 ≈ 288
    hero_w = 720
    hero_h = hero_w * 1113 / 2782
    hero_x = (SIZE - hero_w) / 2
    hero_y = 180
    p.append(img(LOGO_HORIZONTAL, hero_x, hero_y, hero_w, hero_h))

    # Tagline below logo
    p.append(text(SIZE/2, hero_y + hero_h + 70,
                  "AI debugging agent for embedded firmware",
                  size=28, color=MUTED, weight=400, anchor="middle"))

    # Divider
    p.append(line(SIZE * 0.3, 600, SIZE * 0.7, 600, stroke=BORDER, width=2))

    # Marketplace call-to-action
    p.append(text(SIZE/2, 670, "Search VS Code Marketplace:",
                  size=26, color=MUTED, weight=500, anchor="middle"))
    p.append(text(SIZE/2, 720, "\"Adsum IoT Coder\"",
                  size=44, color=ADSUM, weight=700, anchor="middle"))

    # GitHub
    p.append(text(SIZE/2, 820, "Open source on GitHub",
                  size=26, color=MUTED, weight=500, anchor="middle"))
    p.append(text(SIZE/2, 865, "github.com/adsumnetworks/Adsum-IoT-Coder",
                  size=28, color=FG, weight=600, anchor="middle"))

    # Apache 2.0 badge (subtle pill)
    badge_w, badge_h = 200, 38
    badge_x = (SIZE - badge_w) / 2
    badge_y = 925
    p.append(rect(badge_x, badge_y, badge_w, badge_h, fill="none",
                  rx=19, stroke=BORDER, sw=1))
    p.append(text(SIZE/2, badge_y + 26, "Apache 2.0",
                  size=20, color=MUTED, weight=600, anchor="middle"))

    p.append("</svg>")
    return "\n".join(p)

# ── Main ──────────────────────────────────────────────────────────────────

CARDS = {
    "hook":    hook_card,
    "context": context_card,
    "proof":   proof_card,
    "end":     end_card,
}

def render_png(svg_path: Path):
    """Render SVG to PNG at exact 1080×1080 via Chrome headless."""
    png_path = svg_path.with_suffix(".png")
    subprocess.run([
        CHROME,
        "--headless", "--disable-gpu", "--no-sandbox",
        "--hide-scrollbars",
        f"--default-background-color=000000ff",
        f"--screenshot={png_path}",
        f"--window-size={SIZE},{SIZE}",
        f"file://{svg_path}",
    ], check=True, capture_output=True)
    return png_path

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in CARDS.items():
        svg_path = OUT / f"{name}.svg"
        svg_path.write_text(fn())
        png_path = render_png(svg_path)
        size_kb = png_path.stat().st_size // 1024
        print(f"wrote {svg_path.name} + {png_path.name} ({size_kb}KB)")

if __name__ == "__main__":
    main()
