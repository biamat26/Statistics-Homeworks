(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(+v || d)));
  const fmt = (v, d = 3) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d));
  const readModel = (sel, pin) => Sim.model($(sel).value, Math.min(0.99, Math.max(0.01, +$(pin).value || 0.3)));

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

  // Exact pmf of S_n (lattice values) for both models
  function pmfS(M, n, s) {
    if (M.name === "bern") return Sim.binomPmf(n, M.p, s);
    if ((s + n) % 2 !== 0) return 0;
    return Sim.binomPmf(n, 0.5, (s + n) / 2);
  }

  /* Histogram of c·S over the attackers, with bins aligned to the lattice of S
     (step 1 for Bernoulli, 2 for Rademacher). Returns bars in c·S units and the exact density. */
  function latticeHist(M, n, S, c, maxBins = 45) {
    const step = M.name === "bern" ? 1 : 2;
    const mu = n * M.mu, sd = Math.sqrt(n * M.var);
    let [lo, hi] = range(S);
    lo = Math.min(lo, Math.floor(mu - 4 * sd)); hi = Math.max(hi, Math.ceil(mu + 4 * sd));
    lo = Math.max(lo, M.name === "bern" ? 0 : -n); hi = Math.min(hi, n);
    if (M.name !== "bern") { if ((lo + n) % 2) lo--; }
    const g = Math.max(1, Math.ceil((hi - lo + step) / step / maxBins)), W = step * g;
    const start = lo - step / 2, bins = Math.ceil((hi - lo + step) / W);
    const cnt = new Array(bins).fill(0), ex = new Array(bins).fill(0);
    for (const v of S) { const b = Math.floor((v - start) / W); if (b >= 0 && b < bins) cnt[b]++; }
    for (let s = lo; s <= hi; s += step) { const b = Math.floor((s - start) / W); if (b >= 0 && b < bins) ex[b] += pmfS(M, n, s); }
    const bars = cnt.map((k, b) => [(start + b * W) * c, (start + (b + 1) * W) * c, k / (S.length * W * c)]);
    const exact = ex.map((p, b) => [(start + (b + 0.5) * W) * c, p / (W * c)]);
    return { bars, exact, lo: start * c, hi: (start + bins * W) * c };
  }

  // ---------------------------------------------------------------------
  // 3. Trajectories
  // ---------------------------------------------------------------------
  function runTraj() {
    const M = readModel("tModel", "tP");
    const n = clampInt($("tN").value, 10, 100000, 1000), m = clampInt($("tM").value, 10, 20000, 2000);
    const P = clampInt($("tPaths").value, 1, 200, 40);
    const mm = Math.min(m, Math.floor(5e7 / n)); // keep the run below ~0.5 s
    $("tN").value = n; $("tM").value = mm;
    const r = Sim.simulate(M, n, mm, { checkpoints: [n], keepPaths: Math.min(P, mm) });
    const sd = Math.sqrt(M.var), col = css("--accent"), band = css("--red");
    const views = [
      ["cS", (k, S) => S, (k) => [k * M.mu - 2 * sd * Math.sqrt(k), k * M.mu, k * M.mu + 2 * sd * Math.sqrt(k)]],
      ["cAvg", (k, S) => S / k, (k) => [M.mu - 2 * sd / Math.sqrt(k), M.mu, M.mu + 2 * sd / Math.sqrt(k)]],
      ["cNorm", (k, S) => S / Math.sqrt(k), (k) => [M.mu * Math.sqrt(k) - 2 * sd, M.mu * Math.sqrt(k), M.mu * Math.sqrt(k) + 2 * sd]],
    ];
    for (const [id, f, b] of views) {
      const series = r.paths.map((p) => ({ type: "line", color: col, alpha: 0.35, width: 1, pts: Array.from(p.k, (k, i) => [k, f(k, p.S[i])]) }));
      let lo = Infinity, hi = -Infinity;
      for (const s of series) for (const [, y] of s.pts) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      const grid = r.paths[0].k;
      const bandPts = [0, 1, 2].map((q) => grid.map((k) => [k, b(k)[q]]));
      for (const [k] of [[grid[grid.length - 1]]]) { const v = b(k); lo = Math.min(lo, v[0]); hi = Math.max(hi, v[2]); }
      const pad = (hi - lo) * 0.06 || 1;
      series.push({ type: "line", color: band, dash: [5, 4], pts: bandPts[0] }, { type: "line", color: css("--gold"), width: 1.5, pts: bandPts[1] }, { type: "line", color: band, dash: [5, 4], pts: bandPts[2] });
      plot($(id), { xMin: 0, xMax: n, yMin: lo - pad, yMax: hi + pad, series });
    }
    // histograms at k = n
    const S = r.at.get(n), mu = M.mu, v = M.var;
    const hists = [["hS", 1], ["hAvg", 1 / n], ["hNorm", 1 / Math.sqrt(n)]];
    hists.forEach(([id, c], i) => {
      const H = latticeHist(M, n, S, c);
      const ymax = Math.max(...H.bars.map((b) => b[2]), ...H.exact.map((e) => e[1])) * 1.15;
      const series = [{ type: "bars", color: css("--accent"), alpha: 0.75, bars: H.bars }];
      if (i === 0) series.push({ type: "line", color: css("--red"), width: 2, pts: H.exact });
      else {
        const m0 = i === 1 ? mu : mu * Math.sqrt(n), s0 = i === 1 ? Math.sqrt(v / n) : Math.sqrt(v);
        const pts = []; for (let t = 0; t <= 200; t++) { const x = H.lo + ((H.hi - H.lo) * t) / 200; pts.push([x, Sim.phi((x - m0) / s0) / s0]); }
        series.push({ type: "line", color: css("--red"), width: 2, pts });
      }
      plot($(id), { xMin: H.lo, xMax: H.hi, yMin: 0, yMax: ymax, series });
    });
    const rows = [
      ["S<sub>n</sub>", S, n * mu, n * v],
      ["S<sub>n</sub>/n", Sim.scale(S, 1 / n), mu, v / n],
      ["S<sub>n</sub>/√n", Sim.scale(S, 1 / Math.sqrt(n)), mu * Math.sqrt(n), v],
    ];
    $("tStats").innerHTML = `<thead><tr><th>quantity (n = ${n}, m = ${mm})</th><th>sample mean</th><th>theory</th><th>sample variance</th><th>theory</th></tr></thead><tbody>` +
      rows.map(([nm, a, tm, tv]) => `<tr><td>${nm}</td><td class="mono">${fmt(Sim.mean(a))}</td><td class="mono">${fmt(tm)}</td><td class="mono">${fmt(Sim.variance(a))}</td><td class="mono">${fmt(tv)}</td></tr>`).join("") + "</tbody>" +
      `<caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${M.label}: μ = ${fmt(mu)}, σ² = ${fmt(v)}. Sample statistics over the m attackers at k = n.</caption>`;
  }

  // ---------------------------------------------------------------------
  // 4. Increasing n
  // ---------------------------------------------------------------------
  const ladder = (max) => { const out = []; for (let e = 1; e <= max; e *= 10) for (const f of [1, 2, 5]) if (e * f <= max) out.push(e * f); return out; };

  async function runGrowing() {
    $("gRun").disabled = true; await tick();
    const M = readModel("gModel", "gP"), nmax = +$("gN").value;
    const m = Math.min(clampInt($("gM").value, 100, 10000, 2000), Math.floor(2e8 / nmax)); $("gM").value = m;
    const eps = Math.max(0.005, +$("gEps").value || 0.05);
    const ns = ladder(nmax);
    const r = Sim.simulate(M, nmax, m, { checkpoints: ns });
    const sd = Math.sqrt(M.var);
    const rows = ns.map((n) => {
      const S = r.at.get(n), avg = Sim.scale(S, 1 / n);
      let out = 0; for (const a of avg) if (Math.abs(a - M.mu) > eps) out++;
      return { n, vS: Sim.variance(S), vA: Sim.variance(avg), vN: Sim.variance(S) / n, p: out / m,
        cheb: Math.min(1, M.var / (n * eps * eps)), clt: 2 * (1 - Sim.Phi((eps * Math.sqrt(n)) / sd)), mA: Sim.mean(avg) };
    });
    const c1 = css("--accent"), c2 = css("--green"), c3 = css("--orange");
    const vmin = Math.min(...rows.map((r) => r.vA)) / 3, vmax = Math.max(...rows.map((r) => r.vS)) * 3;
    plot($("cVar"), {
      xLog: true, yLog: true, xMin: 1, xMax: nmax, yMin: vmin, yMax: vmax,
      series: [
        { type: "line", color: c1, dash: [5, 4], pts: rows.map((r) => [r.n, r.n * M.var]) },
        { type: "line", color: c2, dash: [5, 4], pts: rows.map((r) => [r.n, M.var]) },
        { type: "line", color: c3, dash: [5, 4], pts: rows.map((r) => [r.n, M.var / r.n]) },
        { type: "dots", color: c1, pts: rows.map((r) => [r.n, r.vS]) },
        { type: "dots", color: c2, pts: rows.map((r) => [r.n, r.vN]) },
        { type: "dots", color: c3, pts: rows.map((r) => [r.n, r.vA]) },
      ],
      legend: [["Var(Sn) = nσ²", c1], ["Var(Sn/√n) = σ²", c2], ["Var(Sn/n) = σ²/n", c3]],
    });
    plot($("cLLN"), {
      xLog: true, xMin: 1, xMax: nmax, yMin: 0, yMax: 1.05, yTicks: [0, 0.25, 0.5, 0.75, 1],
      series: [
        { type: "line", color: css("--red"), dash: [5, 4], pts: rows.map((r) => [r.n, r.cheb]) },
        { type: "line", color: css("--gold"), dash: [2, 3], pts: rows.map((r) => [r.n, r.clt]) },
        { type: "line", color: c1, width: 2, pts: rows.map((r) => [r.n, r.p]) },
        { type: "dots", color: c1, pts: rows.map((r) => [r.n, r.p]) },
      ],
      legend: [[`P(|Sn/n − μ| > ${eps}) simulated`, c1], ["Chebyshev bound", css("--red"), true], ["CLT approximation", css("--gold"), true]], legendAt: "bl",
    });
    $("gTable").innerHTML = `<thead><tr><th>n</th><th>mean S<sub>n</sub>/n</th><th>Var S<sub>n</sub></th><th>Var S<sub>n</sub>/√n</th><th>Var S<sub>n</sub>/n</th><th>P(|S<sub>n</sub>/n − μ| &gt; ε)</th><th>Chebyshev</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td class="mono">${r.n}</td><td class="mono">${fmt(r.mA, 4)}</td><td class="mono">${fmt(r.vS)}</td><td class="mono">${fmt(r.vN)}</td><td class="mono">${fmt(r.vA)}</td><td class="mono">${r.p.toFixed(3)}</td><td class="mono">${r.cheb.toFixed(3)}</td></tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${M.label}, m = ${m} attackers, ε = ${eps}. Theory: Var S<sub>n</sub> = ${fmt(M.var)}·n, Var S<sub>n</sub>/√n = ${fmt(M.var)}, Var S<sub>n</sub>/n = ${fmt(M.var)}/n.</caption>`;
    $("gRun").disabled = false;
  }

  // ---------------------------------------------------------------------
  // 5. CLT
  // ---------------------------------------------------------------------
  const CLT_NS = [1, 2, 5, 10, 30, 100, 1000, 10000];

  async function runCLT() {
    $("cRun").disabled = true; await tick();
    const M = readModel("cModel", "cP"), m = clampInt($("cM").value, 200, 20000, 5000); $("cM").value = m;
    const r = Sim.simulate(M, 10000, m, { checkpoints: CLT_NS });
    const sd = Math.sqrt(M.var), grid = $("cltGrid");
    grid.innerHTML = CLT_NS.map((n) => `<figure><canvas id="clt${n}"></canvas><figcaption>n = ${n} · KS = <span id="ks${n}"></span></figcaption></figure>`).join("");
    const ks = [], normal = []; for (let t = 0; t <= 200; t++) { const x = -4 + (8 * t) / 200; normal.push([x, Sim.phi(x)]); }
    for (const n of CLT_NS) {
      const S = r.at.get(n), c = 1 / (sd * Math.sqrt(n)), off = n * M.mu;
      const H = latticeHistCentered(M, n, S, off, c);
      const z = Sim.scale(S, c, off), d = Sim.ksNormal(z);
      ks.push([n, d]); $(`ks${n}`).textContent = d.toFixed(3);
      const ymax = Math.max(0.6, ...H.map((b) => b[2])) * 1.05;
      plot($(`clt${n}`), { xMin: -4, xMax: 4, yMin: 0, yMax: Math.min(ymax, 2.5), ml: 34, xTicks: [-4, -2, 0, 2, 4], yTicks: [0, 0.2, 0.4],
        series: [{ type: "bars", color: css("--accent"), alpha: 0.8, bars: H }, { type: "line", color: css("--red"), width: 2, pts: normal }] });
    }
    const rho = M.name === "bern" ? M.p * (1 - M.p) * (M.p ** 2 + (1 - M.p) ** 2) : 1;
    const be = CLT_NS.map((n) => [n, Math.min(1, (0.4748 * rho) / (sd ** 3 * Math.sqrt(n)))]);
    const floor = 0.87 / Math.sqrt(m);
    plot($("cKS"), { xLog: true, yLog: true, xMin: 1, xMax: 10000, yMin: 0.003, yMax: 1,
      series: [
        { type: "line", color: css("--red"), dash: [5, 4], pts: be },
        { type: "line", color: css("--muted"), dash: [2, 3], pts: [[1, floor], [10000, floor]] },
        { type: "line", color: css("--accent"), width: 2, pts: ks }, { type: "dots", color: css("--accent"), pts: ks },
      ],
      legend: [["KS distance (simulated)", css("--accent")], ["Berry–Esseen bound 0.4748·ρ/(σ³√n)", css("--red"), true], [`Monte Carlo noise 0.87/√m`, css("--muted"), true]], legendAt: "tr",
    });
    // empirical CDFs
    const cdf = (n) => { const z = Array.from(Sim.scale(r.at.get(n), 1 / (sd * Math.sqrt(n)), n * M.mu)).sort((a, b) => a - b); const pts = [[-4, 0]]; z.forEach((v, i) => { pts.push([v, i / z.length], [v, (i + 1) / z.length]); }); pts.push([4, 1]); return pts; };
    const Phi = []; for (let t = 0; t <= 200; t++) { const x = -4 + (8 * t) / 200; Phi.push([x, Sim.Phi(x)]); }
    plot($("cCdf"), { xMin: -4, xMax: 4, yMin: 0, yMax: 1, yTicks: [0, 0.25, 0.5, 0.75, 1],
      series: [{ type: "line", color: css("--gold"), width: 1.5, pts: cdf(5) }, { type: "line", color: css("--accent"), width: 1.5, pts: cdf(10000) }, { type: "line", color: css("--red"), dash: [5, 4], width: 2, pts: Phi }],
      legend: [["n = 5", css("--gold")], ["n = 10000", css("--accent")], ["Φ(x)", css("--red"), true]] });
    $("cRun").disabled = false;
  }
  // histogram of the standardized score on [-4, 4] with bins aligned to the lattice
  function latticeHistCentered(M, n, S, off, c) {
    const step = (M.name === "bern" ? 1 : 2) * c; // spacing of the lattice in z units
    let g = step >= 8 / 40 ? 1 : Math.ceil(8 / 40 / step);
    if (g % 2 === 0) g++; // odd multiple: every bin holds the same number of lattice points
    const W = step * g;
    // align bin centres with lattice points: lattice point z0 = (s0 - off)·c
    const s0 = M.name === "bern" ? 0 : -n, z0 = (s0 - off) * c;
    const k0 = Math.floor((-4 - z0) / W), bins = [];
    for (let k = k0; z0 + k * W - W / 2 < 4; k++) bins.push([z0 + k * W - W / 2, z0 + k * W + W / 2, 0]);
    for (const v of S) { const z = (v - off) * c, b = Math.round((z - z0) / W) - k0; if (b >= 0 && b < bins.length) bins[b][2]++; }
    return bins.map(([a, b, k]) => [a, b, k / (S.length * W)]);
  }

  // ---------------------------------------------------------------------
  // 6. Number of attackers
  // ---------------------------------------------------------------------
  function expectedMax(m) { // E[max of m i.i.d. N(0,1)] by numerical integration
    let s = 0; const a = -8, b = 10, N = 4000, h = (b - a) / N;
    for (let i = 0; i <= N; i++) { const x = a + i * h, f = x * m * Sim.phi(x) * Math.pow(Sim.Phi(x), m - 1); s += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * f; }
    return (s * h) / 3;
  }

  async function runAttackers() {
    $("aRun").disabled = true; await tick();
    const M = readModel("aModel", "aP"), n = clampInt($("aN").value, 10, 20000, 1000); $("aN").value = n;
    const pool = Math.min(40000, Math.floor(6e7 / n));
    const r = Sim.simulate(M, n, pool, { checkpoints: [n] });
    const S = r.at.get(n), sd = Math.sqrt(M.var), z = Sim.scale(S, 1 / (sd * Math.sqrt(n)), n * M.mu);
    const ms = [10, 30, 100, 300, 1000, 3000, 10000].filter((m) => m <= pool / 3);
    const rows = ms.map((m) => {
      const R = Math.floor(pool / m); let mx = 0, mn = 0, eMean = 0, eVar = 0;
      for (let q = 0; q < R; q++) {
        const blk = z.subarray(q * m, (q + 1) * m), raw = S.subarray(q * m, (q + 1) * m);
        let a = -Infinity, b = Infinity; for (const v of blk) { if (v > a) a = v; if (v < b) b = v; }
        mx += a; mn += b;
        eMean += Math.abs(Sim.mean(raw) / n - M.mu);
        eVar += Math.abs(Sim.variance(raw) / n - M.var);
      }
      return { m, R, mx: mx / R, mn: mn / R, eMean: eMean / R, eVar: eVar / R, ex: expectedMax(m), asy: Math.sqrt(2 * Math.log(m)) };
    });
    const ymax = Math.max(...rows.map((r) => Math.max(r.mx, r.asy))) + 0.5;
    plot($("cMax"), { xLog: true, xMin: 10, xMax: 10000, yMin: -ymax, yMax: ymax,
      series: [
        { type: "line", color: css("--muted"), dash: [5, 4], pts: rows.map((r) => [r.m, r.asy]) },
        { type: "line", color: css("--red"), pts: rows.map((r) => [r.m, r.ex]) },
        { type: "line", color: css("--red"), pts: rows.map((r) => [r.m, -r.ex]) },
        { type: "dots", color: css("--green"), pts: rows.map((r) => [r.m, r.mx]) },
        { type: "dots", color: css("--orange"), pts: rows.map((r) => [r.m, r.mn]) },
      ],
      legend: [["best attacker (simulated)", css("--green")], ["worst attacker (simulated)", css("--orange")], ["E[max of m normals]", css("--red")], ["√(2 ln m)", css("--muted"), true]], legendAt: "ml" });
    const refM = rows[0].eMean * Math.sqrt(rows[0].m), refV = rows[0].eVar * Math.sqrt(rows[0].m);
    plot($("cErr"), { xLog: true, yLog: true, xMin: 10, xMax: 10000, yMin: Math.min(...rows.map((r) => Math.min(r.eMean, r.eVar))) / 3, yMax: Math.max(...rows.map((r) => Math.max(r.eMean, r.eVar))) * 3,
      series: [
        { type: "line", color: css("--accent"), dash: [5, 4], pts: rows.map((r) => [r.m, refM / Math.sqrt(r.m)]) },
        { type: "line", color: css("--purple"), dash: [5, 4], pts: rows.map((r) => [r.m, refV / Math.sqrt(r.m)]) },
        { type: "line", color: css("--accent"), width: 2, pts: rows.map((r) => [r.m, r.eMean]) }, { type: "dots", color: css("--accent"), pts: rows.map((r) => [r.m, r.eMean]) },
        { type: "line", color: css("--purple"), width: 2, pts: rows.map((r) => [r.m, r.eVar]) }, { type: "dots", color: css("--purple"), pts: rows.map((r) => [r.m, r.eVar]) },
      ],
      legend: [["|mean of Sn/n − μ|", css("--accent")], ["|sample Var(Sn/√n) − σ²|", css("--purple")], ["∝ 1/√m", css("--muted"), true]], legendAt: "bl" });
    $("aTable").innerHTML = `<thead><tr><th>m attackers</th><th>repetitions</th><th>best attacker (z)</th><th>E[max] theory</th><th>√(2 ln m)</th><th>best score S<sub>n</sub></th><th>error of mean S<sub>n</sub>/n</th><th>total Σ S<sub>n</sub>: mean ± sd</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td class="mono">${r.m}</td><td class="mono">${r.R}</td><td class="mono">${r.mx.toFixed(2)}</td><td class="mono">${r.ex.toFixed(2)}</td><td class="mono">${r.asy.toFixed(2)}</td><td class="mono">≈ ${fmt(n * M.mu + r.mx * sd * Math.sqrt(n), 1)}</td><td class="mono">${fmt(r.eMean)}</td><td class="mono">${fmt(r.m * n * M.mu, 0)} ± ${fmt(sd * Math.sqrt(r.m * n), 1)}</td></tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${M.label}, n = ${n}; a pool of ${pool} simulated attackers split into groups of m. z = (S<sub>n</sub> − nμ)/(σ√n).</caption>`;
    $("aRun").disabled = false;
  }

  // ---------------------------------------------------------------------
  async function init() {
    $("tRun").addEventListener("click", runTraj);
    $("gRun").addEventListener("click", runGrowing);
    $("cRun").addEventListener("click", runCLT);
    $("aRun").addEventListener("click", runAttackers);
    for (const id of ["tModel", "gModel", "cModel", "aModel"]) $(id).addEventListener("change", () => $(id[0] + "Run").click());
    runTraj(); await tick();
    await runGrowing(); await runCLT(); await runAttackers();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
