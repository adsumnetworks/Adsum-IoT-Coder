#!/usr/bin/env python3
"""Generate SVG figures for IoT-FirmwareDebugBench v0.1.

Pure-stdlib (no matplotlib) — runs anywhere with Python 3. Re-run after
editing the DATA section.

Usage:
    python3 docs/benchmarks/scripts/generate_figures.py
"""

from pathlib import Path
import math

# ── Theme ─────────────────────────────────────────────────────────────────
ADSUM = "#d76947"          # brand orange — Adsum IoT Coder
CLAUDE = "#475569"         # slate — Claude Code baseline
FG = "#1f2937"
MUTED = "#6b7280"
GRID = "#e5e7eb"
DANGER = "#dc2626"
CARD_BORDER = "#e5e7eb"
BG = "#ffffff"
ADSUM_TINT = "#fdf2ec"     # very soft orange for insight callout
FONT = (
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, "
    "'Helvetica Neue', Arial, sans-serif"
)
FOOTER_TEXT = "Same model: Claude Haiku 4.5 · NCS v3.2.1 · n=6 BLE tasks"

# ── Data ──────────────────────────────────────────────────────────────────
F1 = {
    "thresholds": ["@1", "@3", "@5", "@7"],
    "adsum":  [4, 4, 4, 5],
    "claude": [1, 2, 3, 3],
}
F2 = {
    "levels": ["L1", "L2", "L3"],
    "adsum":  [2, 2, 1],
    "claude": [1, 2, 0],
}
# (task, adsum_M, adsum_status, claude_M, claude_status); status ∈ {BC,FI,SCF}
F3_TASKS = [
    ("L1-T1", 0.896, "BC", 3.57, "BC"),
    ("L1-T2", 4.5,   "BC", 27.0, "FI"),
    ("L2-T1", 1.0,   "BC", 6.89, "BC"),
    ("L2-T2", 0.810, "BC", 11.0, "BC"),
    ("L3-T1", 2.1,   "BC", 6.0,  "SCF"),
    ("L3-T2", 25.0,  "FI", 24.0, "FI"),
]
# Peak context window utilization in thousands of tokens
F4_TASKS  = ["L1-T1", "L1-T2", "L2-T1", "L2-T2", "L3-T1", "L3-T2"]
F4_ADSUM  = [49.9, 148.7, 105.5, 76.3, 98.7, 110.0]
F4_CLAUDE = [59.0, 169.0, 70.0,  91.0, 74.0, 130.0]
F4_THRESHOLD = 160  # 80% of 200k context
F4_MAX = 200

OUT = Path(__file__).resolve().parent.parent / "assets"

# ── SVG primitives ────────────────────────────────────────────────────────

def svg_open(w, h):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" font-family="{FONT}" font-size="13">'
    )

def card(w, h):
    return (
        f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="10" '
        f'fill="{BG}" stroke="{CARD_BORDER}"/>'
    )

def text(x, y, content, *, size=13, color=FG, weight=400, anchor="start", baseline=""):
    attrs = [f'x="{x}"', f'y="{y}"', f'font-size="{size}"', f'fill="{color}"',
             f'font-weight="{weight}"']
    if anchor != "start":
        attrs.append(f'text-anchor="{anchor}"')
    if baseline:
        attrs.append(f'dominant-baseline="{baseline}"')
    return f'<text {" ".join(attrs)}>{content}</text>'

def line(x1, y1, x2, y2, *, stroke=GRID, width=1, dash=""):
    extra = f' stroke-dasharray="{dash}"' if dash else ''
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" '
            f'stroke-width="{width}"{extra}/>')

def rect(x, y, w, h, *, fill=FG, rx=3, stroke="none", stroke_width=0):
    sw = f' stroke="{stroke}" stroke-width="{stroke_width}"' if stroke != "none" else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" rx="{rx}"{sw}/>'

def hatch_def(color):
    pid = "hatch-" + color.lstrip("#")
    return (
        f'<pattern id="{pid}" patternUnits="userSpaceOnUse" width="7" height="7" '
        f'patternTransform="rotate(45)">'
        f'<rect width="7" height="7" fill="{BG}"/>'
        f'<line x1="0" y1="0" x2="0" y2="7" stroke="{color}" stroke-width="3" '
        f'opacity="0.55"/>'
        f'</pattern>'
    )

def hatched_bar(x, y, w, h, color):
    pid = "hatch-" + color.lstrip("#")
    return (
        rect(x, y, w, h, fill=f"url(#{pid})", rx=3)
        + f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" '
          f'stroke="{color}" stroke-width="1.5" rx="3"/>'
    )

def legend_swatch(x, y, color, label, *, hatched=False):
    if hatched:
        swatch = hatched_bar(x, y - 11, 16, 13, color)
    else:
        swatch = rect(x, y - 11, 16, 13, fill=color, rx=2)
    return swatch + text(x + 24, y, label, size=12, color=MUTED)

def title_block(title, subtitle, *, x=28, y=34):
    out = [text(x, y, title, size=19, weight=700)]
    if subtitle:
        out.append(text(x, y + 22, subtitle, size=13, color=MUTED))
    return "\n".join(out)

# Anchored insight callout: soft orange pill with text
def insight_pill(x, y, content):
    width = len(content) * 6.3 + 28  # rough width estimate
    return (
        rect(x, y - 14, width, 24, fill=ADSUM_TINT, rx=12, stroke=ADSUM, stroke_width=1)
        + text(x + width / 2, y + 3, content, size=12, color=ADSUM, weight=600,
               anchor="middle")
    )

# ── Chart helpers (grouped bar chart) ─────────────────────────────────────

def grouped_bar_chart(w, h, *, title, subtitle, categories, series_a, series_b,
                      ymax, label_a, label_b, footer_text=FOOTER_TEXT,
                      insight=None, value_fmt=lambda v: str(v)):
    """Render a grouped bar chart (2 series, n categories) as SVG fragments."""
    margin = {"l": 80, "r": 28, "t": 100, "b": 84}
    chart_w = w - margin["l"] - margin["r"]
    chart_h = h - margin["t"] - margin["b"]
    x0, y0 = margin["l"], margin["t"]
    x1, y1 = x0 + chart_w, y0 + chart_h

    n = len(categories)
    group_w = chart_w / n
    bar_w = min(42, group_w * 0.32)
    gap_between_bars = 6

    parts = [svg_open(w, h), card(w, h), hatch_def(ADSUM), hatch_def(CLAUDE)]
    parts.append(title_block(title, subtitle))

    # Insight pill anchored top-right of title block
    if insight:
        parts.append(insight_pill(w - 28 - (len(insight) * 6.3 + 28), 82, insight))

    # Y-axis gridlines (dashed) + tick labels
    for i in range(ymax + 1):
        ty = y1 - (i / ymax) * chart_h
        parts.append(line(x0, ty, x1, ty, stroke=GRID, dash=("" if i == 0 else "3,3")))
        parts.append(text(x0 - 12, ty + 4, str(i), size=11, color=MUTED, anchor="end"))

    # Bars
    for i, cat in enumerate(categories):
        cx = x0 + group_w * (i + 0.5)
        va = series_a[i]
        vb = series_b[i]

        bx_a = cx - bar_w - gap_between_bars / 2
        bx_b = cx + gap_between_bars / 2
        ha = (va / ymax) * chart_h
        hb = (vb / ymax) * chart_h

        parts.append(rect(bx_a, y1 - ha, bar_w, ha, fill=ADSUM, rx=3))
        parts.append(rect(bx_b, y1 - hb, bar_w, hb, fill=CLAUDE, rx=3))

        # Value labels above bars
        parts.append(text(bx_a + bar_w / 2, y1 - ha - 8, value_fmt(va),
                          size=12, weight=700, anchor="middle"))
        parts.append(text(bx_b + bar_w / 2, y1 - hb - 8, value_fmt(vb),
                          size=12, weight=700, anchor="middle"))

        # X-axis category label
        parts.append(text(cx, y1 + 22, cat, size=13, color=FG, weight=500, anchor="middle"))

    # Legend (bottom left)
    parts.append(legend_swatch(x0, h - 44, ADSUM, label_a))
    parts.append(legend_swatch(x0 + 200, h - 44, CLAUDE, label_b))

    # Footer (bottom right)
    parts.append(text(w - 28, h - 18, footer_text, size=11, color=MUTED, anchor="end"))

    parts.append("</svg>")
    return "\n".join(parts)

# ── Figure 3: token chart with log scale + failure hatching ───────────────

def token_chart(w, h):
    margin = {"l": 80, "r": 28, "t": 100, "b": 84}
    chart_w = w - margin["l"] - margin["r"]
    chart_h = h - margin["t"] - margin["b"]
    x0, y0 = margin["l"], margin["t"]
    x1, y1 = x0 + chart_w, y0 + chart_h

    n = len(F3_TASKS)
    group_w = chart_w / n
    bar_w = min(38, group_w * 0.30)
    gap = 6

    # Log scale: 0.5M → 30M
    log_min = math.log10(0.5)
    log_max = math.log10(30)

    def y_of(v):
        return y1 - (math.log10(v) - log_min) / (log_max - log_min) * chart_h

    parts = [svg_open(w, h), card(w, h), hatch_def(ADSUM), hatch_def(CLAUDE)]
    parts.append(title_block(
        "Token Consumption per Task",
        "Tokens per session (millions, log scale). Hatched bars = failed task."))

    # Insight pill (top-right)
    insight = "3.8× more token-efficient overall"
    parts.append(insight_pill(w - 28 - (len(insight) * 6.3 + 28), 82, insight))

    # Y-axis: gridlines at 0.5, 1, 3, 10, 30
    for v, label in [(0.5, "0.5M"), (1, "1M"), (3, "3M"), (10, "10M"), (30, "30M")]:
        ty = y_of(v)
        parts.append(line(x0, ty, x1, ty, stroke=GRID, dash="3,3"))
        parts.append(text(x0 - 12, ty + 4, label, size=11, color=MUTED, anchor="end"))

    # Vertical separators between difficulty levels (after L1-T2 and L2-T2, i.e. positions 2 and 4)
    for sep_i in (2, 4):
        sx = x0 + group_w * sep_i
        parts.append(line(sx, y0 + 4, sx, y1, stroke=GRID, dash="2,4"))

    # Difficulty level group labels (L1, L2, L3) above chart area
    level_centers = {
        "L1": x0 + group_w * 1,
        "L2": x0 + group_w * 3,
        "L3": x0 + group_w * 5,
    }
    for label, cx in level_centers.items():
        parts.append(text(cx, y0 - 4, label, size=11, color=MUTED, weight=600, anchor="middle"))

    # Bars
    for i, (cat, va, sa, vb, sb) in enumerate(F3_TASKS):
        cx = x0 + group_w * (i + 0.5)
        bx_a = cx - bar_w - gap / 2
        bx_b = cx + gap / 2

        ya = y_of(va)
        yb = y_of(vb)
        ha = y1 - ya
        hb = y1 - yb

        # Adsum bar
        if sa == "BC":
            parts.append(rect(bx_a, ya, bar_w, ha, fill=ADSUM, rx=3))
        else:
            parts.append(hatched_bar(bx_a, ya, bar_w, ha, ADSUM))

        # Claude bar
        if sb == "BC":
            parts.append(rect(bx_b, yb, bar_w, hb, fill=CLAUDE, rx=3))
        else:
            parts.append(hatched_bar(bx_b, yb, bar_w, hb, CLAUDE))

        # Value labels with optional status badge
        def fmt(v):
            if v >= 10:
                return f"{v:.0f}M"
            return f"{v:.1f}M" if v >= 1 else f"{int(v*1000)}k"

        a_label = fmt(va) + (f" {sa}" if sa != "BC" else "")
        b_label = fmt(vb) + (f" {sb}" if sb != "BC" else "")

        a_color = DANGER if sa != "BC" else FG
        b_color = DANGER if sb != "BC" else FG
        a_weight = 700 if sa != "BC" else 700
        b_weight = 700 if sb != "BC" else 700

        parts.append(text(bx_a + bar_w / 2, ya - 8, a_label,
                          size=11, weight=a_weight, color=a_color, anchor="middle"))
        parts.append(text(bx_b + bar_w / 2, yb - 8, b_label,
                          size=11, weight=b_weight, color=b_color, anchor="middle"))

        # X-axis task label
        parts.append(text(cx, y1 + 22, cat, size=13, weight=500, color=FG, anchor="middle"))

    # Legend
    parts.append(legend_swatch(x0, h - 44, ADSUM, "Adsum IoT Coder"))
    parts.append(legend_swatch(x0 + 180, h - 44, CLAUDE, "Claude Code"))
    parts.append(legend_swatch(x0 + 340, h - 44, MUTED, "hatched = failed (FI / SCF)", hatched=True))

    parts.append(text(w - 28, h - 18, FOOTER_TEXT, size=11, color=MUTED, anchor="end"))
    parts.append("</svg>")
    return "\n".join(parts)

# ── Figure 4: context utilization line chart with threshold ───────────────

def context_chart(w, h):
    margin = {"l": 80, "r": 28, "t": 100, "b": 84}
    chart_w = w - margin["l"] - margin["r"]
    chart_h = h - margin["t"] - margin["b"]
    x0, y0 = margin["l"], margin["t"]
    x1, y1 = x0 + chart_w, y0 + chart_h

    n = len(F4_TASKS)
    step = chart_w / (n - 1)
    ymax = F4_MAX

    def y_of(v):
        return y1 - (v / ymax) * chart_h

    def x_of(i):
        return x0 + step * i

    parts = [svg_open(w, h), card(w, h)]
    parts.append(title_block(
        "Peak Context Window Utilization per Task",
        "Tokens (thousands). Dashed line marks 80% of the 200k context window — "
        "beyond this Claude Code loses early context and fails."))

    # Insight pill
    insight = "Claude Code crosses 80% on L1-T2 → fails"
    parts.append(insight_pill(w - 28 - (len(insight) * 6.3 + 28), 82, insight))

    # Y-axis gridlines at 50, 100, 150, 200 (k)
    for v in [50, 100, 150, 200]:
        ty = y_of(v)
        parts.append(line(x0, ty, x1, ty, stroke=GRID, dash="3,3"))
        parts.append(text(x0 - 12, ty + 4, f"{v}k", size=11, color=MUTED, anchor="end"))

    # 80% threshold line
    ty_thresh = y_of(F4_THRESHOLD)
    parts.append(line(x0, ty_thresh, x1, ty_thresh, stroke=DANGER, width=1.5, dash="6,4"))
    parts.append(text(x1 - 4, ty_thresh - 6, "80% threshold (160k)",
                      size=11, color=DANGER, weight=600, anchor="end"))

    # Adsum line (solid)
    adsum_pts = [(x_of(i), y_of(v)) for i, v in enumerate(F4_ADSUM)]
    d_a = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in adsum_pts)
    parts.append(f'<path d="{d_a}" fill="none" stroke="{ADSUM}" stroke-width="2.5"/>')

    # Claude line (dashed)
    claude_pts = [(x_of(i), y_of(v)) for i, v in enumerate(F4_CLAUDE)]
    d_c = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in claude_pts)
    parts.append(f'<path d="{d_c}" fill="none" stroke="{CLAUDE}" stroke-width="2.5" '
                 f'stroke-dasharray="6,4"/>')

    # Data points + value labels
    for i, (cat, va, vc) in enumerate(zip(F4_TASKS, F4_ADSUM, F4_CLAUDE)):
        xa, ya = adsum_pts[i]
        xc, yc = claude_pts[i]

        # Adsum marker
        parts.append(f'<circle cx="{xa:.1f}" cy="{ya:.1f}" r="4.5" fill="{ADSUM}"/>')

        # Claude marker — flag the threshold crossing
        is_over_threshold = vc > F4_THRESHOLD
        claude_color = DANGER if is_over_threshold else CLAUDE
        parts.append(f'<circle cx="{xc:.1f}" cy="{yc:.1f}" r="4.5" fill="{claude_color}"/>')

        # Value labels (offset to reduce collision)
        # Adsum below the marker if claude is above, else above
        if va < vc:
            parts.append(text(xa, ya + 18, f"{va:.0f}k", size=11, color=FG, weight=600, anchor="middle"))
            parts.append(text(xc, yc - 12, f"{vc:.0f}k" + (" FI" if is_over_threshold else ""),
                              size=11, color=claude_color, weight=700, anchor="middle"))
        else:
            parts.append(text(xa, ya - 12, f"{va:.0f}k", size=11, color=FG, weight=600, anchor="middle"))
            parts.append(text(xc, yc + 18, f"{vc:.0f}k", size=11, color=claude_color, weight=600, anchor="middle"))

        # X-axis category label
        parts.append(text(xa, y1 + 22, cat, size=13, weight=500, color=FG, anchor="middle"))

    # Legend
    parts.append(legend_swatch(x0, h - 44, ADSUM, "Adsum IoT Coder"))
    parts.append(legend_swatch(x0 + 180, h - 44, CLAUDE, "Claude Code (dashed)"))

    parts.append(text(w - 28, h - 18, FOOTER_TEXT, size=11, color=MUTED, anchor="end"))
    parts.append("</svg>")
    return "\n".join(parts)

# ── Main ──────────────────────────────────────────────────────────────────

def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # Figure 1 — BC Rate by Threshold
    fig1 = grouped_bar_chart(
        w=820, h=480,
        title="BC Rate by Threshold",
        subtitle="Tasks resolved (out of 6) at each flash-cycle threshold.",
        categories=F1["thresholds"],
        series_a=F1["adsum"],
        series_b=F1["claude"],
        ymax=6,
        label_a="Adsum IoT Coder",
        label_b="Claude Code",
        insight="3× more first-flash fixes",
    )
    (OUT / "figure1.svg").write_text(fig1)

    # Figure 2 — BC@7 by Difficulty Level
    fig2 = grouped_bar_chart(
        w=720, h=460,
        title="BC@7 by Difficulty Level",
        subtitle="Tasks resolved per level (max 2 per level), within 7 flash attempts.",
        categories=F2["levels"],
        series_a=F2["adsum"],
        series_b=F2["claude"],
        ymax=2,
        label_a="Adsum IoT Coder",
        label_b="Claude Code",
        insight="Gap widens at L3",
    )
    (OUT / "figure2.svg").write_text(fig2)

    # Figure 3 — Token Consumption per Task
    fig3 = token_chart(w=1040, h=520)
    (OUT / "figure3.svg").write_text(fig3)

    # Figure 4 — Peak Context Window Utilization per Task
    fig4 = context_chart(w=1040, h=480)
    (OUT / "figure4.svg").write_text(fig4)

    print(f"wrote 4 SVGs to {OUT}")

if __name__ == "__main__":
    main()
