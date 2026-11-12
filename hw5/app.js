(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(+v || d)));

  // ---------------------------------------------------------------------
  // Generic plot: numeric axes (linear or log10), series of lines / dots / bars
  // ---------------------------------------------------------------------
  function plot(cv, o) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    const m = { l: o.ml ?? 52, r: 12, t: 12, b: 28 };
    const tx = (v) => (o.xLog ? Math.log10(v) : v), ty = (v) => (o.yLog ? Math.log10(v) : v);
    const x0 = tx(o.xMin), x1 = tx(o.xMax), y0 = ty(o.yMin), y1 = ty(o.yMax);
    const X = (v) => m.l + ((tx(v) - x0) / (x1 - x0)) * (w - m.l - m.r);
    const Y = (v) => h - m.b - ((ty(v) - y0) / (y1 - y0)) * (h - m.t - m.b);
    // grid
    ctx.strokeStyle = css("--border"); ctx.fillStyle = css("--muted"); ctx.lineWidth = 1;
    const yt = o.yTicks || niceTicks(o.yMin, o.yMax, o.yLog);
    ctx.textAlign = "right";
    for (const v of yt) { const y = Y(v); ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke(); ctx.fillText(tickLabel(v, o.yLog), m.l - 6, y + 4); }
    ctx.textAlign = "center";
    for (const v of o.xTicks || niceTicks(o.xMin, o.xMax, o.xLog)) ctx.fillText(tickLabel(v, o.xLog), X(v), h - m.b + 15);
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t - 2, w - m.l - m.r, h - m.t - m.b + 4); ctx.clip();
    for (const s of o.series) {
      ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.globalAlpha = s.alpha ?? 1;
      if (s.type === "bars") {
        for (const bar of s.bars) { const [a, b, v] = bar, v0 = bar.length > 3 ? bar[3] : o.yLog ? o.yMin : 0; ctx.fillRect(X(a) + 0.5, Y(v), Math.max(X(b) - X(a) - (s.gapless ? 0 : 1), 0.8), Y(v0) - Y(v)); }
      } else if (s.type === "dots") {
        for (const [x, y] of s.pts) { ctx.beginPath(); ctx.arc(X(x), Y(y), s.r || 3, 0, 7); ctx.fill(); }
      } else {
        if (s.dash) ctx.setLineDash(s.dash);
        ctx.beginPath(); let first = true;
        for (const [x, y] of s.pts) { if (!isFinite(ty(y))) { first = true; continue; } first ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); first = false; }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    if (o.legend) {
      const pos = o.legendAt || "tl", L = o.legend.length;
      const lw = Math.max(...o.legend.map(([t]) => ctx.measureText(t).width)) + 30;
      const bx = pos[1] === "r" ? w - m.r - lw - 6 : m.l + 10;
      const by = pos[0] === "t" ? m.t + 10 : pos[0] === "b" ? h - m.b - 8 - (L - 1) * 15 : (m.t + h - m.b) / 2 - ((L - 1) * 15) / 2;
      o.legend.forEach(([t, col, dash], i) => {
        const lx = bx, ly = by + i * 15;
        ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 2; if (dash) ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(lx, ly - 3); ctx.lineTo(lx + 16, ly - 3); ctx.stroke(); ctx.setLineDash([]);
        ctx.textAlign = "left"; ctx.fillText(t, lx + 22, ly);
      });
    }
  }
  function niceTicks(lo, hi, log) {
    if (log) { const out = []; for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.floor(Math.log10(hi) + 1e-9); e++) out.push(10 ** e); return out; }
    const span = hi - lo, raw = span / 5, mag = 10 ** Math.floor(Math.log10(raw)), st = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= 6);
    const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toPrecision(12)); return out;
  }
  function tickLabel(v, log) {
    if (log) { const e = Math.round(Math.log10(v)); return e >= -2 && e <= 4 ? String(+(10 ** e).toPrecision(3)) : `1e${e}`; }
    return Math.abs(v) >= 1e4 ? v.toExponential(0) : String(+v.toPrecision(4));
  }
  const range = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };

  const COLORS = ["#7c9cff", "#5fcf8f", "#ff9f5a", "#c29bff", "#5fd0d0", "#f2c45a", "#ff7b7b", "#e6e8ee"];
  const sci = (v) => (!isFinite(v) ? (isNaN(v) ? "NaN" : "∞") : v === 0 ? "0" : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(2) : v.toFixed(6));
  const timeIt = (fn, reps) => { const t0 = performance.now(); let s = 0; for (let i = 0; i < reps; i++) s += fn(i) || 0; return { ms: (performance.now() - t0) / reps, s }; };

  // =====================================================================
  // Ex. 1
  // =====================================================================
  const F = () => Integ.FUNCS[+$("fSel").value];

  function drawExplorer() {
    const f = F(), n = +$("nPart").value;
    $("nLabel").textContent = `N = M = ${n}`;
    katexInto($("fTex"), f.tex);
    // ---- Riemann midpoint picture
    const dispTop = isFinite(f.ymax) ? f.ymax : 6, dispLo = Math.min(0, f.ymin);
    const curve = []; for (let i = 0; i <= 600; i++) { const x = f.a + ((f.b - f.a) * (i + 0.001)) / 600; curve.push([x, Math.max(dispLo, Math.min(dispTop, f.f(x)))]); }
    const h = (f.b - f.a) / n, bars = [];
    for (let i = 0; i < n; i++) bars.push([f.a + i * h, f.a + (i + 1) * h, Math.max(dispLo, Math.min(dispTop, f.f(f.a + (i + 0.5) * h)))]);
    const yr = { yMin: dispLo, yMax: dispTop * 1.08 };
    plot($("cRiemann"), { xMin: f.a, xMax: f.b, ...yr, series: [{ type: "bars", color: css("--accent"), alpha: 0.45, bars }, { type: "line", color: css("--text"), width: 2, pts: curve }] });
    // ---- Lebesgue picture: lower simple function on each preimage, preimages sampled on a fine grid for drawing
    const top = isFinite(f.ymax) ? f.ymax : Math.pow(n, 2 / 3) + 1, d = (top - f.ymin) / n, K = 900, w = (f.b - f.a) / K;
    const slabs = Array.from({ length: n }, () => []), strip = [];
    for (let i = 0; i < K; i++) {
      const x = f.a + (i + 0.5) * w, y = f.f(x);
      let k = Math.floor((y - f.ymin) / d); if (k >= n) k = n - 1; if (k < 0) k = 0;
      slabs[k].push([f.a + i * w, f.a + (i + 1) * w, Math.min(dispTop, f.ymin + k * d)]);
      strip.push([f.a + i * w, f.a + (i + 1) * w, k]);
    }
    const levColor = (k) => `hsl(${(k * 360) / Math.max(n, 1) * 0.83 + 200}, 70%, 65%)`;
    const series = slabs.map((s, k) => ({ type: "bars", color: levColor(k), alpha: 0.55, gapless: true, bars: s.map(([a, b, v]) => [a, b, Math.max(dispLo, v)]) }));
    const sH = (dispTop - dispLo) * 0.05;
    for (let k = 0; k < n; k++) series.push({ type: "bars", color: levColor(k), alpha: 1, gapless: true, bars: strip.filter((s) => s[2] === k).map(([a, b]) => [a, b, dispLo - sH * 0.3, dispLo - sH * 1.4]) });
    series.push({ type: "line", color: css("--text"), width: 2, pts: curve });
    for (let k = 0; k <= n && f.ymin + k * d <= dispTop; k++) series.push({ type: "line", color: css("--border"), width: 1, pts: [[f.a, f.ymin + k * d], [f.b, f.ymin + k * d]] });
    plot($("cLebesgue"), { xMin: f.a, xMax: f.b, yMin: dispLo - sH * 1.5, yMax: dispTop * 1.08, series });
    // ---- table
    const rows = [];
    const add = (name, fn, evals) => {
      const v = fn(); let reps = 0; const t0 = performance.now();
      do { fn(); reps++; } while (performance.now() - t0 < 12 && reps < 100000);
      rows.push([name, v, evals, ((performance.now() - t0) / reps) * 1000]);
    };
    add("Riemann, left", () => Integ.riemann(f, n, "left"), `${n} f`);
    add("Riemann, midpoint", () => Integ.riemann(f, n, "mid"), `${n} f`);
    add("Trapezoid", () => Integ.riemann(f, n, "trap"), `${n + 1} f`);
    add("Simpson", () => Integ.riemann(f, n + (n % 2), "simp"), `${n + (n % 2) + 1} f`);
    if (f.ge) {
      const pre = f.id === "sinc" ? "60 f per measure (bisection)" : "inverse function";
      add("Lebesgue, lower", () => Integ.lebesgue(f, n, "lower"), `${n} measures · ${pre}`);
      add("Lebesgue, upper", () => Integ.lebesgue(f, n, "upper"), `${n} measures`);
      add("Lebesgue, mid-level", () => Integ.lebesgue(f, n, "mid"), `${n + 1} measures`);
    }
    add("Lebesgue, counted preimages (K = 2¹⁶)", () => Integ.lebesgueCount(f, n, 65536), "65 536 f + binning");
    $("exTable").innerHTML = `<thead><tr><th>method (N = M = ${n})</th><th>value</th><th>error</th><th>work</th><th>time</th></tr></thead><tbody>` +
      rows.map(([nm, v, ev, us]) => `<tr><td>${nm}</td><td class="mono">${sci(v)}</td><td class="mono">${sci(Math.abs(v - f.exact))}</td><td class="muted">${ev}</td><td class="mono">${us < 1000 ? us.toFixed(1) + " µs" : (us / 1000).toFixed(2) + " ms"}</td></tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">Exact value: ${f.exact.toPrecision(16)} · ${f.note}.</caption>`;
    drawConv();
  }

  function drawConv() {
    const f = F(), Ns = [], series = [], legend = [];
    for (let e = 1; e <= 16; e++) Ns.push(2 ** e);
    const methods = [
      ["Riemann left", (N) => Integ.riemann(f, N, "left")], ["Riemann midpoint", (N) => Integ.riemann(f, N, "mid")],
      ["Trapezoid", (N) => Integ.riemann(f, N, "trap")], ["Simpson", (N) => Integ.riemann(f, N, "simp")],
    ];
    if (f.ge) methods.push(["Lebesgue lower", (M) => Integ.lebesgue(f, M, "lower")], ["Lebesgue mid-level", (M) => Integ.lebesgue(f, M, "mid")]);
    methods.push(["Lebesgue counted (K = 2¹⁸)", (M) => Integ.lebesgueCount(f, Math.min(M, 4096), 262144)]);
    let lo = 1, hi = 1e-16;
    methods.forEach(([nm, fn], i) => {
      const pts = Ns.map((N) => [N, Math.abs(fn(N) - f.exact)]).filter(([, e]) => isFinite(e) && e > 1e-17);
      pts.forEach(([, e]) => { lo = Math.min(lo, e); hi = Math.max(hi, e); });
      const col = COLORS[i % COLORS.length], dash = nm.startsWith("Lebesgue") ? [6, 3] : null;
      if (!pts.length) return;
      series.push({ type: "line", color: col, width: 2, dash, pts }, { type: "dots", color: col, r: 2.5, pts });
      legend.push([nm, col, !!dash]);
    });
    lo = Math.max(lo / 3, 1e-17); hi = Math.min(hi * 3, 1e3);
    plot($("cConv"), { xLog: true, yLog: true, xMin: 2, xMax: 65536, yMin: lo, yMax: hi, series, legend, legendAt: "bl" });
  }

  function allTable() {
    const N = 1000;
    $("allTable").innerHTML = `<thead><tr><th>function</th><th>exact</th><th>Riemann midpoint</th><th>error</th><th>Simpson error</th><th>Lebesgue lower error</th><th>Lebesgue mid-level</th><th>error</th><th>counted (K = 2¹⁶) error</th></tr></thead><tbody>` +
      Integ.FUNCS.map((f) => {
        const mid = Integ.riemann(f, N, "mid"), si = Integ.riemann(f, N, "simp");
        const lo = f.ge ? Integ.lebesgue(f, N, "lower") : NaN, lm = f.ge ? Integ.lebesgue(f, N, "mid") : NaN, lc = Integ.lebesgueCount(f, N, 65536);
        const e = (v) => (f.ge || !isNaN(v) ? sci(Math.abs(v - f.exact)) : "—");
        return `<tr><td>${f.label}</td><td class="mono">${f.exact.toPrecision(10)}</td><td class="mono">${sci(mid)}</td><td class="mono">${sci(Math.abs(mid - f.exact))}</td><td class="mono">${sci(Math.abs(si - f.exact))}</td>` +
          `<td class="mono">${f.ge ? e(lo) : "—"}</td><td class="mono">${f.ge ? sci(lm) : "—"}</td><td class="mono">${f.ge ? e(lm) : "—"}</td><td class="mono">${sci(Math.abs(lc - f.exact))}</td></tr>`;
      }).join("") + `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">“—”: no closed-form preimage measure. Simpson on 1/√x and sin(1/x) evaluates f at 0, giving ∞ or NaN.</caption>`;
  }

  // ---- Dirichlet
  function dirichlet() {
    const N = clampInt($("dN").value, 1, 100000, 1000), eps = Math.min(1, Math.max(0.001, +$("dEps").value || 0.2));
    // tags k/N and (2k+1)/(2N) are rational, tags (k + 1/√2)/N are irrational: f is 1 resp. 0 on them
    const left = 1, mid = 1, irr = 0;
    const R = Integ.rationals(400);
    let total = 0; R.forEach((_, i) => { total += eps / 2 ** (i + 1); });
    $("dOut").innerHTML =
      `N = ${N} subintervals\n` +
      `Riemann sum, tags k/N (rational):            ${left}\n` +
      `Riemann sum, tags (2k+1)/(2N) (rational):    ${mid}\n` +
      `Riemann sum, tags (k + 1/√2)/N (irrational): ${irr}\n` +
      `Upper Darboux sum U = ${left},  lower Darboux sum L = ${irr}  →  U − L = 1 for every N: <span class="bad">not Riemann integrable</span>\n\n` +
      `Lebesgue: the first ${R.length} rationals are covered by intervals of total length ${total.toPrecision(6)} &lt; ε = ${eps}\n` +
      `μ(ℚ ∩ [0,1]) ≤ ε for every ε  ⇒  μ = 0  ⇒  <span class="ok">∫ f dμ = 1·0 + 0·1 = 0</span>`;
    const shown = R.slice(0, 40), series = [];
    shown.forEach(([p, q], i) => {
      const c = p / q, r = eps / 2 ** (i + 2);
      series.push({ type: "line", color: css("--accent"), width: 3, pts: [[Math.max(0, c - r), i + 1], [Math.min(1, c + r), i + 1]] });
    });
    series.push({ type: "dots", color: css("--gold"), r: 2.5, pts: shown.map(([p, q], i) => [p / q, i + 1]) });
    plot($("cCover"), { xMin: 0, xMax: 1, yMin: 0, yMax: 41, yTicks: [1, 10, 20, 30, 40], series });
  }

  // ---- Thomae
  function thomae() {
    const pts = [];
    for (let q = 1; q <= 40; q++) for (let p = 0; p <= q; p++) if (Integ.gcd(p, q) === 1) pts.push([p / q, 1 / q]);
    plot($("cThomae"), { xMin: 0, xMax: 1, yMin: 0, yMax: 1.05, series: [{ type: "dots", color: css("--accent"), r: 1.6, pts }] });
    const Ns = [4, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000], L = [], Mi = [], U = [];
    for (const N of Ns) { const s = Integ.thomaeSums(N); L.push([N, s.left]); Mi.push([N, s.mid]); U.push([N, s.upper]); }
    plot($("cThomaeSums"), { xLog: true, yLog: true, xMin: 4, xMax: 5000, yMin: 1e-5, yMax: 1,
      series: [{ type: "line", color: css("--red"), width: 2, pts: U }, { type: "dots", color: css("--red"), pts: U },
        { type: "line", color: css("--accent"), width: 2, pts: L }, { type: "dots", color: css("--accent"), pts: L },
        { type: "line", color: css("--green"), width: 2, pts: Mi }, { type: "dots", color: css("--green"), pts: Mi }],
      legend: [["upper Darboux sum", css("--red")], ["tags k/N", css("--accent")], ["tags (2k+1)/(2N)", css("--green")]], legendAt: "bl" });
  }

  // =====================================================================
  // Ex. 2
  // =====================================================================
  const REF = window.NORMAL_REF, GRID = REF.grid.map(([x, s]) => [x, Number(s)]);
  const refAt = (x) => { const g = GRID.find((p) => Math.abs(p[0] - x) < 1e-9) || REF.table.map(([a, s]) => [a, Number(s)]).find((p) => Math.abs(p[0] - x) < 1e-9); return g ? g[1] : null; };

  function evalX() {
    const x = +$("xIn").value || 0, ref = refAt(x), base = ref ?? Normal.hybrid(x);
    $("xTable").innerHTML = `<thead><tr><th>method</th><th>Φ(${x})</th><th>absolute error</th><th>relative error</th></tr></thead><tbody>` +
      Normal.METHODS.map((m) => { const v = m.fn(x); return `<tr><td>${m.name}</td><td class="mono">${v.toPrecision(17)}</td><td class="mono">${sci(Math.abs(v - base))}</td><td class="mono">${sci(Math.abs(v - base) / base)}</td></tr>`; }).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${ref !== null ? `Errors against the 50-digit reference value ${ref.toPrecision(17)}.` : "x is not in the reference table: errors are measured against the hybrid method. Try a multiple of 0.05 in [−10, 10] for an exact reference."}</caption>`;
  }

  function refTable() {
    const ztab = { 1: "0.8413", 2: "0.9772", 3: "0.9987" }, sc = Object.fromEntries(REF.scipy);
    $("refTable").innerHTML = `<thead><tr><th>x</th><th>reference Φ(x) (mpmath, 50 digits)</th><th>z-table</th><th>SciPy</th><th>hybrid (this page)</th><th>hybrid error</th><th>A&amp;S 26.2.17 error</th><th>Simpson error</th></tr></thead><tbody>` +
      REF.table.map(([x, s]) => {
        const r = Number(s), h = Normal.hybrid(x);
        return `<tr><td class="mono">${x}</td><td class="mono">${s}</td><td class="mono">${ztab[x] || ""}</td><td class="mono">${sc[x].toPrecision(16)}</td><td class="mono">${h.toPrecision(16)}</td>` +
          `<td class="mono">${sci(Math.abs(h - r))}</td><td class="mono">${sci(Math.abs(Normal.as26217(x) - r))}</td><td class="mono">${sci(Math.abs(Normal.simpson(x, 100) - r))}</td></tr>`;
      }).join("") + "</tbody>";
  }

  function accuracy() {
    const absSeries = [], relSeries = [], legend = [];
    const stats = Normal.METHODS.map((m, i) => {
      let mabs = 0, mrel = 0; const pa = [], pr = [];
      for (const [x, r] of GRID) {
        const v = m.fn(x), a = Math.abs(v - r);
        mabs = isFinite(a) ? Math.max(mabs, a) : Infinity;
        pa.push([x, Math.max(1e-18, Math.min(1e5, isFinite(a) ? a : 1e5))]);
        if (x <= 0) { const rel = a / r; mrel = isFinite(rel) ? Math.max(mrel, rel) : Infinity; pr.push([x, Math.max(1e-17, Math.min(1e5, isFinite(rel) ? rel : 1e5))]); }
      }
      absSeries.push({ type: "line", color: COLORS[i], width: 1.6, pts: pa });
      relSeries.push({ type: "line", color: COLORS[i], width: 1.6, pts: pr });
      legend.push([m.name, COLORS[i]]);
      return { m, mabs, mrel };
    });
    plot($("cAbs"), { xMin: -10, xMax: 10, yLog: true, yMin: 1e-18, yMax: 1e5, series: absSeries });
    plot($("cRel"), { xMin: -10, xMax: 0, yLog: true, yMin: 1e-17, yMax: 1e5, series: relSeries });
    // quadrature convergence
    const ns = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024], r196 = 0.9750021048517795637871763;
    const tr = ns.map((n) => [n, Math.abs(Normal.trapezoid(1.96, n) - r196)]), si = ns.map((n) => [n, Math.max(1e-17, Math.abs(Normal.simpson(1.96, n) - r196))]);
    plot($("cQuad"), { xLog: true, yLog: true, xMin: 2, xMax: 1024, yMin: 1e-17, yMax: 1,
      series: [{ type: "line", color: COLORS[0], width: 2, pts: tr }, { type: "dots", color: COLORS[0], pts: tr }, { type: "line", color: COLORS[1], width: 2, pts: si }, { type: "dots", color: COLORS[1], pts: si },
        { type: "line", color: css("--muted"), dash: [4, 3], pts: ns.map((n) => [n, tr[0][1] * (2 / n) ** 2]) }, { type: "line", color: css("--muted"), dash: [4, 3], pts: ns.map((n) => [n, si[0][1] * (2 / n) ** 4]) }],
      legend: [["Trapezoid", COLORS[0]], ["Simpson", COLORS[1]], ["slopes −2, −4", css("--muted"), true]], legendAt: "bl" });
    // timing
    const xs = Array.from({ length: 1000 }, (_, i) => -8 + (16 * i) / 999);
    const times = Normal.METHODS.map((m) => { m.fn(1); const t = timeIt((i) => m.fn(xs[i % 1000]), 200000); return t.ms * 1e6; });
    drawTimes(times);
    $("sumTable").innerHTML = `<thead><tr><th>method</th><th>type</th><th>max absolute error on [−10, 10]</th><th>max relative error of Φ(x), x ∈ [−10, 0]</th><th>time / evaluation</th></tr></thead><tbody>` +
      stats.map(({ m, mabs, mrel }, i) => `<tr><td><span class="swatch" style="background:${COLORS[i]}"></span>${m.name}</td><td>${m.kind}</td><td class="mono">${sci(mabs)}</td><td class="mono">${sci(mrel)}</td><td class="mono">${times[i].toFixed(0)} ns</td></tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">Errors measured at the 401 points x = −10, −9.95, …, 10 against the 50-digit reference.</caption>`;
  }
  function drawTimes(times) {
    const cv = $("cTime"), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h); ctx.font = "11px ui-monospace, Consolas, monospace";
    const l = 190, r = 60, n = times.length, bh = (h - 20) / n;
    const lmin = 1, lmax = Math.log10(Math.max(...times) * 3), X = (v) => l + ((Math.log10(Math.max(v, 10)) - lmin) / (lmax - lmin)) * (w - l - r);
    times.forEach((t, i) => {
      const y = 10 + i * bh;
      ctx.fillStyle = css("--muted"); ctx.textAlign = "right"; ctx.fillText(Normal.METHODS[i].name, l - 8, y + bh / 2 + 4);
      ctx.fillStyle = COLORS[i]; ctx.fillRect(l, y + 3, X(t) - l, bh - 6);
      ctx.fillStyle = css("--text"); ctx.textAlign = "left"; ctx.fillText(`${t.toFixed(0)} ns`, X(t) + 6, y + bh / 2 + 4);
    });
  }

  // =====================================================================
  function katexInto(el, tex) { if (window.katex) katex.render(tex, el, { displayMode: true, throwOnError: false }); else el.textContent = tex; }

  async function init() {
    if (window.renderMathInElement) renderMathInElement(document.body, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false });
    $("fSel").innerHTML = Integ.FUNCS.map((f, i) => `<option value="${i}">${f.label}</option>`).join("");
    $("fSel").addEventListener("change", drawExplorer);
    $("nPart").addEventListener("input", drawExplorer);
    $("dRun").addEventListener("click", dirichlet);
    $("xRun").addEventListener("click", evalX);
    $("xIn").addEventListener("change", evalX);
    drawExplorer(); await tick(); allTable(); dirichlet(); thomae(); evalX(); refTable(); await tick(); accuracy();
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawExplorer(); thomae(); dirichlet(); }, 300); });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
