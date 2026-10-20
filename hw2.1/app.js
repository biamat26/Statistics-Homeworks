(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const card = (l, v, h = "") => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div>${h ? `<div class="hint">${h}</div>` : ""}</div>`;
  const short = (h, n = 24) => (h.length > 2 * n + 3 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);
  const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
  const C = window.CORPUS;

  const S = { kp: null, bits: 20, ct: null, trueKey: null };

  // ---------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------

  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    return { ctx, w, h, m: { l: 50, r: 12, t: 14, b: 28 } };
  }
  function grid(c, yMin, yMax, yFmt, steps = 4) {
    const { ctx, w, h, m } = c;
    ctx.strokeStyle = css("--border"); ctx.fillStyle = css("--muted"); ctx.lineWidth = 1; ctx.textAlign = "right";
    for (let s = 0; s <= steps; s++) {
      const v = yMin + (s / steps) * (yMax - yMin), y = h - m.b - (s / steps) * (h - m.t - m.b);
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke();
      ctx.fillText(yFmt(v), m.l - 6, y + 4);
    }
  }
  // bars with optional labels, highlight index and overlay line
  function bars(cv, values, o = {}) {
    const c = setup(cv), { ctx, w, h, m } = c, n = values.length;
    const yMin = o.yMin ?? Math.min(0, ...values);
    const yMax = o.yMax ?? (Math.max(...values, ...(o.line || [0])) * 1.12 || 1);
    const bw = (w - m.l - m.r) / n;
    const X = (i) => m.l + i * bw, Y = (v) => h - m.b - ((v - yMin) / (yMax - yMin)) * (h - m.t - m.b);
    grid(c, yMin, yMax, o.yFmt || ((v) => +v.toPrecision(3)));
    const gap = bw > 5 ? Math.min(3, bw * 0.18) : 0;
    values.forEach((v, i) => {
      ctx.fillStyle = i === o.hi ? css("--gold") : o.color || css("--accent");
      const y0 = Y(Math.max(yMin, 0)), y1 = Y(v);
      ctx.fillRect(X(i) + gap / 2, Math.min(y0, y1), Math.max(bw - gap, 0.7), Math.abs(y0 - y1));
    });
    ctx.fillStyle = css("--muted"); ctx.textAlign = "center";
    const every = o.every || 1;
    (o.labels || values.map((_, i) => String(i))).forEach((t, i) => { if (i % every === 0) ctx.fillText(t, X(i) + bw / 2, h - m.b + 15); });
    if (o.ref != null) {
      ctx.strokeStyle = css("--red"); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(m.l, Y(o.ref)); ctx.lineTo(w - m.r, Y(o.ref)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (o.line) {
      ctx.strokeStyle = css("--red"); ctx.lineWidth = 2; ctx.beginPath();
      o.line.forEach((v, i) => { const x = X(i) + bw / 2; i ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v)); });
      ctx.stroke();
    }
  }
  // multi-series line chart over categorical x
  function lines(cv, xLabels, series, o = {}) {
    const c = setup(cv), { ctx, w, h, m } = c;
    const yMin = o.yMin ?? 0, yMax = o.yMax ?? 100, n = xLabels.length;
    const X = (i) => m.l + (i / (n - 1)) * (w - m.l - m.r - 150), Y = (v) => h - m.b - ((v - yMin) / (yMax - yMin)) * (h - m.t - m.b);
    grid(c, yMin, yMax, o.yFmt || ((v) => v.toFixed(0)));
    ctx.fillStyle = css("--muted"); ctx.textAlign = "center";
    xLabels.forEach((t, i) => ctx.fillText(t, X(i), h - m.b + 15));
    if (o.ref != null) {
      ctx.strokeStyle = css("--muted"); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.l, Y(o.ref)); ctx.lineTo(X(n - 1), Y(o.ref)); ctx.stroke(); ctx.setLineDash([]);
    }
    series.forEach((s, k) => {
      ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
      s.values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
      s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(i), Y(v), 2.6, 0, 7); ctx.fill(); });
      const ly = m.t + 6 + k * 17, lx = w - m.r - 135;
      ctx.fillRect(lx, ly - 4, 14, 3); ctx.textAlign = "left"; ctx.fillText(s.name, lx + 20, ly);
      ctx.fillStyle = css("--muted");
    });
  }

  // ---------------------------------------------------------------------
  // 1. Toy ECC scheme
  // ---------------------------------------------------------------------

  const hex64 = (n) => n.toString(16).padStart(64, "0");

  function keygen() {
    let b = Math.round(+$("bits").value || 20); b = Math.min(40, Math.max(8, b)); $("bits").value = b;
    S.bits = b; S.kp = ECC.keyGen(b); S.ct = null;
    $("keys").innerHTML = kv([
      ["key space", `d ∈ [1, 2<sup>${b}</sup>] → ${(2 ** b).toLocaleString("en")} possible keys`],
      ["private key d", `${S.kp.d} <span class="dim">(0x${S.kp.d.toString(16)})</span>`],
      ["public key Q (compressed)", ECC.compress(S.kp.Q)],
      ["Q.x", hex64(S.kp.Q.x)], ["Q.y", hex64(S.kp.Q.y)],
    ]);
    $("encOut").innerHTML = ""; $("decOut").textContent = ""; $("atkOut").textContent = ""; $("atkBar").style.width = "0";
    return encrypt();
  }

  async function encrypt() {
    const ct = await ECC.encrypt($("msg").value, S.kp.Q);
    S.ct = ct;
    $("encOut").innerHTML = kv([
      ["ephemeral r", `${hex64(ct.r)} <span class="dim">(random, then discarded)</span>`],
      ["R = r·G", ct.Rhex],
      ["shared secret S.x", hex64(ct.S.x)],
      ["keystream K", short(ECC.hex(ct.ks))],
      ["ciphertext c = m ⊕ K", `<span class="hl">${ct.chex}</span>`],
      ["sent to the receiver", `(R, c) = ${ct.Rhex.length / 2 + ct.c.length} bytes`],
    ]);
    $("decOut").textContent = "";
  }

  async function decrypt(wrong) {
    if (!S.ct) await encrypt();
    const d = wrong ? S.kp.d + 1n : S.kp.d;
    const p = await ECC.decrypt(S.ct.Rhex, S.ct.chex, d);
    $("decOut").innerHTML = wrong
      ? `<span class="bad">With d + 1 = ${d}: S = ${short(hex64(p.S.x), 12)} is a different point, so the keystream is wrong:</span>\n${esc(p.text)}\n<span class="dim">bytes: ${ECC.hex(p.m)}</span>`
      : `<span class="ok">S = d·R = ${short(hex64(p.S.x), 12)} = r·Q ✓</span>\nPlaintext: ${esc(p.text)}`;
  }

  // ---------------------------------------------------------------------
  // 2. Caesar
  // ---------------------------------------------------------------------

  function caesarView() {
    const k = +$("ck").value, msg = $("msg").value;
    $("ckLabel").textContent = `k = ${k}`;
    $("alphabet").innerHTML = `<table><tr><td class="lbl">plain</td>${LETTERS.map((l) => `<td>${l}</td>`).join("")}</tr>` +
      `<tr class="c"><td class="lbl">cipher</td>${LETTERS.map((l) => `<td>${Caesar.encrypt(l, k).toUpperCase()}</td>`).join("")}</tr></table>`;
    const ct = Caesar.encrypt(msg, k);
    $("caesarOut").innerHTML = kv([["plaintext", esc(msg)], ["ciphertext", `<span class="hl">${esc(ct)}</span>`], ["decrypted with k", esc(Caesar.decrypt(ct, k))]]);
    $("breakIn").value = ct; S.trueKey = k;
  }

  // ---------------------------------------------------------------------
  // 3. Comparison
  // ---------------------------------------------------------------------

  const entropy = (counts) => { const t = counts.reduce((a, b) => a + b, 0); return -counts.reduce((s, c) => (c ? s + (c / t) * Math.log2(c / t) : s), 0); };

  function lnGamma(z) {
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1; let x = c[0]; for (let i = 1; i < 9; i++) x += c[i] / (z + i);
    const t = z + 7.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function gammaQ(s, x) {
    if (x <= 0) return 1;
    if (x < s + 1) { let sum = 1 / s, term = sum; for (let n = 1; n < 1000; n++) { term *= x / (s + n); sum += term; if (term < sum * 1e-14) break; } return 1 - sum * Math.exp(-x + s * Math.log(x) - lnGamma(s)); }
    let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) { const an = -i * (i - s); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
    return Math.exp(-x + s * Math.log(x) - lnGamma(s)) * h;
  }

  async function compare() {
    const L = Math.min(20000, Math.max(200, +$("cmpLen").value || 5000));
    const start = Math.floor(Math.random() * (C.testPool.length - L));
    const text = C.testPool.slice(start, start + L);
    const k = +$("ck").value || 3;
    const cz = Caesar.encrypt(text, k);
    const e1 = await ECC.encrypt(text, S.kp.Q), e2 = await ECC.encrypt(text, S.kp.Q);
    const pc = Caesar.counts(Caesar.letterIdx(text)), cc = Caesar.counts(Caesar.letterIdx(cz));
    const bc = new Array(256).fill(0); e1.c.forEach((b) => bc[b]++);
    const hdHist = new Array(9).fill(0); let diffBits = 0;
    e1.c.forEach((b, i) => { let x = b ^ e2.c[i], n = 0; while (x) { n += x & 1; x >>= 1; } hdHist[n]++; diffBits += n; });
    const E = bc.reduce((a, b) => a + b, 0) / 256, chi = bc.reduce((s, o) => s + (o - E) ** 2 / E, 0), p = gammaQ(127.5, chi / 2);
    const pb = new Array(256).fill(0); new TextEncoder().encode(text).forEach((b) => pb[b]++);
    $("cmpMetrics").innerHTML =
      card("Plaintext", `${entropy(pc).toFixed(3)} bits/letter`, `entropy of the letter distribution; ${entropy(pb).toFixed(2)} bits/byte over all characters`) +
      card("Caesar ciphertext", `${entropy(cc).toFixed(3)} bits/letter`, `identical: a rotation does not change the distribution`) +
      card("Toy ECC ciphertext", `${entropy(bc).toFixed(3)} bits/byte`, `maximum is 8; χ² uniformity p = ${p.toFixed(3)}`) +
      card("Encrypt twice", `${(100 * diffBits / (8 * e1.c.length)).toFixed(1)}% bits differ`, `ECC: two independent ciphertexts. Caesar: ${Caesar.encrypt(text, k) === cz ? "identical" : "different"}`);
    const mx = Math.max(...pc.map((v) => v / pc.reduce((a, b) => a + b)), 0.13) * 1.1;
    bars($("cPlain"), pc.map((v) => v / pc.reduce((a, b) => a + b)), { labels: LETTERS, color: css("--accent"), yMax: mx, yFmt: (v) => v.toFixed(2) });
    bars($("cCaesar"), cc.map((v) => v / cc.reduce((a, b) => a + b)), { labels: LETTERS.map((l) => l.toUpperCase()), color: css("--orange"), yMax: mx, yFmt: (v) => v.toFixed(2), hi: (4 + k) % 26 });
    bars($("cEccBytes"), bc, { color: css("--green"), ref: E, every: 32, yMin: 0 });
    const binom = [1, 8, 28, 56, 70, 56, 28, 8, 1].map((v) => v / 256);
    bars($("cTwice"), hdHist.map((v) => v / e1.c.length), { color: css("--purple"), line: binom, yFmt: (v) => v.toFixed(2) });
  }

  // ---------------------------------------------------------------------
  // 4. Caesar cryptanalysis
  // ---------------------------------------------------------------------

  const SPECIAL = {
    noE: "A curious fox ran around a quiet park at dawn. It could not spot its small cousin, who was hiding in a dark burrow, waiting for a bird to land on a high branch. All was calm, warm and still until a loud dog was roaring and rushing toward a pond.",
    italian: "Nel mezzo di una giornata di pioggia la piccola libreria del paese era quasi vuota. Il proprietario sistemava con calma i volumi sugli scaffali, mentre una ragazza sfogliava un vecchio atlante cercando le isole che sognava di visitare.",
    short: "Go now",
    code: "QXZ7 KJW2 VYQ9 ZZXK JQVW XKZJ QQZV WXYZ KJQV ZWXQ",
  };

  function breakIt() {
    const ct = $("breakIn").value, idx = Caesar.letterIdx(ct);
    if (!idx.length) { $("breakTable").innerHTML = ""; return; }
    let rows = `<thead><tr><th>method</th><th>key</th><th>decryption</th>${S.trueKey !== null ? "<th>correct?</th>" : ""}</tr></thead><tbody>`;
    const results = Caesar.METHODS.map((m) => ({ m, r: m.fn(idx) }));
    for (const { m, r } of results) {
      const ok = S.trueKey !== null ? r.key === S.trueKey : null;
      rows += `<tr class="${ok ? "best" : ""}"><td>${m.name}</td><td class="mono">${r.key}</td><td class="mono">${esc(Caesar.decrypt(ct, r.key).slice(0, 90))}${ct.length > 90 ? "…" : ""}</td>` +
        (ok === null ? "" : `<td>${ok ? '<span class="ok">✓</span>' : `<span class="bad">✗ (true key ${S.trueKey})</span>`}</td>`) + "</tr>";
    }
    $("breakTable").innerHTML = rows + `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">${idx.length} letters in the ciphertext.</caption>`;
    const hi = S.trueKey ?? results[4].r.key;
    const chi = results[1].r.scores;
    bars($("cChi"), chi, { hi, color: css("--accent"), yMin: 0, yFmt: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)), every: 2 });
    const tri = results[4].r.scores.map((s) => s / Math.max(idx.length - 2, 1));
    const lo = Math.min(...tri);
    bars($("cTri"), tri, { hi, color: css("--teal"), yMin: lo * 1.05, yMax: 0, yFmt: (v) => v.toFixed(1), every: 2 });
  }

  function randomBreak(text) {
    const k = 1 + Math.floor(Math.random() * 25);
    const pt = text || Caesar.sample(C.testPool, 20 + Math.floor(Math.random() * 60));
    $("breakIn").value = Caesar.encrypt(pt, k); S.trueKey = k; breakIt();
  }

  const LENGTHS = [3, 5, 8, 10, 15, 20, 30, 50, 75, 100, 200, 500];
  const MCOLORS = () => [css("--red"), css("--gold"), css("--orange"), css("--accent"), css("--green")];

  async function experiment() {
    const T = Math.min(3000, Math.max(50, +$("trials").value || 500));
    $("expBtn").disabled = true;
    const res = Caesar.METHODS.map(() => []);
    for (const L of LENGTHS) {
      const ok = Caesar.METHODS.map(() => 0);
      for (let t = 0; t < T; t++) {
        const k = 1 + Math.floor(Math.random() * 25);
        const idx = Caesar.letterIdx(Caesar.encrypt(Caesar.sample(C.testPool, L), k));
        Caesar.METHODS.forEach((m, i) => { if (m.fn(idx).key === k) ok[i]++; });
      }
      ok.forEach((v, i) => res[i].push((100 * v) / T));
      $("expProg").textContent = `length ${L} done`;
      await tick();
    }
    const col = MCOLORS();
    lines($("cSuccess"), LENGTHS.map(String), Caesar.METHODS.map((m, i) => ({ name: m.short, values: res[i], color: col[i] })), { ref: 4 });
    $("expTable").innerHTML = `<thead><tr><th>method</th>${LENGTHS.map((l) => `<th>${l}</th>`).join("")}</tr></thead><tbody>` +
      Caesar.METHODS.map((m, i) => `<tr><td>${m.name}</td>${res[i].map((v) => `<td class="mono">${v.toFixed(0)}%</td>`).join("")}</tr>`).join("") +
      `</tbody><caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">Success rate by number of letters, ${T} trials per length.</caption>`;
    $("expProg").textContent = `Done (${T} trials × ${LENGTHS.length} lengths).`;
    $("expBtn").disabled = false;
  }

  // ---------------------------------------------------------------------
  // 5. Attack on the restricted key space
  // ---------------------------------------------------------------------

  let stopFlag = false;
  function fmtTime(sec) {
    if (!isFinite(sec)) return "∞";
    if (sec < 1e-3) return `${(sec * 1e6).toFixed(0)} µs`;
    if (sec < 1) return `${(sec * 1e3).toFixed(0)} ms`;
    if (sec < 120) return `${sec.toFixed(1)} s`;
    if (sec < 7200) return `${(sec / 60).toFixed(0)} min`;
    if (sec < 2 * 86400) return `${(sec / 3600).toFixed(0)} hours`;
    if (sec < 2 * 3.156e7) return `${(sec / 86400).toFixed(0)} days`;
    const y = sec / 3.156e7;
    return y < 1e6 ? `${y.toFixed(0)} years` : `${y.toExponential(1).replace("e+", " × 10^")} years`;
  }

  async function attack() {
    stopFlag = false;
    const algo = $("atkAlgo").value, maxK = 1n << BigInt(S.bits), bar = $("atkBar");
    $("atkBtn").disabled = true;
    $("atkOut").innerHTML = `Searching d in [1, 2^${S.bits}] with ${algo === "bf" ? "exhaustive search" : "baby-step giant-step"}…`;
    let r;
    if (algo === "bf") {
      r = await ECC.bruteForce(S.kp.Q, maxK, (k, max) => { bar.style.width = `${(100 * k) / max}%`; return !stopFlag; });
    } else {
      r = await ECC.bsgs(S.kp.Q, maxK, (phase, i, M) => { bar.style.width = `${phase === "baby" ? (50 * i) / M : 50 + (50 * i) / M}%`; return !stopFlag; });
    }
    bar.style.width = r.k ? "100%" : bar.style.width;
    $("atkBtn").disabled = false;
    if (!r.k) { $("atkOut").innerHTML = r.aborted ? "Stopped." : `<span class="bad">Not found.</span>`; return; }
    if (!S.ct) await encrypt();
    const p = await ECC.decrypt(S.ct.Rhex, S.ct.chex, r.k);
    $("atkOut").innerHTML =
      `<span class="ok">Private key recovered: d = ${r.k}</span> (${r.k === S.kp.d ? "matches the real key ✓" : "different!"})\n` +
      `point additions: ${Number(r.steps).toLocaleString("en")} · time: ${fmtTime(r.ms / 1000)}` +
      (algo === "bsgs" ? ` · table of ${r.m.toLocaleString("en")} points` : "") + `\n\n` +
      `Decrypting the intercepted ciphertext (R, c) with the recovered key:\n${esc(p.text)}`;
  }

  async function bench() {
    $("benchBtn").disabled = true;
    const say = async (t) => { $("benchProg").textContent = t; await tick(); };
    const bf = [], bs = [];
    let bfSteps = 0, bfMs = 0, bsOps = 0, bsMs = 0;
    for (const B of [8, 10, 12, 14, 16, 18]) {
      await say(`exhaustive search, ${B} bits…`);
      const kp = ECC.keyGen(B), r = await ECC.bruteForce(kp.Q, 1n << BigInt(B));
      bf.push([B, r.ms / 1000]); bfSteps += Number(r.steps); bfMs += r.ms;
    }
    for (const B of [8, 12, 16, 20, 24, 28, 32]) {
      await say(`baby-step giant-step, ${B} bits…`);
      const kp = ECC.keyGen(B), r = await ECC.bsgs(kp.Q, 1n << BigInt(B));
      bs.push([B, r.ms / 1000]); if (B >= 20) { bsOps += r.steps; bsMs += r.ms; }
    }
    const bfRate = bfSteps / (bfMs / 1000), bsRate = bsOps / (bsMs / 1000);
    const tBF = (B) => 2 ** (B - 1) / bfRate, tBS = (B) => 1.5 * 2 ** (B / 2) / bsRate;
    drawBench(bf, bs, tBF, tBS);
    const rows = [20, 32, 40, 48, 64, 80, 128, 256].map((B) =>
      `<tr><td class="mono">${B}</td><td class="mono">2^${B} ≈ ${(2 ** B).toExponential(1)}</td><td>${fmtTime(tBF(B))}</td><td>${fmtTime(tBS(B))}</td><td>${fmtBytes(2 ** (B / 2) * 40)}</td></tr>`).join("");
    $("benchTable").innerHTML = `<thead><tr><th>B (bits)</th><th>keys</th><th>exhaustive search (average)</th><th>baby-step giant-step</th><th>BSGS memory</th></tr></thead><tbody>${rows}</tbody>` +
      `<caption class="muted" style="caption-side:bottom;text-align:left;padding-top:.4rem">Measured speed on this computer: ${Math.round(bfRate).toLocaleString("en")} additions/s (exhaustive search), ${Math.round(bsRate).toLocaleString("en")} additions/s (BSGS, batch-normalized). B = 256 is a real secp256k1 key.</caption>`;
    await say("Done.");
    $("benchBtn").disabled = false;
  }
  function fmtBytes(b) {
    const u = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return i === u.length - 1 && b > 1024 ? `${(b).toExponential(1)} YB` : `${b.toFixed(0)} ${u[i]}`;
  }
  function drawBench(bf, bs, tBF, tBS) {
    const cv = $("cBench"), c = setup(cv); c.m.l = 66; const { ctx, w, h, m } = c;
    const yMin = -10, yMax = 80; // log10 seconds
    const X = (B) => m.l + (B / 256) * (w - m.l - m.r), Y = (v) => h - m.b - ((v - yMin) / (yMax - yMin)) * (h - m.t - m.b);
    grid(c, yMin, yMax, (v) => `10^${v.toFixed(0)} s`, 9);
    ctx.fillStyle = css("--muted"); ctx.textAlign = "center";
    for (const B of [0, 32, 64, 96, 128, 160, 192, 224, 256]) ctx.fillText(String(B), X(B), h - m.b + 15);
    for (const [v, t] of [[0, "1 second"], [Math.log10(3.156e7), "1 year"], [Math.log10(4.35e17), "age of the universe"]]) {
      ctx.strokeStyle = css("--muted"); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(m.l, Y(v)); ctx.lineTo(w - m.r, Y(v)); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = "right"; ctx.fillText(t, X(256) - 2, Y(v) - 4);
    }
    const curve = (f, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); let first = true;
      for (let B = 4; B <= 256; B += 2) { const v = Math.log10(f(B)); if (v > yMax) break; first ? ctx.moveTo(X(B), Y(v)) : ctx.lineTo(X(B), Y(v)); first = false; } ctx.stroke(); };
    curve(tBF, css("--red")); curve(tBS, css("--green"));
    const dots = (pts, col) => { ctx.fillStyle = col; pts.forEach(([B, s]) => { ctx.beginPath(); ctx.arc(X(B), Y(Math.log10(Math.max(s, 1e-4))), 3.5, 0, 7); ctx.fill(); }); };
    dots(bf, css("--red")); dots(bs, css("--green"));
    [["exhaustive search ~ 2^B", "--red"], ["baby-step giant-step ~ 2^(B/2)", "--green"]].forEach(([t, v], i) => {
      ctx.fillStyle = css(v); ctx.fillRect(X(6), Y(74 - 7 * i) - 4, 16, 3); ctx.textAlign = "left"; ctx.fillText(t, X(6) + 22, Y(74 - 7 * i));
    });
  }

  // ---------------------------------------------------------------------
  // 6. Design weaknesses
  // ---------------------------------------------------------------------

  async function reuse() {
    const m1 = $("m1").value, m2 = $("m2").value;
    const r = 1n + ECC.randomBelow(ECC.N - 1n);
    const c1 = await ECC.encrypt(m1, S.kp.Q, { r }), c2 = await ECC.encrypt(m2, S.kp.Q, { r });
    const n = Math.min(c1.c.length, c2.c.length), m1b = new TextEncoder().encode(m1);
    const rec = new Uint8Array(n); for (let i = 0; i < n; i++) rec[i] = c1.c[i] ^ c2.c[i] ^ m1b[i];
    $("reuseOut").innerHTML =
      `R₁ = R₂ = ${short(c1.Rhex, 16)}  ← same r, visible to the attacker\n` +
      `c₁ = ${c1.chex}\nc₂ = ${c2.chex}\n\n` +
      `Attacker: m₂ = c₁ ⊕ c₂ ⊕ m₁ =\n<span class="bad">${esc(new TextDecoder().decode(rec))}</span>${m2.length > n ? `<span class="dim">… (only the first ${n} bytes, the length of m₁)</span>` : ""}\n` +
      `<span class="dim">No private key was used.</span>`;
  }

  async function malleate() {
    const msg = $("mall").value, old = $("mallOld").value;
    let neu = $("mallNew").value;
    const pos = msg.indexOf(old);
    if (pos < 0) { $("mallOut").innerHTML = `<span class="bad">"${esc(old)}" does not occur in the message.</span>`; return; }
    neu = neu.padEnd(old.length, " ").slice(0, old.length);
    const ct = await ECC.encrypt(msg, S.kp.Q), forged = ct.c.slice();
    const eo = new TextEncoder().encode(old), en = new TextEncoder().encode(neu), off = new TextEncoder().encode(msg.slice(0, pos)).length;
    for (let i = 0; i < eo.length; i++) forged[off + i] ^= eo[i] ^ en[i];
    const p = await ECC.decrypt(ct.Rhex, ECC.hex(forged), S.kp.d);
    $("mallOut").innerHTML = `original c = ${ct.chex}\nforged  c' = ${ECC.hex(forged)}\n\nThe receiver decrypts c' with the correct key d and reads:\n<span class="bad">${esc(p.text)}</span>\n<span class="dim">The attacker never knew d or the keystream.</span>`;
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  async function init() {
    const tot = C.letters.reduce((a, b) => a + b, 0);
    $("corpusInfo").innerHTML = `Training corpus: ${C.sources.join("; ")} — ${tot.toLocaleString("en")} letters. ` +
      `Test texts are taken from a different book, <em>${C.testSource}</em>, so the attack is evaluated on text the model has never seen.`;
    bars($("cEnglish"), C.letters.map((v) => v / tot), { labels: LETTERS, color: css("--accent"), yFmt: (v) => v.toFixed(2) });

    $("keygen").addEventListener("click", keygen);
    $("encBtn").addEventListener("click", encrypt);
    $("encAgain").addEventListener("click", encrypt);
    $("decBtn").addEventListener("click", () => decrypt(false));
    $("decWrong").addEventListener("click", () => decrypt(true));
    $("msg").addEventListener("input", caesarView);
    $("ck").addEventListener("input", caesarView);
    $("cmpBtn").addEventListener("click", compare);
    $("breakBtn").addEventListener("click", () => { S.trueKey = null; breakIt(); });
    $("breakRandom").addEventListener("click", () => randomBreak());
    $("special").addEventListener("change", () => { const v = $("special").value; if (v) randomBreak(SPECIAL[v]); });
    $("expBtn").addEventListener("click", experiment);
    $("atkBtn").addEventListener("click", attack);
    $("atkStop").addEventListener("click", () => { stopFlag = true; });
    $("benchBtn").addEventListener("click", bench);
    $("reuseBtn").addEventListener("click", reuse);
    $("mallBtn").addEventListener("click", malleate);

    await keygen();
    caesarView();
    breakIt();
    await compare();
    await experiment();
    await bench();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
