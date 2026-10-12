/* =========================================================================
   app.js — page logic for Homework 1
   - setup + step-by-step computation of kG
   - slowed-down SVG visualization of the algorithm
   - secp256k1 demo
   - statistical exploration with canvas charts
   ========================================================================= */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const O = EC.O;
  const CURVES = { toy: EC.TOY, mini: EC.MINI };
  const DEFAULT_G = { toy: "1,5", mini: "3,33" };
  const SUB = "₀₁₂₃₄₅₆₇₈₉";

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  const keyOf = (P) => (P === O ? "O" : `${P.x},${P.y}`);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const bitLength = (n) => BigInt(n).toString(2).length;
  const fmt = EC.fmt;

  function card(label, value, hint, cls = "") {
    return `<div class="card"><div class="label">${label}</div>
      <div class="value ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  }

  // Points of a curve together with their order (cached)
  const pointCache = {};
  function pointsWithOrder(key) {
    if (!pointCache[key]) {
      const C = CURVES[key];
      pointCache[key] = EC.allPoints(C).map((P) => ({ P, n: EC.order(C, P) }));
    }
    return pointCache[key];
  }

  function fillGSelect(sel, key, keepValue) {
    const prev = keepValue ? sel.value : null;
    sel.innerHTML = pointsWithOrder(key)
      .map(({ P, n }) => `<option value="${P.x},${P.y}">${fmt(P)} — order ${n}</option>`)
      .join("");
    sel.value = prev && [...sel.options].some((o) => o.value === prev) ? prev : DEFAULT_G[key];
  }

  function parseG(sel) {
    const [x, y] = sel.value.split(",").map(BigInt);
    return { x, y };
  }

  function subgroup(C, G) {
    const set = new Set(), list = [O];
    let R = G;
    while (R !== O) { set.add(keyOf(R)); list.push(R); R = EC.add(C, R, G); }
    return { set, list }; // list[i] = iG
  }

  // Human-readable explanation of one point addition (used in tables and panel)
  function explain(C, A, B, info, R) {
    const p = C.p;
    if (info.kind === "identity") return `R = O, so O + G = G`;
    if (info.kind === "inverse") {
      return `x₁ = x₂ = ${A.x} and y₁ + y₂ = ${A.y} + ${B.y} ≡ 0 (mod ${p})\n` +
             `→ the line is vertical → result is O (point at infinity)`;
    }
    const iv = EC.inv(info.den, p);
    let lam;
    if (info.kind === "double") {
      lam = `λ = (3·x₁² + a) / (2·y₁) = (3·${A.x}² + ${C.a}) / (2·${A.y})\n` +
            `  ≡ ${info.num} / ${info.den} = ${info.num} · ${iv} ≡ ${info.lambda}   (${info.den}⁻¹ = ${iv})`;
    } else {
      lam = `λ = (y₂ − y₁) / (x₂ − x₁) = (${B.y} − ${A.y}) / (${B.x} − ${A.x})\n` +
            `  ≡ ${info.num} / ${info.den} = ${info.num} · ${iv} ≡ ${info.lambda}   (${info.den}⁻¹ = ${iv})`;
    }
    return lam + `\n` +
      `x₃ = λ² − x₁ − x₂ = ${info.lambda}² − ${A.x} − ${B.x} ≡ ${R.x}\n` +
      `y₃ = λ(x₁ − x₃) − y₁ = ${info.lambda}·(${A.x} − ${R.x}) − ${A.y} ≡ ${R.y}`;
  }

  // ---------------------------------------------------------------------
  // 2–3. Setup and computation
  // ---------------------------------------------------------------------

  let S = null; // current setup: { key, C, G, n, k, sub }

  function readSetup() {
    const key = $("curveSel").value;
    const C = CURVES[key];
    const G = parseG($("gSel"));
    let k;
    try { k = BigInt($("kInput").value || "1"); } catch { k = 1n; }
    if (k < 1n) k = 1n;
    $("kInput").value = k.toString();
    const n = EC.order(C, G);
    return { key, C, G, n, k, sub: subgroup(C, G) };
  }

  function compute() {
    S = readSetup();
    const { C, G, n, k } = S;
    const N = pointsWithOrder(S.key).length + 1;
    const kr = k % n;
    const Q = EC.mul(C, k, G);

    $("setupInfo").innerHTML =
      card("Curve", C.name) +
      card("Base point G", fmt(G),
        EC.isOnCurve(C, G) ? `<span class="ok">✓ on the curve: ${G.y}² ≡ ${G.x}³ + 7 ≡ ${EC.mod(G.y * G.y, C.p)}</span>`
                           : `<span class="bad">✗ not on the curve</span>`) +
      card("Points on the curve", `N = ${N}`, `${N - 1} affine points + O`) +
      card("Order of G", `n = ${n}`, `nG = O; |⟨G⟩| = ${n} possible public keys`) +
      card("Private key", `k = ${k}`, k >= n ? `k mod n = ${kr}, so kG = ${kr}·G` : `1 ≤ k < n ✓`);

    // --- table of multiples
    const upTo = k < n ? k : n;
    const steps = EC.multiplesTrace(C, G, upTo);
    let html = `<thead><tr><th>i</th><th>operation</th><th>case</th><th>calculation (mod ${C.p})</th><th>iG</th></tr></thead><tbody>`;
    let prev = null;
    for (const s of steps) {
      const isFinal = s.k === (kr === 0n ? n : kr) || (k < n && s.k === k);
      let op = "—", kase = "start", calc = "base point";
      if (s.k > 1n) {
        op = `${s.k - 1n}G + G`;
        kase = { double: "doubling", add: "addition", inverse: "P + (−P)", identity: "identity" }[s.info.kind];
        calc = `<code>${explain(C, prev, G, s.info, s.R).replace(/\n/g, "<br>")}</code>`;
      }
      html += `<tr class="${isFinal ? "final" : ""}"><td>${s.k}</td><td class="mono">${op}</td><td>${kase}</td><td>${calc}</td><td class="mono">${fmt(s.R)}</td></tr>`;
      prev = s.R;
    }
    $("multTable").innerHTML = html + "</tbody>";
    $("multNote").textContent = k >= n
      ? `The sequence reaches O at ${n}G (the order of G) and then repeats: ${k}G = (${k} mod ${n})·G = ${kr}·G = ${fmt(Q)}.`
      : `The sequence would reach O at ${n}G (order of G) and then repeat.`;

    // --- double-and-add trace
    const t = EC.mulTrace(C, k, G);
    let da = `<thead><tr><th>bit</th><th>operation</th><th>partial scalar</th><th>R</th></tr></thead><tbody>`;
    for (const r of t.trace) {
      const bin = r.partial === 0n ? "0" : r.partial.toString(2);
      da += `<tr><td class="mono">${r.bit}</td><td>${r.op === "double" ? "R ← 2R (double)" : "R ← R + G (add)"}</td>` +
            `<td class="mono">${r.partial} = (${bin})₂</td><td class="mono">${fmt(r.R)}</td></tr>`;
    }
    $("daTable").innerHTML = da + `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">` +
      `k = ${k} = (${t.bits})₂ → ${t.trace.filter((r) => r.op === "double").length} doublings and ` +
      `${t.trace.filter((r) => r.op === "add").length} additions (naive method: ${k - 1n} additions)</caption>`;

    $("result").innerHTML =
      `Private key k = ${k}<br>TOY PUBLIC KEY: <span class="big">Q = ${k}G = ${fmt(Q)}</span>` +
      (Q !== O ? `<br><span class="muted">Check: ${Q.y}² ≡ ${EC.mod(Q.y * Q.y, C.p)} and ${Q.x}³ + 7 ≡ ${EC.mod(Q.x ** 3n + 7n, C.p)} (mod ${C.p}) ✓</span>` : "");

    buildViz();
  }

  // ---------------------------------------------------------------------
  // 4. Slowed-down visualization (SVG)
  // ---------------------------------------------------------------------

  const svgNS = "http://www.w3.org/2000/svg";
  const V = { steps: [], i: 0, timer: null, M: 40, W: 460, overlay: null };

  function el(name, attrs, parent) {
    const e = document.createElementNS(svgNS, name);
    for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function coord(P) {
    const p = Number(S.C.p), cell = V.W / (p - 1);
    return [V.M + Number(P.x) * cell, V.M + (p - 1 - Number(P.y)) * cell];
  }

  function buildSteps() {
    const { C, G, k, n } = S;
    const steps = [];
    if ($("algoSel").value === "naive") {
      const last = k < n ? k : n;
      steps.push({ title: "Start: R = G", A: null, B: null, R: G, text: `G = ${fmt(G)} is the base point.`, label: "1G" });
      let R = G;
      for (let i = 2n; i <= last; i++) {
        const r = EC.addVerbose(C, R, G);
        steps.push({
          title: `Step ${i - 1n}: ${i - 1n}G + G = ${i}G (${r.info.kind === "double" ? "doubling" : r.info.kind === "inverse" ? "P + (−P)" : "addition"})`,
          A: R, B: G, R: r.R, text: explain(C, R, G, r.info, r.R), label: `${i}G`,
        });
        R = r.R;
      }
    } else {
      let R = O, partial = 0n;
      for (const bit of k.toString(2)) {
        const d = EC.addVerbose(C, R, R);
        partial *= 2n;
        if (R !== O) {
          steps.push({ title: `Bit ${bit}: double → ${partial}G`, A: R, B: R, R: d.R,
            text: explain(C, R, R, d.info, d.R), label: `${partial}G` });
        }
        R = d.R;
        if (bit === "1") {
          const a = EC.addVerbose(C, R, G);
          partial += 1n;
          steps.push({ title: `Bit 1: add G → ${partial}G`, A: R === O ? null : R, B: G, R: a.R,
            text: R === O ? `R = O, so O + G = G = ${fmt(G)}` : explain(C, R, G, a.info, a.R), label: `${partial}G` });
          R = a.R;
        }
      }
    }
    return steps;
  }

  function buildViz() {
    stopPlay();
    const svg = $("grid");
    svg.innerHTML = "";
    const p = Number(S.C.p), cell = V.W / (p - 1);
    const small = p <= 31;

    // grid + axis labels
    const g = el("g", {}, svg);
    const every = small ? 2 : 50;
    for (let t = 0; t < p; t++) {
      const pos = V.M + t * cell;
      if (small) {
        el("line", { x1: pos, y1: V.M, x2: pos, y2: V.M + V.W, class: "gridline" }, g);
        el("line", { x1: V.M, y1: pos, x2: V.M + V.W, y2: pos, class: "gridline" }, g);
      }
      if (t % every === 0) {
        el("text", { x: pos, y: V.M + V.W + 18, class: "axis-label", "text-anchor": "middle" }, g).textContent = t;
        el("text", { x: V.M - 10, y: V.M + (p - 1 - t) * cell + 4, class: "axis-label", "text-anchor": "end" }, g).textContent = t;
      }
    }
    el("text", { x: V.M + V.W / 2, y: V.M + V.W + 34, class: "axis-label", "text-anchor": "middle" }, g).textContent = "x";
    el("text", { x: 12, y: V.M + V.W / 2, class: "axis-label" }, g).textContent = "y";

    // points
    const r = small ? 6 : 2.4;
    const pts = el("g", {}, svg);
    for (const { P } of pointsWithOrder(S.key)) {
      const [cx, cy] = coord(P);
      const c = el("circle", { cx, cy, r, class: "pt" + (S.sub.set.has(keyOf(P)) ? " sub" : ""), id: "pt-" + keyOf(P) }, pts);
      el("title", {}, c).textContent = fmt(P);
    }
    // box for the point at infinity
    const ob = el("g", { id: "obox" }, svg);
    el("rect", { x: V.M + V.W - 54, y: 4, width: 54, height: 24, rx: 5, fill: "none", stroke: css("--border") }, ob);
    el("text", { x: V.M + V.W - 27, y: 21, "text-anchor": "middle", class: "pt-label" }, ob).textContent = "O (∞)";

    // arrow marker
    const defs = el("defs", {}, svg);
    const mk = el("marker", { id: "head", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", fill: css("--red") }, mk);

    V.overlay = el("g", {}, svg);
    V.labels = el("g", {}, svg);
    V.steps = buildSteps();
    V.i = 0;
    $("stepPanel").innerHTML = `<div class="step-title">Ready</div><div class="calc">${V.steps.length} operations to compute ${S.k}G with ${$("algoSel").value === "naive" ? "repeated addition" : "double-and-add"}.\nPress Play or Step.</div>`;
  }

  function renderStep(idx) {
    const s = V.steps[idx];
    V.overlay.innerHTML = "";
    document.querySelectorAll("#grid .pt.current").forEach((c) => c.classList.replace("current", "visited"));
    const small = Number(S.C.p) <= 31;
    const R0 = small ? 11 : 6;

    // rings on the operands
    if (s.A) { const [x, y] = coord(s.A); el("circle", { cx: x, cy: y, r: R0, class: "ring" }, V.overlay); }
    if (s.B && !(s.A && EC.eq(s.A, s.B))) { const [x, y] = coord(s.B); el("circle", { cx: x, cy: y, r: R0, class: "ring op" }, V.overlay); }

    // arrow from the current point to the result
    let to;
    if (s.R === O) to = [V.M + V.W - 27, 28];
    else to = coord(s.R);
    if (s.A) {
      const from = coord(s.A);
      const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2;
      const dx = to[0] - from[0], dy = to[1] - from[1];
      const bend = 0.18;
      const d = `M${from[0]},${from[1]} Q${mx - dy * bend},${my + dx * bend} ${to[0]},${to[1]}`;
      const path = el("path", { d, class: "arrow", "marker-end": "url(#head)" }, V.overlay);
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      requestAnimationFrame(() => requestAnimationFrame(() => { path.style.strokeDashoffset = 0; }));
    }

    // result
    if (s.R !== O) {
      const c = document.getElementById("pt-" + keyOf(s.R));
      if (c) { c.classList.remove("visited"); c.classList.add("current"); }
      if (small) {
        const [x, y] = coord(s.R);
        el("text", { x: x + 9, y: y - 8, class: "pt-label" }, V.labels).textContent = s.label;
      }
    }

    const last = idx === V.steps.length - 1;
    $("stepPanel").innerHTML =
      `<div class="step-title">${s.title}</div>` +
      `<div class="calc">${s.text}\n\nResult: ${s.label} = ${fmt(s.R)}${last ? `\n\n★ TOY PUBLIC KEY: Q = ${S.k}G = ${fmt(EC.mul(S.C, S.k, S.G))}` : ""}</div>` +
      `<div class="progress">Operation ${idx + 1} of ${V.steps.length} · yellow ring = R, red ring = G</div>`;
  }

  function step() {
    if (V.i >= V.steps.length) { stopPlay(); return false; }
    renderStep(V.i++);
    if (V.i >= V.steps.length) stopPlay();
    return true;
  }

  function play() {
    if (V.timer) { stopPlay(); return; }
    if (V.i >= V.steps.length) buildViz();
    $("playBtn").textContent = "❚❚ Pause";
    step();
    V.timer = setInterval(step, Number($("speed").value));
  }

  function stopPlay() {
    if (V.timer) clearInterval(V.timer);
    V.timer = null;
    $("playBtn").textContent = "▶ Play";
  }

  // ---------------------------------------------------------------------
  // 5. secp256k1
  // ---------------------------------------------------------------------

  function computeReal() {
    const C = EC.SECP256K1;
    let k;
    try { k = BigInt($("realK").value.trim()); } catch { $("realOut").textContent = "Invalid number."; return; }
    if (k < 1n || k >= C.n) { $("realOut").textContent = "k must satisfy 1 ≤ k < n (n = order of G)."; return; }
    const t0 = performance.now();
    const Q = EC.mul(C, k, C.G);
    const ms = (performance.now() - t0).toFixed(1);
    $("realOut").textContent =
      `k  = 0x${EC.hex(k)}\n\n` +
      `Q.x = 0x${EC.hex(Q.x)}\nQ.y = 0x${EC.hex(Q.y)}\n\n` +
      `Uncompressed public key (SEC format): 04${EC.hex(Q.x)}${EC.hex(Q.y)}\n` +
      `On curve: ${EC.isOnCurve(C, Q) ? "yes ✓" : "NO"} · computed with ${bitLength(k)} doublings in ${ms} ms`;
  }

  // ---------------------------------------------------------------------
  // 6. Statistics
  // ---------------------------------------------------------------------

  // --- numeric helpers
  function lnGamma(z) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  // Upper regularized incomplete gamma Q(s, x)
  function gammaQ(s, x) {
    if (x <= 0) return 1;
    if (x < s + 1) { // series for P
      let sum = 1 / s, term = sum;
      for (let n = 1; n < 500; n++) { term *= x / (s + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break; }
      return 1 - sum * Math.exp(-x + s * Math.log(x) - lnGamma(s));
    }
    let b = x + 1 - s, c = 1e300, d = 1 / b, h = d; // continued fraction for Q
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - s); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return Math.exp(-x + s * Math.log(x) - lnGamma(s)) * h;
  }
  function chiSquare(counts) {
    const total = counts.reduce((a, b) => a + b, 0), E = total / counts.length;
    const chi = counts.reduce((a, o) => a + (o - E) ** 2 / E, 0);
    const df = counts.length - 1;
    return { chi, df, pval: gammaQ(df / 2, chi / 2) };
  }
  function pearson(a, b) {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  const popcount = (v) => { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; };
  function randomBelow(n) { // uniform integer in [0, n), n < 2^32
    const buf = new Uint32Array(1), lim = Math.floor(2 ** 32 / n) * n;
    do crypto.getRandomValues(buf); while (buf[0] >= lim);
    return buf[0] % n;
  }
  const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  const fmtP = (p) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));

  // --- core experiment for one base point (Numbers are enough for small curves)
  function experiment(C, G, ks) {
    const n = Number(EC.order(C, G));
    const p = Number(C.p), L = bitLength(p - 1), kb = bitLength(n - 1);
    const xs = [], ys = [], kk = [];
    const pointCounts = new Array(n).fill(0);
    const multiples = subgroup(C, G).list; // multiples[i] = iG, used only to index the points
    const index = new Map(multiples.map((P, i) => [keyOf(P), i]));
    for (const k of ks) {
      const Q = EC.mul(C, BigInt(k), G); // real scalar multiplication
      if (Q === O) continue;
      xs.push(Number(Q.x)); ys.push(Number(Q.y)); kk.push(k);
      pointCounts[index.get(keyOf(Q))]++;
    }
    const cx = new Array(p).fill(0), cy = new Array(p).fill(0);
    xs.forEach((v) => cx[v]++); ys.forEach((v) => cy[v]++);
    const bitsX = [], bitsY = [];
    for (let i = 0; i < L; i++) {
      bitsX.push(xs.filter((v) => (v >> i) & 1).length / xs.length);
      bitsY.push(ys.filter((v) => (v >> i) & 1).length / ys.length);
    }
    // avalanche: flip each bit of k, Hamming distance between x||y
    const hd = new Array(2 * L + 1).fill(0);
    let hdSum = 0, hdN = 0;
    for (const k of ks.slice(0, 3000)) {
      if (k % n === 0) continue;
      const Q = multiples[k % n];
      for (let i = 0; i < kb; i++) {
        const k2 = k ^ (1 << i);
        if (k2 % n === 0) continue;
        const Q2 = multiples[k2 % n];
        const d = popcount(Number(Q.x) ^ Number(Q2.x)) + popcount(Number(Q.y) ^ Number(Q2.y));
        hd[d]++; hdSum += d; hdN++;
      }
    }
    // homomorphism check (a+b)G = aG + bG
    let homOk = 0;
    const homN = 300;
    for (let i = 0; i < homN; i++) {
      const a = BigInt(1 + randomBelow(10 * n)), b = BigInt(1 + randomBelow(10 * n));
      if (EC.eq(EC.mul(C, a + b, G), EC.add(C, EC.mul(C, a, G), EC.mul(C, b, G)))) homOk++;
    }
    return {
      n, p, L, xs, ys, kk, cx, cy, bitsX, bitsY, hd, hdMean: hdSum / Math.max(hdN, 1), pointCounts,
      chiX: chiSquare(cx), chiY: chiSquare(cy), chiPts: chiSquare(pointCounts.slice(1)),
      rx: pearson(kk, xs), ry: pearson(kk, ys), homOk, homN,
      distinctX: cx.filter((c) => c > 0).length, distinctY: cy.filter((c) => c > 0).length,
      distinctPts: pointCounts.filter((c) => c > 0).length,
    };
  }

  // --- tiny canvas chart library
  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    return { ctx, w, h, m: { l: 44, r: 10, t: 12, b: 26 } };
  }
  function axes(c, yMax, xLabels, yFmt = (v) => v) {
    const { ctx, w, h, m } = c;
    ctx.strokeStyle = css("--border"); ctx.fillStyle = css("--muted"); ctx.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = h - m.b - f * (h - m.t - m.b);
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(yFmt(+(yMax * f).toPrecision(3)), m.l - 6, y + 4);
    }
    ctx.textAlign = "center";
    for (const [pos, text] of xLabels) ctx.fillText(text, pos, h - m.b + 15);
  }
  function bars(cv, values, { color, ref, labelEvery = 1, series2, color2, yMax: forced, refColor } = {}) {
    const c = setupCanvas(cv), { ctx, w, h, m } = c;
    const n = values.length, all = series2 ? values.concat(series2) : values;
    const yMax = forced || Math.max(...all, ref || 0) * 1.1 || 1;
    const bw = (w - m.l - m.r) / n;
    const X = (i) => m.l + i * bw, Y = (v) => h - m.b - (v / yMax) * (h - m.t - m.b);
    const labels = [];
    for (let i = 0; i < n; i += labelEvery) labels.push([X(i) + bw / 2, String(i)]);
    axes(c, yMax, labels);
    const gap = Math.min(2, bw * 0.15);
    values.forEach((v, i) => {
      ctx.fillStyle = color;
      const bww = series2 ? (bw - gap) / 2 : bw - gap;
      ctx.fillRect(X(i) + gap / 2, Y(v), bww, h - m.b - Y(v));
      if (series2) { ctx.fillStyle = color2; ctx.fillRect(X(i) + gap / 2 + bww, Y(series2[i]), bww, h - m.b - Y(series2[i])); }
    });
    if (ref != null) {
      ctx.strokeStyle = refColor || css("--red"); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(m.l, Y(ref)); ctx.lineTo(w - m.r, Y(ref)); ctx.stroke(); ctx.setLineDash([]);
    }
    return { X, Y, bw, ctx };
  }
  function scatter(cv, xs, ys, xMax, yMax) {
    const c = setupCanvas(cv), { ctx, w, h, m } = c;
    const X = (v) => m.l + (v / xMax) * (w - m.l - m.r), Y = (v) => h - m.b - (v / yMax) * (h - m.t - m.b);
    const step = Math.max(1, Math.round(xMax / 5));
    const labels = [];
    for (let v = 0; v <= xMax; v += step) labels.push([X(v), String(v)]);
    axes(c, yMax, labels, (v) => Math.round(v));
    ctx.fillStyle = css("--accent");
    const r = xs.length > 400 ? 2 : 3.2;
    xs.forEach((x, i) => { ctx.beginPath(); ctx.arc(X(x), Y(ys[i]), r, 0, 2 * Math.PI); ctx.fill(); });
    ctx.strokeStyle = css("--gold"); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(xMax / 2), m.t); ctx.lineTo(X(xMax / 2), h - m.b); ctx.stroke(); ctx.setLineDash([]);
  }

  function runStats() {
    const key = $("sCurve").value, C = CURVES[key], G = parseG($("sG"));
    const n = Number(EC.order(C, G));
    let ks;
    if ($("sMode").value === "period") ks = Array.from({ length: n - 1 }, (_, i) => i + 1);
    else {
      const N = Math.max(10, Math.min(200000, Number($("sN").value) || 1000));
      ks = Array.from({ length: N }, () => 1 + randomBelow(n - 1));
    }
    const R = experiment(C, G, ks);
    const period = experiment(C, G, Array.from({ length: n - 1 }, (_, i) => i + 1));

    const verdict = (p) => (p < 0.01 ? `<span class="bad">reject uniform (p = ${fmtP(p)})</span>` : `<span class="ok">consistent with uniform (p = ${fmtP(p)})</span>`);
    $("metrics").innerHTML =
      card("Samples", `${R.xs.length}`, `k → kG with G = ${fmt(G)}, order n = ${R.n}`) +
      card("Distinct outputs", `${R.distinctPts} / ${R.n - 1}`, `points of ⟨G⟩ reached (O excluded)`) +
      card("χ² on the points", R.chiPts.chi.toFixed(1), `df = ${R.chiPts.df}: ${verdict(R.chiPts.pval)}`) +
      card("Distinct x values", `${R.distinctX} / ${R.p}`, `χ² = ${R.chiX.chi.toFixed(1)}, ${verdict(R.chiX.pval)}`) +
      card("Distinct y values", `${R.distinctY} / ${R.p}`, `χ² = ${R.chiY.chi.toFixed(1)}, ${verdict(R.chiY.pval)}`) +
      card("Pearson r(k, x)", R.rx.toFixed(4), `one full period: ${period.rx.toFixed(4)}`) +
      card("Pearson r(k, y)", R.ry.toFixed(4), `one full period: ${period.ry.toFixed(4)}`) +
      card("Avalanche", `${R.hdMean.toFixed(2)} / ${2 * R.L} bits`, `ideal hash: ${R.L} bits changed on average`) +
      card("(a+b)G = aG + bG", `${R.homOk} / ${R.homN}`, R.homOk === R.homN ? `<span class="ok">homomorphism holds — impossible for a hash</span>` : "");

    const blue = css("--accent"), green = css("--green");
    const every = R.p <= 31 ? 1 : 25;
    bars($("cX"), R.cx, { color: blue, ref: R.xs.length / R.p, labelEvery: every });
    bars($("cY"), R.cy, { color: green, ref: R.ys.length / R.p, labelEvery: every });
    bars($("cBits"), R.bitsX, { color: blue, series2: R.bitsY, color2: green, ref: 0.5, yMax: 1 });
    scatter($("cScatter"), period.kk, period.xs, R.n, R.p - 1);
    const tot = R.hd.reduce((a, b) => a + b, 0) || 1;
    const rel = R.hd.map((v) => v / tot);
    const L2 = 2 * R.L;
    const ideal = rel.map((_, j) => binom(L2, j) / 2 ** L2);
    const bc = bars($("cAval"), rel, { color: blue, labelEvery: L2 > 12 ? 2 : 1, yMax: Math.max(...rel, ...ideal) * 1.15 });
    bc.ctx.strokeStyle = css("--red"); bc.ctx.lineWidth = 2; bc.ctx.beginPath();
    ideal.forEach((v, j) => { const x = bc.X(j) + bc.bw / 2, y = bc.Y(v); j ? bc.ctx.lineTo(x, y) : bc.ctx.moveTo(x, y); });
    bc.ctx.stroke();
    bars($("cCount"), R.pointCounts.slice(1), { color: blue, ref: R.xs.length / (R.n - 1), labelEvery: R.n <= 31 ? 1 : 25 });

    // base point comparison
    const all = pointsWithOrder(key);
    const chosen = key === "toy" ? all : all.filter((_, i) => i % 22 === 0).slice(0, 9);
    let html = `<thead><tr><th>G</th><th>order n</th><th>distinct x</th><th>distinct y</th><th>χ² x (p-value)</th><th>r(k,x)</th><th>r(k,y)</th><th>avalanche</th></tr></thead><tbody>`;
    for (const { P } of chosen) {
      const E = experiment(C, P, Array.from({ length: Number(EC.order(C, P)) - 1 }, (_, i) => i + 1));
      const cls = EC.eq(P, G) ? "highlight" : "";
      html += `<tr class="${cls}"><td class="mono">${fmt(P)}</td><td>${E.n}</td><td>${E.distinctX}</td><td>${E.distinctY}</td>` +
        `<td>${E.xs.length > 1 ? fmtP(E.chiX.pval) : "—"}</td><td>${E.xs.length > 1 ? E.rx.toFixed(3) : "—"}</td>` +
        `<td>${E.xs.length > 1 ? E.ry.toFixed(3) : "—"}</td><td>${E.hdMean.toFixed(2)} / ${2 * E.L}</td></tr>`;
    }
    $("bpTable").innerHTML = html + `</tbody>` +
      (key === "mini" ? `<caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">A sample of base points: on this curve every point has order 199 (prime order, cofactor 1), so they all behave the same way.</caption>` : "");
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  function init() {
    fillGSelect($("gSel"), "toy");
    fillGSelect($("sG"), "mini");

    $("curveSel").addEventListener("change", () => {
      fillGSelect($("gSel"), $("curveSel").value);
      $("kInput").value = $("curveSel").value === "toy" ? 6 : 150;
      compute();
    });
    $("gSel").addEventListener("change", compute);
    $("kInput").addEventListener("change", compute);
    $("computeBtn").addEventListener("click", compute);

    $("algoSel").addEventListener("change", buildViz);
    $("playBtn").addEventListener("click", play);
    $("stepBtn").addEventListener("click", () => { stopPlay(); step(); });
    $("resetBtn").addEventListener("click", buildViz);
    const sp = () => {
      $("speedLabel").textContent = `${(Number($("speed").value) / 1000).toFixed(1)} s / step`;
      if (V.timer) { stopPlay(); play(); }
    };
    $("speed").addEventListener("input", sp);
    sp();

    $("realBtn").addEventListener("click", computeReal);

    $("sCurve").addEventListener("change", () => { fillGSelect($("sG"), $("sCurve").value); runStats(); });
    $("sG").addEventListener("change", runStats);
    $("sMode").addEventListener("change", runStats);
    $("statsBtn").addEventListener("click", runStats);
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(runStats, 250); });

    compute();
    computeReal();
    runStats();
  }

  document.addEventListener("DOMContentLoaded", init);
})();