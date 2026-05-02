// DPI helpers — formatting + the algorithm spec for the explainer page.
// Heavy DPI computation is done at build time (scripts/build_data.py) so the
// site only needs these display utilities.

const DPI = {
  WEIGHTS: { quali: 0.40, racecraft: 0.60 },

  fmtDelta(d) {
    if (d == null) return '—';
    const s = d > 0 ? '+' : '';
    return `${s}${d.toFixed(2)}%`;
  },

  fmtScore(s) {
    return s == null ? '—' : Number(s).toFixed(1);
  },

  // Color a score 0-100 from red to green via mid-yellow.
  scoreColor(s) {
    if (s == null) return '#6b7280';
    const t = Math.max(0, Math.min(100, s)) / 100;
    // 0 -> red(220,40,40), 0.5 -> yellow(255,200,60), 1 -> green(60,200,120)
    const lerp = (a, b, x) => Math.round(a + (b - a) * x);
    let r, g, b;
    if (t < 0.5) {
      const u = t * 2;
      r = lerp(220, 255, u); g = lerp(40, 200, u); b = lerp(40, 60, u);
    } else {
      const u = (t - 0.5) * 2;
      r = lerp(255, 60, u); g = lerp(200, 200, u); b = lerp(60, 120, u);
    }
    return `rgb(${r},${g},${b})`;
  },
};

window.DPI = DPI;
