/* secp256k1 arithmetic, a toy ECIES-like encryption scheme with a restricted
   private-key range, and two key-recovery attacks (exhaustive search and
   baby-step giant-step). */

(function (root) {
  "use strict";

  const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const G = {
    x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
    y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,
  };
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---------------------------------------------------------------------
  // Field and point arithmetic (Jacobian coordinates: x = X/Z², y = Y/Z³)
  // ---------------------------------------------------------------------

  const md = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
  function inv(a, m = P) {
    let r0 = md(a, m), r1 = m, s0 = 1n, s1 = 0n;
    while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return md(s0, m);
  }
  const INF = [0n, 1n, 0n];

  function jDouble(J) {
    const [X, Y, Z] = J;
    if (Z === 0n || Y === 0n) return INF;
    const A = md(X * X), B = md(Y * Y), C = md(B * B);
    const D = md(2n * (md((X + B) * (X + B)) - A - C));
    const E = md(3n * A), F = md(E * E), X3 = md(F - 2n * D);
    return [X3, md(E * (D - X3) - 8n * C), md(2n * Y * Z)];
  }
  // Jacobian + affine
  function jAdd(J, Q) {
    const [X1, Y1, Z1] = J;
    if (Q === null) return J;
    if (Z1 === 0n) return [Q.x, Q.y, 1n];
    const Z1Z1 = md(Z1 * Z1), U2 = md(Q.x * Z1Z1), S2 = md(Q.y * Z1 * Z1Z1);
    const H = md(U2 - X1), R = md(S2 - Y1);
    if (H === 0n) return R === 0n ? jDouble(J) : INF;
    const HH = md(H * H), HHH = md(H * HH), V = md(X1 * HH), X3 = md(R * R - HHH - 2n * V);
    return [X3, md(R * (V - X3) - Y1 * HHH), md(Z1 * H)];
  }
  function toAffine(J) {
    if (J[2] === 0n) return null;
    const zi = inv(J[2]), zi2 = md(zi * zi);
    return { x: md(J[0] * zi2), y: md(J[1] * zi2 * zi) };
  }
  // Montgomery's trick: normalize many Jacobian points with a single inversion
  function batchAffine(list) {
    const n = list.length, pref = new Array(n);
    let acc = 1n;
    for (let i = 0; i < n; i++) { pref[i] = acc; acc = md(acc * list[i][2]); }
    let ia = inv(acc);
    const out = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      const zi = md(ia * pref[i]); ia = md(ia * list[i][2]);
      const zi2 = md(zi * zi);
      out[i] = { x: md(list[i][0] * zi2), y: md(list[i][1] * zi2 * zi) };
    }
    return out;
  }
  function mul(k, Pt = G) {
    k = md(BigInt(k), N);
    if (k === 0n || Pt === null) return null;
    let J = INF;
    for (const bit of k.toString(2)) { J = jDouble(J); if (bit === "1") J = jAdd(J, Pt); }
    return toAffine(J);
  }
  const neg = (Pt) => (Pt === null ? null : { x: Pt.x, y: md(-Pt.y) });
  const eq = (A, B) => (A === null || B === null ? A === B : A.x === B.x && A.y === B.y);
  const isOnCurve = (Pt) => md(Pt.y * Pt.y - Pt.x ** 3n - 7n) === 0n;

  // ---------------------------------------------------------------------
  // Encoding helpers
  // ---------------------------------------------------------------------

  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  function unhex(h) {
    h = h.replace(/^0x/i, "").replace(/\s+/g, "");
    const out = new Uint8Array(h.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
    return out;
  }
  const big32 = (n) => unhex(n.toString(16).padStart(64, "0"));
  const compress = (Pt) => (Pt.y & 1n ? "03" : "02") + Pt.x.toString(16).padStart(64, "0");
  function decompress(h) {
    h = h.replace(/^0x/i, "");
    const x = BigInt("0x" + h.slice(2)), want = parseInt(h.slice(0, 2), 16) & 1;
    const y2 = md(x ** 3n + 7n);
    let y = 1n, b = y2, e = (P + 1n) / 4n; // P ≡ 3 mod 4, so sqrt = y2^((P+1)/4)
    while (e) { if (e & 1n) y = md(y * b); b = md(b * b); e >>= 1n; }
    if (md(y * y) !== y2) throw new Error("x is not on the curve");
    if (Number(y & 1n) !== want) y = P - y;
    return { x, y };
  }
  function randomBelow(max) { // uniform in [0, max)
    const bytes = Math.ceil(max.toString(16).length / 2) + 8;
    const r = BigInt("0x" + hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes))));
    return r % max;
  }

  // ---------------------------------------------------------------------
  // Toy scheme (ECIES-like): key agreement on secp256k1 + SHA-256 keystream
  // ---------------------------------------------------------------------

  // private key d in [1, 2^bits]
  function keyGen(bits) {
    const d = 1n + randomBelow(1n << BigInt(bits));
    return { d, Q: mul(d) };
  }
  // keystream_i = SHA-256(S.x || i), concatenated and truncated
  async function keystream(S, len) {
    const out = new Uint8Array(len), sx = big32(S.x);
    for (let i = 0, off = 0; off < len; i++, off += 32) {
      const block = new Uint8Array(36); block.set(sx); new DataView(block.buffer).setUint32(32, i);
      const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", block));
      out.set(h.slice(0, Math.min(32, len - off)), off);
    }
    return out;
  }
  // r: optional fixed ephemeral key (to demonstrate nonce reuse); rBits: restricted ephemeral range
  async function encrypt(msg, Q, { r = null, rBits = null } = {}) {
    if (r === null) r = rBits ? 1n + randomBelow(1n << BigInt(rBits)) : 1n + randomBelow(N - 1n);
    const R = mul(r), S = mul(r, Q);
    const m = typeof msg === "string" ? enc.encode(msg) : msg;
    const ks = await keystream(S, m.length);
    const c = m.map((b, i) => b ^ ks[i]);
    return { r, R, S, ks, c, Rhex: compress(R), chex: hex(c) };
  }
  async function decrypt(Rhex, chex, d) {
    const R = decompress(Rhex), S = mul(d, R), c = unhex(chex);
    const ks = await keystream(S, c.length);
    const m = c.map((b, i) => b ^ ks[i]);
    return { S, ks, m, text: dec.decode(m) };
  }

  // ---------------------------------------------------------------------
  // Attacks on the restricted key space
  // ---------------------------------------------------------------------

  const pause = () => new Promise((r) => setTimeout(r, 0));

  /* Exhaustive search: walk G, 2G, 3G, ... and compare with the target.
     The comparison is done in Jacobian coordinates (X == x·Z², Y == y·Z³)
     to avoid an inversion per step. */
  async function bruteForce(target, maxK, onProgress) {
    const t0 = performance.now();
    let J = [G.x, G.y, 1n];
    for (let k = 1n; k <= maxK; k++) {
      const Z2 = md(J[2] * J[2]);
      if (J[0] === md(target.x * Z2) && J[1] === md(target.y * Z2 * J[2])) {
        return { k, steps: k, ms: performance.now() - t0 };
      }
      J = jAdd(J, G);
      if ((k & 0x3FFFn) === 0n) {
        if (onProgress && onProgress(Number(k), Number(maxK)) === false) return { k: null, steps: k, ms: performance.now() - t0, aborted: true };
        await pause();
      }
    }
    return { k: null, steps: maxK, ms: performance.now() - t0 };
  }

  /* Baby-step giant-step for k in [1, maxK]:
     write k = i·m + j with m = ceil(sqrt(maxK)), 0 <= j < m.
     Baby steps: store x(jG) for j = 1..m.  Giant steps: Q - i·(mG), look it up.
     About 2·sqrt(maxK) point operations instead of maxK, at the cost of
     storing sqrt(maxK) points. */
  async function bsgs(target, maxK, onProgress) {
    const t0 = performance.now();
    let m = 1n; while (m * m < maxK) m <<= 1n; // power of two >= sqrt(maxK) is fine
    // m = smallest power of two with m^2 >= maxK, refined by integer sqrt
    { let lo = 1n, hi = m; while (lo < hi) { const mid = (lo + hi) >> 1n; if (mid * mid >= maxK) hi = mid; else lo = mid + 1n; } m = lo; }
    const M = Number(m), CH = 2048, mask = (1n << 48n) - 1n;
    const table = new Map();
    if (eq(target, null)) return { k: null };
    // baby steps
    let J = [G.x, G.y, 1n], ops = 0;
    for (let start = 1; start <= M; start += CH) {
      const batch = [];
      for (let j = start; j < Math.min(start + CH, M + 1); j++) { batch.push(J); J = jAdd(J, G); ops++; }
      batchAffine(batch).forEach((A, i) => table.set(Number(A.x & mask), start + i));
      if (onProgress && onProgress("baby", start, M) === false) return { k: null, aborted: true };
      await pause();
    }
    if (table.has(Number(target.x & mask))) { // target = jG or -jG
      const j = BigInt(table.get(Number(target.x & mask)));
      if (eq(mul(j), target)) return { k: j, steps: ops, ms: performance.now() - t0, m: M };
    }
    // giant steps: target - i·mG
    const minusMG = neg(mul(m));
    J = jAdd([target.x, target.y, 1n], minusMG);
    for (let i = 1; i <= M; i += CH) {
      const batch = [];
      for (let ii = i; ii < Math.min(i + CH, M + 1); ii++) { batch.push(J); J = jAdd(J, minusMG); ops++; }
      const idx = [], pts = [];
      batch.forEach((b, t) => {
        if (b[2] === 0n) { // target - (i+t)·mG = O  =>  k = (i+t)·m
          const cand = BigInt(i + t) * m;
          if (eq(mul(cand), target)) idx.push(-1), pts.push(cand);
        } else { idx.push(t); pts.push(b); }
      });
      const found = pts.find((p, q) => idx[q] === -1);
      if (found !== undefined) return { k: found, steps: ops, ms: performance.now() - t0, m: M };
      const aff = batchAffine(pts);
      for (let q = 0; q < aff.length; q++) {
        const j = table.get(Number(aff[q].x & mask));
        if (j !== undefined) {
          const t = idx[q];
          for (const cand of [BigInt(i + t) * m + BigInt(j), BigInt(i + t) * m - BigInt(j)]) {
            if (cand > 0n && eq(mul(cand), target)) return { k: cand, steps: ops, ms: performance.now() - t0, m: M };
          }
        }
      }
      if (onProgress && onProgress("giant", i, M) === false) return { k: null, aborted: true };
      await pause();
    }
    return { k: null, steps: ops, ms: performance.now() - t0, m: M };
  }

  const API = { P, N, G, md, inv, mul, neg, eq, isOnCurve, jAdd, toAffine, batchAffine,
    hex, unhex, compress, decompress, randomBelow, keyGen, keystream, encrypt, decrypt, bruteForce, bsgs };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.ECC = API;
})(typeof window !== "undefined" ? window : globalThis);
