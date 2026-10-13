(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const H = W.toHex;
  const TEST_PHRASE = "test test test test test test test test test test test junk";
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const short = (h, n = 10) => (h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);
  const hex64 = (k) => k.toString(16).padStart(64, "0");

  function card(label, value, hint, cls = "") {
    return `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  }
  function step(num, title, chips, cls, body) {
    return `<div class="step ${cls}"><div class="step-head"><span class="num">${num}</span><h4>${title}</h4>${chips}</div>${body}</div>`;
  }
  const chip = (cls, text) => `<span class="chip ${cls}">${text}</span>`;
  const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;

  // ---------------------------------------------------------------------
  // 2. Live pipeline
  // ---------------------------------------------------------------------

  const BIP44_MEANING = [
    ["purpose", "44' = this tree follows BIP-44"],
    ["coin type", "60' = Ether (SLIP-44 registry; Bitcoin is 0')"],
    ["account", "user-level account, hardened"],
    ["change", "0 = external (receiving) chain; Ethereum wallets always use 0"],
    ["address index", "the i-th address: 0, 1, 2, …"],
  ];

  let current = null; // last derived result (used by the checker)

  async function generate(bytes) {
    const mn = await W.entropyToMnemonic(W.randomBytes(bytes));
    $("mnemonic").value = mn.words.join(" ");
    await runPipeline();
  }

  async function runPipeline() {
    const text = $("mnemonic").value, pass = $("passphrase").value, path = $("path").value.trim();
    const status = $("mnStatus");
    const chk = await W.checkMnemonic(text);
    if (!chk.ok) {
      status.innerHTML = `<span class="bad">✗ Invalid mnemonic: ${chk.reason}.</span> Real wallets refuse it.`;
      return;
    }
    let parsed;
    try { parsed = W.parsePath(path); } catch (e) { status.innerHTML = `<span class="bad">✗ ${e.message}</span>`; return; }
    status.innerHTML = `<span class="ok">✓ Valid BIP-39 mnemonic: ${chk.words.length} words, ${chk.ENT} bits of entropy + ${chk.CS}-bit checksum.</span>`;

    const mn = await W.entropyToMnemonic(chk.entropy);
    const seed = await W.mnemonicToSeed(text, pass);
    const der = await W.derivePath(seed, path);
    const k = der.node.k;
    const A = W.addressFromPrivateKey(k);
    const C = W.toChecksumAddress(A.addr);
    current = { addr: C.checksummed };

    let html = "";

    // 1. entropy
    const entBin = mn.entBits.match(/.{1,8}/g).join(" ");
    html += step("Step 1", "Entropy", chip("gen", "key generation"), "gen",
      `<p>${mn.ENT} random bits produced by a cryptographically secure random number generator. This is the <b>only</b> random step: everything below is a deterministic function of these bits.</p>` +
      kv([["entropy (hex)", H(chk.entropy)], ["entropy (bits)", entBin]]));

    // 2. mnemonic
    const hashHex = H(mn.hash);
    const words = mn.words.map((w, i) => {
      const g = mn.groups[i];
      const last = i === mn.words.length - 1;
      const bits = last ? `${g.slice(0, 11 - mn.CS)}<span class="cs">${g.slice(11 - mn.CS)}</span>` : g;
      return `<div class="word ${last ? "last" : ""}"><span class="dim">${i + 1}.</span> <b>${w}</b><span class="bits">#${mn.indices[i]} · ${bits}</span></div>`;
    }).join("");
    html += step("Step 2", "BIP-39 mnemonic", chip("enc", "encoding") + chip("chk", "checksum"), "chk",
      `<p>The checksum is the first ENT/32 = <b>${mn.CS} bits</b> of SHA-256(entropy). Entropy + checksum = ${mn.ENT + mn.CS} bits are cut into ${mn.words.length} groups of 11 bits; each group (0–2047) is an index into the 2048-word list. The checksum bits (green) end up inside the last word.</p>` +
      kv([["SHA-256(entropy)", `<span class="cs">${hashHex.slice(0, 2)}</span>${hashHex.slice(2)}`],
          ["checksum bits", `<span class="cs">${mn.csBits}</span>`]]) +
      `<div class="words">${words}</div>`);

    // 3. seed
    html += step("Step 3", "BIP-39 seed", chip("der", "key derivation"), "der",
      `<p><code>seed = PBKDF2-HMAC-SHA512(password = mnemonic, salt = "mnemonic" + passphrase, 2048 iterations, 64 bytes)</code>. The 2048 iterations make brute-forcing a phrase slower (key stretching). A different passphrase gives a completely different, equally valid wallet.</p>` +
      kv([["salt", `"mnemonic${pass.replace(/</g, "&lt;")}"`], ["seed (512 bits)", H(seed)]]));

    // 4. master key
    const m = der.steps[0].node;
    html += step("Step 4", "BIP-32 master key", chip("der", "key derivation"), "der",
      `<p><code>I = HMAC-SHA512(key = "Bitcoin seed", data = seed)</code>. The left 256 bits are the master private key, the right 256 bits the <em>chain code</em>, extra entropy that every child derivation needs.</p>` +
      kv([["master private key I<sub>L</sub>", hex64(m.k)], ["master chain code I<sub>R</sub>", H(m.c)]]));

    // 5. path
    const isBip44 = parsed.length === 5;
    let rows = `<thead><tr><th>level</th><th>meaning</th><th>type</th><th>HMAC data</th><th>child private key</th><th>chain code</th></tr></thead><tbody>`;
    der.steps.slice(1).forEach((s, i) => {
      const [name, desc] = isBip44 ? BIP44_MEANING[i] : [`level ${i + 1}`, ""];
      rows += `<tr><td class="mono">${s.label}</td><td><b>${name}</b><br><span class="dim">${desc}</span></td>` +
        `<td>${s.node.hardened ? "hardened" : "normal"}</td>` +
        `<td class="mono nowrap">${s.node.hardened ? "0x00 ‖ k<sub>parent</sub> ‖ i" : "K<sub>parent</sub> (33 B) ‖ i"}</td>` +
        `<td class="mono">${short(hex64(s.node.k), 8)}</td><td class="mono">${short(H(s.node.c), 8)}</td></tr>`;
    });
    html += step("Step 5", `BIP-32 / BIP-44 path ${path}`, chip("der", "key derivation"), "der",
      `<p>At each level <code>I = HMAC-SHA512(chain code, data)</code> and <code>k<sub>child</sub> = (I<sub>L</sub> + k<sub>parent</sub>) mod n</code>. <b>Hardened</b> levels (') hash the parent <em>private</em> key, so a leaked child key cannot be combined with the parent's extended public key to recover the parent. <b>Normal</b> levels hash the parent <em>public</em> key, which lets a watch-only wallet derive child public keys without any secret.</p>` +
      `<div class="table-wrap"><table>${rows}</tbody></table></div>`);

    // 6. secp256k1
    html += step("Step 6", "secp256k1 public key", chip("pk", "public-key crypto"), "pk",
      `<p><code>Q = k · G</code> on the curve y² = x³ + 7 over the 256-bit prime field: the same scalar multiplication of Homework 1, with 256-bit numbers (double-and-add).</p>` +
      kv([["private key k", hex64(k)],
          ["Q.x", hex64(A.Q.x)], ["Q.y", hex64(A.Q.y)],
          ["on the curve?", W.isOnCurve(A.Q) ? `<span class="ok">yes ✓</span>` : `<span class="bad">no</span>`],
          ["compressed (33 B)", H(W.pubCompressed(A.Q))]]));

    // 7. keccak
    const hh = H(A.hash);
    html += step("Step 7", "Keccak-256 → address", chip("hash", "hashing") + chip("enc", "encoding (hex)"), "hash",
      `<p>Hash the 64 bytes x ‖ y with Keccak-256 and keep the <b>last 20 bytes</b> (160 bits). The address is a short, uniform fingerprint of the public key.</p>` +
      kv([["input x ‖ y (64 B)", short(H(A.pub), 24)],
          ["Keccak-256", `<span class="dim">${hh.slice(0, 24)}</span><span class="hl">${hh.slice(24)}</span>`],
          ["address", `0x${A.addr}`]]));

    // 8. EIP-55
    let r1 = `<td class="lbl">address</td>`, r2 = `<td class="lbl">hash nibble</td>`, r3 = `<td class="lbl">result</td>`;
    for (let i = 0; i < 40; i++) {
      const c = C.lower[i], n = C.hashHex[i], letter = /[a-f]/.test(c), up = letter && parseInt(n, 16) >= 8;
      r1 += `<td>${c}</td>`;
      r2 += `<td class="${letter ? (up ? "up" : "") : "dim"}">${n}</td>`;
      r3 += `<td class="${up ? "up" : letter ? "" : "dim"}">${up ? c.toUpperCase() : c}</td>`;
    }
    const letters = [...C.lower].filter((c) => /[a-f]/.test(c)).length;
    html += step("Step 8", "EIP-55 checksum", chip("chk", "checksum") + chip("enc", "encoding"), "chk",
      `<p>Compute Keccak-256 of the <em>lowercase hex string</em> (as ASCII text). For each letter a–f of the address: write it in UPPERCASE if the hash nibble in the same position is ≥ 8. Digits carry no information, so this address has <b>${letters} check bits</b>.</p>` +
      kv([["Keccak-256(\"" + C.lower.slice(0, 6) + "…\")", C.hashHex]]) +
      `<div class="nibbles"><table><tr>${r1}</tr><tr>${r2}</tr><tr>${r3}</tr></table></div>` +
      `<div class="final">Checksummed Ethereum address<br><span class="big">${C.checksummed}</span></div>`);

    $("steps").innerHTML = html;
    if (!$("addrIn").value) { $("addrIn").value = C.checksummed; checkAddr(); }

    // first accounts on m/44'/60'/0'/0/i
    const base = (await W.derivePath(seed, "m/44'/60'/0'/0")).node;
    let acc = `<thead><tr><th>path</th><th>address (EIP-55)</th><th>private key</th></tr></thead><tbody>`;
    for (let i = 0; i < 5; i++) {
      const c = await W.childKey(base, i);
      acc += `<tr><td class="mono">m/44'/60'/0'/0/${i}</td><td class="mono">${W.toChecksumAddress(W.addressFromPrivateKey(c.k).addr).checksummed}</td><td class="mono">${short(hex64(c.k), 8)}</td></tr>`;
    }
    $("accounts").innerHTML = acc + "</tbody>";
  }

  // ---------------------------------------------------------------------
  // 3. Address checker
  // ---------------------------------------------------------------------

  function checkAddr() {
    const a = $("addrIn").value.trim();
    const r = W.checkAddress(a);
    let out = `${r.ok ? "✓" : "✗"} ${r.reason}`;
    if (/^0x[0-9a-fA-F]{40}$/.test(a)) out += `\n\nexpected: ${W.toChecksumAddress(a).checksummed}\ngiven:    ${a}`;
    $("addrOut").innerHTML = `<span class="${r.ok ? "ok" : "bad"}">${out}</span>`;
  }

  function typo(addr) {
    const pos = 2 + Math.floor(Math.random() * 40);
    const old = addr[pos].toLowerCase();
    let c;
    do c = "0123456789abcdef"[Math.floor(Math.random() * 16)]; while (c === old);
    if (/[a-f]/.test(c) && Math.random() < 0.5) c = c.toUpperCase();
    return { addr: addr.slice(0, pos) + c + addr.slice(pos + 1), pos };
  }

  // ---------------------------------------------------------------------
  // 4. Hash comparison
  // ---------------------------------------------------------------------

  async function hashTable() {
    const t = $("hashIn").value, b = new TextEncoder().encode(t);
    const rows = [
      ["SHA-256", "SHA-2 · Merkle–Damgård", H(await W.sha256(b))],
      ["SHA-512", "SHA-2 · Merkle–Damgård", H(await W.sha512(b))],
      ["SHA3-256", "FIPS 202 · sponge, padding 0x06", H(W.sha3_256(b))],
      ["Keccak-256", "Ethereum · sponge, padding 0x01", H(W.keccak256(b))],
    ];
    $("hashTable").innerHTML = `<thead><tr><th>function</th><th>family</th><th>digest of "${t.replace(/</g, "&lt;")}"</th></tr></thead><tbody>` +
      rows.map(([n, f, d]) => `<tr><td><b>${n}</b></td><td>${f}</td><td class="mono">${d}</td></tr>`).join("") + "</tbody>";
  }

  // ---------------------------------------------------------------------
  // 7. Statistics
  // ---------------------------------------------------------------------

  // --- math helpers
  function lnGamma(z) {
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1; let x = c[0];
    for (let i = 1; i < 9; i++) x += c[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function gammaQ(s, x) {
    if (x <= 0) return 1;
    if (x < s + 1) {
      let sum = 1 / s, term = sum;
      for (let n = 1; n < 1000; n++) { term *= x / (s + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break; }
      return 1 - sum * Math.exp(-x + s * Math.log(x) - lnGamma(s));
    }
    let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - s); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return Math.exp(-x + s * Math.log(x) - lnGamma(s)) * h;
  }
  function chi2(counts) {
    const tot = counts.reduce((a, b) => a + b, 0), E = tot / counts.length;
    const x = counts.reduce((a, o) => a + (o - E) ** 2 / E, 0), df = counts.length - 1;
    return { x, df, p: gammaQ(df / 2, x / 2) };
  }
  function pearson(a, b) {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return sab / Math.sqrt(saa * sbb);
  }
  const POP = new Uint8Array(256).map((_, i) => { let c = 0, v = i; while (v) { c += v & 1; v >>= 1; } return c; });
  const hd = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += POP[a[i] ^ b[i]]; return d; };
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); };
  function binomPmf(n, p) {
    const out = []; let lc = 0;
    for (let k = 0; k <= n; k++) {
      if (k > 0) lc += Math.log(n - k + 1) - Math.log(k);
      out.push(Math.exp(lc + k * Math.log(p) + (n - k) * Math.log(1 - p)));
    }
    return out;
  }
  const fmtP = (p) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(3));
  const verdict = (p) => (p < 0.01 ? `<span class="bad">reject uniformity, p = ${fmtP(p)}</span>` : `<span class="ok">consistent with uniform, p = ${fmtP(p)}</span>`);

  // --- tiny canvas charts
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    return { ctx, w, h, m: { l: 46, r: 10, t: 12, b: 26 } };
  }
  function axes(c, yMin, yMax, xTicks, yFmt) {
    const { ctx, w, h, m } = c;
    ctx.strokeStyle = css("--border"); ctx.fillStyle = css("--muted"); ctx.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = h - m.b - f * (h - m.t - m.b), v = yMin + f * (yMax - yMin);
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(yFmt ? yFmt(v) : +v.toPrecision(3), m.l - 6, y + 4);
    }
    ctx.textAlign = "center";
    for (const [x, t] of xTicks) ctx.fillText(t, x, h - m.b + 15);
  }
  // values: array; opts: color, ref (horizontal line), line (overlay array), yMin, yMax, tickEvery, x0 (label of first bar)
  function barChart(cv, values, o = {}) {
    const c = setup(cv), { ctx, w, h, m } = c, n = values.length;
    const yMin = o.yMin ?? 0;
    const yMax = o.yMax ?? Math.max(...values, ...(o.line || []), o.ref ?? 0) * 1.12;
    const bw = (w - m.l - m.r) / n;
    const X = (i) => m.l + i * bw, Y = (v) => h - m.b - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * (h - m.t - m.b);
    const every = o.tickEvery || Math.ceil(n / 8), ticks = [];
    for (let i = 0; i < n; i += every) ticks.push([X(i) + bw / 2, String((o.x0 || 0) + i)]);
    axes(c, yMin, yMax, ticks, o.yFmt);
    ctx.fillStyle = o.color || css("--accent");
    const gap = bw > 4 ? Math.min(2, bw * 0.15) : 0;
    values.forEach((v, i) => ctx.fillRect(X(i) + gap / 2, Y(v), Math.max(bw - gap, 0.6), Y(yMin) - Y(v)));
    if (o.ref != null) {
      ctx.strokeStyle = css("--red"); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(m.l, Y(o.ref)); ctx.lineTo(w - m.r, Y(o.ref)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (o.line) {
      ctx.strokeStyle = css("--red"); ctx.lineWidth = 2; ctx.beginPath();
      o.line.forEach((v, i) => { const x = X(i) + bw / 2, y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
  function scatterChart(cv, xs, ys, xMax, yMax) {
    const c = setup(cv), { ctx, w, h, m } = c;
    const X = (v) => m.l + (v / xMax) * (w - m.l - m.r), Y = (v) => h - m.b - (v / yMax) * (h - m.t - m.b);
    const ticks = []; for (let v = 0; v <= xMax; v += Math.ceil(xMax / 5)) ticks.push([X(v), String(v)]);
    axes(c, 0, yMax, ticks, (v) => v.toFixed(2));
    ctx.fillStyle = css("--accent");
    xs.forEach((x, i) => ctx.fillRect(X(x) - 1, Y(ys[i]) - 1, 2.2, 2.2));
  }
  // histogram of integer values in [0, n] restricted to a window [lo, hi]
  function window_(hist, lo, hi) { return hist.slice(lo, hi + 1); }

  async function runStats() {
    const btn = $("runStats"); btn.disabled = true;
    const prog = $("progress");
    const say = async (t) => { prog.textContent = t; await tick(); };
    const Nh = Math.min(100000, Math.max(500, +$("nHash").value || 20000));
    const Na = Math.min(5000, Math.max(100, +$("nAddr").value || 1000));
    const Nm = Math.min(100000, Math.max(1000, +$("nMn").value || 20000));
    const M = {}; // metrics

    try {
      // A, B — Keccak bit balance and byte values on random inputs
      await say("Keccak-256 on random inputs…");
      const bitOnes = new Float64Array(256), bytes = new Array(256).fill(0);
      for (let t = 0; t < Nh; t++) {
        const d = W.keccak256(W.randomBytes(32));
        for (let j = 0; j < 32; j++) { const v = d[j]; bytes[v]++; for (let b = 0; b < 8; b++) if ((v >> (7 - b)) & 1) bitOnes[8 * j + b]++; }
        if (t % 4000 === 0) await tick();
      }
      const bitFreq = Array.from(bitOnes, (v) => v / Nh);
      M.ones = mean(bitFreq); M.maxDev = Math.max(...bitFreq.map((f) => Math.abs(f - 0.5)));
      M.chiBytes = chi2(bytes);

      // C — avalanche on Keccak
      await say("Avalanche test…");
      const aval = new Array(257).fill(0), avalV = [];
      const Nav = Math.min(Nh, 10000);
      for (let t = 0; t < Nav; t++) {
        const x = W.randomBytes(32), y = x.slice(); const bit = Math.floor(Math.random() * 256);
        y[bit >> 3] ^= 1 << (bit & 7);
        const d = hd(W.keccak256(x), W.keccak256(y)); aval[d]++; avalV.push(d);
        if (t % 3000 === 0) await tick();
      }
      M.aval = { m: mean(avalV), s: sd(avalV) };

      // D — structured inputs 0, 1, 2, …
      await say("Structured inputs…");
      const Ns = Math.min(Nh, 5000), seqI = [], seqV = [], seqBytes = new Array(256).fill(0);
      for (let i = 0; i < Ns; i++) {
        const d = W.keccak256(W.bigToBytes(BigInt(i), 32));
        seqI.push(i); seqV.push(((d[0] << 24) >>> 0) / 2 ** 32 + d[1] / 2 ** 24 + d[2] / 2 ** 32);
        for (const v of d) seqBytes[v]++;
      }
      M.seqR = pearson(seqI, seqV); M.seqChi = chi2(seqBytes);

      // E, F, H — addresses from random private keys
      await say(`Deriving ${Na} addresses (secp256k1 + Keccak-256)…`);
      const hexCount = new Array(16).fill(0), letters = new Array(41).fill(0), keyAval = new Array(161).fill(0), keyAvalV = [];
      let upper = 0, letterTot = 0;
      const NkAval = Math.min(Na, 500);
      for (let t = 0; t < Na; t++) {
        let k; do k = W.bytesToBig(W.randomBytes(32)); while (k === 0n || k >= W.N);
        const A = W.addressFromPrivateKey(k);
        for (const ch of A.addr) hexCount[parseInt(ch, 16)]++;
        const C = W.toChecksumAddress(A.addr), body = C.checksummed.slice(2);
        const L = [...body].filter((c) => /[a-fA-F]/.test(c)).length;
        letters[L]++; letterTot += L; upper += [...body].filter((c) => /[A-F]/.test(c)).length;
        if (t < NkAval) {
          const bit = Math.floor(Math.random() * 256), k2 = k ^ (1n << BigInt(bit));
          if (k2 > 0n && k2 < W.N) {
            const d = hd(A.hash.slice(12), W.addressFromPrivateKey(k2).hash.slice(12));
            keyAval[d]++; keyAvalV.push(d);
          }
        }
        if (t % 50 === 0) await say(`Deriving addresses… ${t}/${Na}`);
      }
      M.hexChi = chi2(hexCount);
      M.letters = letterTot / Na; M.upperShare = upper / letterTot;
      M.keyAval = { m: mean(keyAvalV), s: sd(keyAvalV) };

      // EIP-55 typo detection: one typo on each of Nh fresh addresses.
      // Addresses are uniform 160-bit strings (experiment E), so random bytes are a valid model here.
      await say("EIP-55 typo detection…");
      const T = { tot: 0, detected: 0, chance: 0, single: 0 };
      for (let t = 0; t < Nh; t++) {
        const C = W.toChecksumAddress(H(W.randomBytes(20)));
        const body = C.checksummed.slice(2);
        const ty = typo(C.checksummed), chk = W.checkAddress(ty.addr);
        T.tot++;
        if (!chk.ok) T.detected++;
        else if (body === body.toLowerCase() || body === body.toUpperCase()) T.single++; // original had no mixed case
        else T.chance++;
        if (t % 4000 === 0) await say(`EIP-55 typo detection… ${t}/${Nh}`);
      }
      M.typo = T;

      // G — BIP-32 sibling keys
      await say("BIP-32 sibling keys…");
      const mn = await W.entropyToMnemonic(W.randomBytes(16));
      const seed = await W.mnemonicToSeed(mn.words.join(" "));
      const parent = (await W.derivePath(seed, "m/44'/60'/0'/0")).node;
      const Nc = Math.min(Na, 300), childHD = new Array(257).fill(0), childV = [], childI = [], childTop = [];
      let prev = null;
      for (let i = 0; i < Nc; i++) {
        const c = await W.childKey(parent, i), kb = W.bigToBytes(c.k);
        childI.push(i); childTop.push(((kb[0] << 24) >>> 0) + (kb[1] << 16) + (kb[2] << 8) + kb[3]);
        if (prev) { const d = hd(prev, kb); childHD[d]++; childV.push(d); }
        prev = kb;
        if (i % 50 === 0) await say(`BIP-32 sibling keys… ${i}/${Nc}`);
      }
      M.child = { m: mean(childV), s: sd(childV), r: pearson(childI, childTop) };

      // BIP-39 — random words and generated mnemonics
      await say("BIP-39 checksums of random phrases…");
      const list = window.BIP39_WORDLIST;
      let valid = 0;
      for (let t = 0; t < Nm; t++) {
        const idx = Array.from({ length: 12 }, () => Math.floor(Math.random() * 2048));
        const r = await W.checkMnemonic(idx.map((i) => list[i]).join(" "));
        if (r.ok) valid++;
        if (t % 2000 === 0) await say(`BIP-39 checksums of random phrases… ${t}/${Nm}`);
      }
      M.valid = valid / Nm;
      await say("Word usage in generated mnemonics…");
      const wordCount = new Array(2048).fill(0), Ng = Math.min(Nm, 10000);
      for (let t = 0; t < Ng; t++) {
        const g = await W.entropyToMnemonic(W.randomBytes(16));
        g.indices.forEach((i) => wordCount[i]++);
        if (t % 2000 === 0) await say(`Word usage… ${t}/${Ng}`);
      }
      M.wordChi = chi2(wordCount);

      // ---------- metrics ----------
      const se = Math.sqrt(0.0625 * 0.9375 / Nm);
      $("metrics").innerHTML =
        card("A · bit balance", M.ones.toFixed(5), `mean fraction of 1s over 256 positions; largest deviation ${M.maxDev.toFixed(4)} = ${(M.maxDev / (0.5 / Math.sqrt(Nh))).toFixed(1)}σ (with 256 positions, ≈ 3σ is expected)`) +
        card("B · χ² byte values", `${M.chiBytes.x.toFixed(1)} (df ${M.chiBytes.df})`, verdict(M.chiBytes.p)) +
        card("C · avalanche", `${M.aval.m.toFixed(2)} ± ${M.aval.s.toFixed(2)}`, `bits changed out of 256; ideal 128 ± 8`) +
        card("D · structured inputs", `r = ${M.seqR.toFixed(4)}`, `χ² bytes: ${verdict(M.seqChi.p)}`) +
        card("E · hex digits", `χ² = ${M.hexChi.x.toFixed(1)} (df 15)`, verdict(M.hexChi.p)) +
        card("F · key → address", `${M.keyAval.m.toFixed(2)} ± ${M.keyAval.s.toFixed(2)}`, `address bits changed out of 160; ideal 80 ± 6.3`) +
        card("G · sibling keys", `${M.child.m.toFixed(2)} ± ${M.child.s.toFixed(2)}`, `bits differing out of 256 (ideal 128 ± 8); r(i, key) = ${M.child.r.toFixed(3)}`) +
        card("H · EIP-55 letters", M.letters.toFixed(2), `check bits per address (ideal 15); uppercase share ${(100 * M.upperShare).toFixed(1)}% (ideal 50%)`) +
        card("Typos detected", `${(100 * M.typo.detected / M.typo.tot).toFixed(3)}%`,
          `of ${M.typo.tot} single-character typos. Missed: ${M.typo.chance} by chance (theory ≈ 0.0245%) + ${M.typo.single} on addresses with no mixed case (theory ≈ 0.049%)`) +
        card("Valid random phrases", `${(100 * M.valid).toFixed(2)}%`, `theory 1/16 = 6.25% (95% CI ${(100 * (0.0625 - 1.96 * se)).toFixed(2)}–${(100 * (0.0625 + 1.96 * se)).toFixed(2)}%)`) +
        card("I · χ² word usage", `${M.wordChi.x.toFixed(0)} (df 2047)`, verdict(M.wordChi.p));

      // ---------- charts ----------
      const blue = css("--accent"), green = css("--green"), orange = css("--orange"), purple = css("--purple");
      barChart($("cBits"), bitFreq, { color: blue, ref: 0.5, yMin: 0.45, yMax: 0.55, tickEvery: 32 });
      barChart($("cBytes"), bytes, { color: orange, ref: (Nh * 32) / 256, tickEvery: 32 });
      const lo = 96, hi = 160;
      barChart($("cAval"), window_(aval, lo, hi).map((v) => v / Nav), { color: blue, line: window_(binomPmf(256, 0.5), lo, hi), x0: lo, tickEvery: 8 });
      scatterChart($("cSeq"), seqI, seqV, Ns, 1);
      barChart($("cHex"), hexCount.map((v) => v / (40 * Na)), { color: green, ref: 1 / 16, yMin: 0, yMax: 0.09, tickEvery: 1, yFmt: (v) => v.toFixed(3) });
      // relabel hex x-axis with 0-f
      const lo2 = 50, hi2 = 110;
      barChart($("cKeyAval"), window_(keyAval, lo2, hi2).map((v) => v / keyAvalV.length), { color: purple, line: window_(binomPmf(160, 0.5), lo2, hi2), x0: lo2, tickEvery: 10 });
      barChart($("cChildHD"), window_(childHD, lo, hi).map((v) => v / childV.length), { color: blue, line: window_(binomPmf(256, 0.5), lo, hi), x0: lo, tickEvery: 8 });
      barChart($("cCase"), window_(letters, 0, 30).map((v) => v / Na), { color: green, line: window_(binomPmf(40, 6 / 16), 0, 30), tickEvery: 5 });
      barChart($("cWords"), wordCount, { color: orange, ref: (12 * Ng) / 2048, tickEvery: 256 });
      prog.textContent = "Done.";
    } catch (e) {
      prog.textContent = "Error: " + e.message;
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  function init() {
    $("gen12").addEventListener("click", () => generate(16));
    $("gen24").addEventListener("click", () => generate(32));
    $("useTest").addEventListener("click", () => { $("mnemonic").value = TEST_PHRASE; $("passphrase").value = ""; $("path").value = "m/44'/60'/0'/0/0"; runPipeline(); });
    $("runPipe").addEventListener("click", runPipeline);
    $("passphrase").addEventListener("change", runPipeline);
    $("path").addEventListener("change", runPipeline);
    $("mnemonic").addEventListener("change", runPipeline);

    $("addrCheck").addEventListener("click", checkAddr);
    $("addrIn").addEventListener("input", checkAddr);
    $("addrTypo").addEventListener("click", () => {
      const base = current ? current.addr : $("addrIn").value;
      const t = typo(base);
      $("addrIn").value = t.addr;
      checkAddr();
      $("addrOut").innerHTML += `\n<span class="dim">(typo at character ${t.pos - 1}: "${base[t.pos]}" → "${t.addr[t.pos]}")</span>`;
    });

    $("hashIn").addEventListener("input", hashTable);
    hashTable();

    $("runStats").addEventListener("click", runStats);

    $("mnemonic").value = TEST_PHRASE;
    runPipeline().then(runStats);
  }

  document.addEventListener("DOMContentLoaded", init);
})();