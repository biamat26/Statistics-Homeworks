(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(+v || d)));
  const fmt = (v, d = 3) => (!isFinite(v) ? String(v) : Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(d));
  const card = (l, v, h = "") => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div>${h ? `<div class="hint">${h}</div>` : ""}</div>`;

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
        for (const [a, b, v] of s.bars) ctx.fillRect(X(a) + 0.5, Y(v), Math.max(X(b) - X(a) - 1, 0.8), Y(o.yLog ? o.yMin : 0) - Y(v));
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

  // ---------------------------------------------------------------------
  // Welford (Ex. 1)
  // ---------------------------------------------------------------------
  function welfordSteps(xs) {
    let k = 0, M = 0, SS = 0;
    return xs.map((x) => {
      k += 1;
      const d = x - M;
      M += d / k;
      SS += d * (x - M);
      return { k, x, d, M, SS, s2: k > 1 ? SS / (k - 1) : NaN, pop: SS / k };
    });
  }

  function runWelford() {
    const xs = $("wData").value.split(/[\s,;]+/).filter(Boolean).map(Number).filter((v) => isFinite(v));
    if (!xs.length) { $("wTable").innerHTML = ""; return; }
    const st = welfordSteps(xs);
    const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n, ss = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
    $("wTable").innerHTML = `<thead><tr><th>k</th><th>x<sub>k</sub></th><th>δ = x<sub>k</sub> − M<sub>k−1</sub></th><th>M<sub>k</sub> = M<sub>k−1</sub> + δ/k</th><th>SS<sub>k</sub> = SS<sub>k−1</sub> + δ(x<sub>k</sub> − M<sub>k</sub>)</th><th>s<sub>k</sub>² = SS<sub>k</sub>/(k−1)</th></tr></thead><tbody>` +
      st.map((r) => `<tr><td class="mono">${r.k}</td><td class="mono">${fmt(r.x, 4)}</td><td class="mono">${fmt(r.d, 4)}</td><td class="mono">${fmt(r.M, 4)}</td><td class="mono">${fmt(r.SS, 4)}</td><td class="mono">${isNaN(r.s2) ? "—" : fmt(r.s2, 4)}</td></tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">Check with the two-pass definition: mean = ${fmt(mean, 4)}, SS = ${fmt(ss, 4)}, s² = ${n > 1 ? fmt(ss / (n - 1), 4) : "—"}.</caption>`;
  }

  function runStability() {
    const off = Number($("offset").value), base = [4, 7, 13, 16], xs = base.map((v) => v + off), n = xs.length;
    let s = 0, q = 0; for (const x of xs) { s += x; q += x * x; }
    const naive = (q - (s * s) / n) / (n - 1);
    const mean = s / n, twoPass = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
    const w = welfordSteps(xs).pop().s2;
    const row = (name, v, note) => `<tr><td>${name}</td><td class="mono ${Math.abs(v - 30) < 1e-6 ? "good" : "bad"}">${fmt(v, 6)}</td><td class="mono">${v === 30 ? "0" : Math.abs(v - 30).toExponential(2)}</td><td class="muted">${note}</td></tr>`;
    $("stabTable").innerHTML = `<thead><tr><th>method</th><th>s² (exact: 30)</th><th>absolute error</th><th></th></tr></thead><tbody>` +
      row("One-pass textbook formula (Σx² − (Σx)²/k)/(k − 1)", naive, `Σx² ≈ ${q.toExponential(3)}: the digits that matter are lost`) +
      row("Two-pass (mean first, then deviations)", twoPass, "accurate, but needs the data twice") +
      row("Welford's recurrence", w, "accurate, one pass, no storage") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">Data: ${xs.map((v) => (off ? `${$("offset").selectedOptions[0].text} + ${v - off}` : v)).join(", ")} (double-precision floating point).</caption>`;
  }

  // ---------------------------------------------------------------------
  // Score distributions on [0, 10] (Ex. 2)
  // ---------------------------------------------------------------------
  function discrete(name, label, pmf) {
    const cdf = []; let c = 0; for (const p of pmf) { c += p; cdf.push(c); }
    const mu = pmf.reduce((a, p, i) => a + p * i, 0);
    const cm = (r) => pmf.reduce((a, p, i) => a + p * (i - mu) ** r, 0);
    return {
      name, label, discrete: true, pmf, mu, var: cm(2), mu4: cm(4),
      sample() { const u = Math.random(); let i = 0; while (i < 10 && u >= cdf[i]) i++; return i; },
    };
  }
  function betaScaled(a, b) { // 10 · Beta(a, b) with integer a, b
    const raw = (k) => { let v = 1; for (let r = 0; r < k; r++) v *= (a + r) / (a + b + r); return v * 10 ** k; };
    const E1 = raw(1), E2 = raw(2), E3 = raw(3), E4 = raw(4);
    const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const gamma = (k) => { let p = 1; for (let i = 0; i < k; i++) p *= Math.random(); return -Math.log(p); }; // sum of k Exp(1)
    return {
      name: "beta", label: `10 · Beta(${a}, ${b})`, discrete: false,
      pdf: (x) => (x <= 0 || x >= 10 ? 0 : Math.exp((a - 1) * Math.log(x / 10) + (b - 1) * Math.log(1 - x / 10) - lnB) / 10),
      mu: E1, var: E2 - E1 * E1, mu4: E4 - 4 * E1 * E3 + 6 * E1 * E1 * E2 - 3 * E1 ** 4,
      sample() { const g1 = gamma(a), g2 = gamma(b); return (10 * g1) / (g1 + g2); },
    };
  }
  function lnGamma(z) { let s = 0; for (let i = 2; i < z; i++) s += Math.log(i); return s; } // integer z only
  const binomPmf = (n, p) => Array.from({ length: n + 1 }, (_, k) => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; return c * p ** k * (1 - p) ** (n - k); });

  const DISTS = {
    beta: betaScaled(2, 5),
    unif: discrete("unif", "Uniform{0, …, 10}", new Array(11).fill(1 / 11)),
    binom: discrete("binom", "Binomial(10, 0.3)", binomPmf(10, 0.3)),
    bimodal: discrete("bimodal", "Bimodal", [0.30, 0.22, 0.14, 0.08, 0.04, 0.02, 0.02, 0.03, 0.05, 0.06, 0.04]),
  };
  const D = () => DISTS[$("dist").value];
  const varS2 = (d, n) => d.mu4 / n - (d.var ** 2 * (n - 3)) / (n * (n - 1));

  function showDist() {
    const d = D();
    if (d.discrete) {
      plot($("cDist"), { xMin: -0.5, xMax: 10.5, yMin: 0, yMax: Math.max(...d.pmf) * 1.15, xTicks: [0, 2, 4, 6, 8, 10],
        series: [{ type: "bars", color: css("--accent"), bars: d.pmf.map((p, i) => [i - 0.4, i + 0.4, p]) },
          { type: "line", color: css("--gold"), dash: [5, 4], pts: [[d.mu, 0], [d.mu, Math.max(...d.pmf) * 1.15]] }] });
      $("distCap").innerHTML = `Probability mass function of a score. Dashed: μ.`;
    } else {
      const pts = []; for (let t = 0; t <= 300; t++) { const x = (10 * t) / 300; pts.push([x, d.pdf(x)]); }
      const ym = Math.max(...pts.map((p) => p[1])) * 1.15;
      plot($("cDist"), { xMin: 0, xMax: 10, yMin: 0, yMax: ym, series: [{ type: "line", color: css("--accent"), width: 2.5, pts }, { type: "line", color: css("--gold"), dash: [5, 4], pts: [[d.mu, 0], [d.mu, ym]] }] });
      $("distCap").innerHTML = `Probability density of a score: f(x) = 30·(x/10)(1 − x/10)⁴/10. Dashed: μ.`;
    }
    $("distInfo").innerHTML = card("μ", fmt(d.mu, 4)) + card("σ²", fmt(d.var, 4)) + card("σ", fmt(Math.sqrt(d.var), 4)) +
      card("μ₄ = E[(X−μ)⁴]", fmt(d.mu4, 3), `kurtosis μ₄/σ⁴ = ${(d.mu4 / d.var ** 2).toFixed(2)}`);
  }

  // m hackers × n systems; Welford for every hacker
  function experiment(d, m, n, keep = 0, nTraj = n) {
    const means = new Float64Array(m), vars = new Float64Array(m), traj = [];
    for (let j = 0; j < m; j++) {
      const len = j < keep ? Math.max(n, nTraj) : n;
      let k = 0, M = 0, SS = 0, mN = 0, vN = 0;
      const tm = j < keep ? [] : null, tv = j < keep ? [] : null;
      for (let i = 0; i < len; i++) {
        const x = d.sample();
        k += 1; const delta = x - M; M += delta / k; SS += delta * (x - M); // Welford
        if (k === n) { mN = M; vN = SS / (n - 1); }
        if (tm) { tm.push([k, M]); if (k > 1) tv.push([k, SS / (k - 1)]); }
      }
      means[j] = mN; vars[j] = vN;
      if (tm) traj.push({ tm, tv });
    }
    return { means, vars, traj };
  }
  const meanOf = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };
  const varOf = (a) => { const mu = meanOf(a); let s = 0; for (const v of a) s += (v - mu) ** 2; return s / (a.length - 1); };

  function hist(a, lo, hi, bins, lattice) {
    let w = (hi - lo) / bins;
    if (lattice) { w = Math.max(1, Math.round(w / lattice)) * lattice; lo = Math.floor(lo / lattice) * lattice - lattice / 2; bins = Math.ceil((hi - lo) / w); }
    const c = new Array(bins).fill(0);
    for (const v of a) { const b = Math.floor((v - lo) / w); if (b >= 0 && b < bins) c[b]++; }
    return c.map((k, b) => [lo + b * w, lo + (b + 1) * w, k / (a.length * w)]);
  }

  async function runOne() {
    $("run").disabled = true; await tick();
    const d = D(), m = clampInt($("m").value, 10, 100000, 5000), n = clampInt($("n").value, 2, 10000, 20);
    const mm = Math.min(m, Math.floor(3e7 / n)); $("m").value = mm; $("n").value = n;
    const R = experiment(d, mm, n, 25, Math.max(n, 200));
    const aM = meanOf(R.means), aV = meanOf(R.vars), aB = aV * (n - 1) / n;
    const vM = varOf(R.means), vV = varOf(R.vars), tVV = varS2(d, n);
    const seM = Math.sqrt(d.var / n / mm), seV = Math.sqrt(tVV / mm);
    const z = (obs, th, se) => `${((obs - th) / se).toFixed(2)}`;
    $("resTable").innerHTML = `<thead><tr><th>quantity (m = ${mm} hackers, n = ${n} systems)</th><th>simulated</th><th>theory</th><th>difference / standard error</th></tr></thead><tbody>` +
      `<tr><td>average of the sampling means X̄</td><td class="mono">${fmt(aM, 4)}</td><td class="mono">μ = ${fmt(d.mu, 4)}</td><td class="mono">${z(aM, d.mu, seM)}</td></tr>` +
      `<tr><td>average of the sampling variances S² (÷ n−1)</td><td class="mono">${fmt(aV, 4)}</td><td class="mono">σ² = ${fmt(d.var, 4)}</td><td class="mono">${z(aV, d.var, seV)}</td></tr>` +
      `<tr><td>average of SS/n (÷ n, biased)</td><td class="mono">${fmt(aB, 4)}</td><td class="mono">σ²(n−1)/n = ${fmt(d.var * (n - 1) / n, 4)}</td><td class="mono">${z(aB, d.var * (n - 1) / n, seV * (n - 1) / n)}</td></tr>` +
      `<tr><td>variance of X̄ across hackers</td><td class="mono">${fmt(vM, 5)}</td><td class="mono">σ²/n = ${fmt(d.var / n, 5)}</td><td class="muted">ratio ${(vM / (d.var / n)).toFixed(3)}</td></tr>` +
      `<tr><td>variance of S² across hackers</td><td class="mono">${fmt(vV, 5)}</td><td class="mono">${fmt(tVV, 5)}</td><td class="muted">ratio ${(vV / tVV).toFixed(3)}</td></tr>` +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${d.label}. The last column is (simulated − theory)/standard error of the average over m hackers: values within about ±2 mean agreement.</caption>`;
    // histograms
    const sdM = Math.sqrt(d.var / n);
    const H1 = hist(R.means, d.mu - 4.5 * sdM, d.mu + 4.5 * sdM, 40, d.discrete ? 1 / n : 0);
    const nm = []; for (let t = 0; t <= 200; t++) { const x = d.mu - 4.5 * sdM + (9 * sdM * t) / 200; nm.push([x, Math.exp(-0.5 * ((x - d.mu) / sdM) ** 2) / (sdM * Math.sqrt(2 * Math.PI))]); }
    const y1 = Math.max(...H1.map((b) => b[2]), ...nm.map((p) => p[1])) * 1.12;
    plot($("hMean"), { xMin: d.mu - 4.5 * sdM, xMax: d.mu + 4.5 * sdM, yMin: 0, yMax: y1,
      series: [{ type: "bars", color: css("--accent"), alpha: 0.8, bars: H1 }, { type: "line", color: css("--red"), width: 2, pts: nm }, { type: "line", color: css("--gold"), dash: [5, 4], pts: [[d.mu, 0], [d.mu, y1]] }] });
    const sorted = Float64Array.from(R.vars).sort(), hiV = Math.max(sorted[Math.floor(0.995 * (sorted.length - 1))], d.var + 3 * Math.sqrt(tVV));
    const H2 = hist(R.vars, 0, hiV, 45, 0), sdV = Math.sqrt(tVV);
    const nv = []; for (let t = 0; t <= 200; t++) { const x = (hiV * t) / 200; nv.push([x, Math.exp(-0.5 * ((x - d.var) / sdV) ** 2) / (sdV * Math.sqrt(2 * Math.PI))]); }
    const y2 = Math.max(...H2.map((b) => b[2]), ...nv.map((p) => p[1])) * 1.12;
    plot($("hVar"), { xMin: 0, xMax: hiV, yMin: 0, yMax: y2,
      series: [{ type: "bars", color: css("--purple"), alpha: 0.8, bars: H2 }, { type: "line", color: css("--muted"), width: 1.5, pts: nv },
        { type: "line", color: css("--gold"), dash: [5, 4], pts: [[d.var, 0], [d.var, y2]] }, { type: "line", color: css("--red"), dash: [3, 3], pts: [[aB, 0], [aB, y2]] }] });
    // running estimates
    const K = Math.max(n, 200), sd = Math.sqrt(d.var);
    const band = (sgn) => Array.from({ length: K }, (_, i) => [i + 1, d.mu + (sgn * 2 * sd) / Math.sqrt(i + 1)]);
    plot($("cTrajM"), { xMin: 1, xMax: K, yMin: 0, yMax: 10,
      series: [...R.traj.map((t) => ({ type: "line", color: css("--accent"), alpha: 0.4, width: 1, pts: t.tm })),
        { type: "line", color: css("--red"), dash: [5, 4], pts: band(1) }, { type: "line", color: css("--red"), dash: [5, 4], pts: band(-1) },
        { type: "line", color: css("--gold"), width: 1.5, pts: [[1, d.mu], [K, d.mu]] }] });
    const vmax = Math.min(4 * d.var, Math.max(...R.traj.flatMap((t) => t.tv.map((p) => p[1])))) * 1.05;
    plot($("cTrajV"), { xMin: 1, xMax: K, yMin: 0, yMax: Math.max(vmax, d.var * 1.5),
      series: [...R.traj.map((t) => ({ type: "line", color: css("--purple"), alpha: 0.4, width: 1, pts: t.tv })),
        { type: "line", color: css("--gold"), width: 1.5, dash: [5, 4], pts: [[1, d.var], [K, d.var]] }] });
    $("run").disabled = false;
  }

  const NS = [2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
  async function runN() {
    $("runN").disabled = true;
    const d = D(), m = clampInt($("m2").value, 100, 20000, 5000); $("m2").value = m;
    const rows = [];
    for (const n of NS) {
      $("prog").textContent = `n = ${n}…`; await tick();
      const R = experiment(d, m, n);
      const aV = meanOf(R.vars);
      rows.push({ n, aM: meanOf(R.means), aV, aB: aV * (n - 1) / n, vM: varOf(R.means), vV: varOf(R.vars) });
    }
    const ymax = d.var * 1.25;
    plot($("cBias"), { xLog: true, xMin: 2, xMax: 1000, yMin: 0, yMax: ymax, xTicks: [2, 10, 100, 1000],
      series: [
        { type: "line", color: css("--gold"), dash: [5, 4], pts: [[2, d.var], [1000, d.var]] },
        { type: "line", color: css("--muted"), dash: [2, 3], pts: NS.map((n) => [n, d.var * (n - 1) / n]) },
        { type: "line", color: css("--accent"), width: 2, pts: rows.map((r) => [r.n, r.aV]) }, { type: "dots", color: css("--accent"), pts: rows.map((r) => [r.n, r.aV]) },
        { type: "line", color: css("--red"), width: 2, pts: rows.map((r) => [r.n, r.aB]) }, { type: "dots", color: css("--red"), pts: rows.map((r) => [r.n, r.aB]) },
      ],
      legend: [["mean of S² = SS/(n−1)", css("--accent")], ["mean of SS/n", css("--red")], ["σ²", css("--gold"), true], ["σ²(n−1)/n", css("--muted"), true]], legendAt: "mr" });
    const lo = Math.min(...rows.map((r) => Math.min(r.vM, r.vV))) / 2, hi = Math.max(...rows.map((r) => Math.max(r.vM, r.vV))) * 2;
    plot($("cVarN"), { xLog: true, yLog: true, xMin: 2, xMax: 1000, yMin: lo, yMax: hi, xTicks: [10, 100, 1000],
      series: [
        { type: "line", color: css("--accent"), dash: [5, 4], pts: NS.map((n) => [n, d.var / n]) },
        { type: "line", color: css("--purple"), dash: [5, 4], pts: NS.map((n) => [n, varS2(d, n)]) },
        { type: "dots", color: css("--accent"), pts: rows.map((r) => [r.n, r.vM]) },
        { type: "dots", color: css("--purple"), pts: rows.map((r) => [r.n, r.vV]) },
      ],
      legend: [["Var(X̄) across hackers", css("--accent")], ["Var(S²) across hackers", css("--purple")], ["theory", css("--muted"), true]], legendAt: "bl" });
    $("nTable").innerHTML = `<thead><tr><th>n</th><th>avg X̄</th><th>avg S²</th><th>avg SS/n</th><th>Var(X̄)</th><th>σ²/n</th><th>Var(S²)</th><th>theory</th><th>sd of X̄</th><th>sd of S²</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td class="mono">${r.n}</td><td class="mono">${fmt(r.aM, 3)}</td><td class="mono">${fmt(r.aV, 3)}</td><td class="mono">${fmt(r.aB, 3)}</td><td class="mono">${fmt(r.vM, 4)}</td><td class="mono">${fmt(d.var / r.n, 4)}</td><td class="mono">${fmt(r.vV, 4)}</td><td class="mono">${fmt(varS2(d, r.n), 4)}</td><td class="mono">${fmt(Math.sqrt(r.vM), 3)}</td><td class="mono">${fmt(Math.sqrt(r.vV), 3)}</td></tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${d.label}: μ = ${fmt(d.mu, 4)}, σ² = ${fmt(d.var, 4)}; m = ${m} hackers for every n.</caption>`;
    $("prog").textContent = "Done.";
    $("runN").disabled = false;
  }

  // ---------------------------------------------------------------------
  async function init() {
    if (window.renderMathInElement) {
      renderMathInElement(document.body, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false });
    }
    $("wRun").addEventListener("click", runWelford);
    $("wData").addEventListener("change", runWelford);
    $("offset").addEventListener("change", runStability);
    $("dist").addEventListener("change", async () => { showDist(); await runOne(); await runN(); });
    $("run").addEventListener("click", runOne);
    $("runN").addEventListener("click", runN);
    runWelford(); runStability(); showDist();
    await runOne(); await runN();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
