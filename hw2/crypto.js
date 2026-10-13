(function (root) {
  "use strict";

  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();

  // ---------------------------------------------------------------------
  // Byte / hex helpers
  // ---------------------------------------------------------------------

  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  function fromHex(h) {
    h = h.replace(/^0x/i, "");
    if (h.length % 2) h = "0" + h;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
    return out;
  }
  function concat(...arrs) {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  const bytesToBig = (b) => (b.length ? BigInt("0x" + toHex(b)) : 0n);
  const bigToBytes = (n, len = 32) => fromHex(n.toString(16).padStart(len * 2, "0"));
  const ser32 = (i) => new Uint8Array([(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]);
  const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const bitsOf = (b) => Array.from(b, (x) => x.toString(2).padStart(8, "0")).join("");

  // ---------------------------------------------------------------------
  // Keccak-f[1600] and the sponge (Keccak-256 and SHA3-256)
  // 64-bit lanes are stored as two 32-bit words: [lo, hi].
  // ---------------------------------------------------------------------

  const RC_HEX = [
    "0000000000000001", "0000000000008082", "800000000000808A", "8000000080008000",
    "000000000000808B", "0000000080000001", "8000000080008081", "8000000000008009",
    "000000000000008A", "0000000000000088", "0000000080008009", "000000008000000A",
    "000000008000808B", "800000000000008B", "8000000000008089", "8000000000008003",
    "8000000000008002", "8000000000000080", "000000000000800A", "800000008000000A",
    "8000000080008081", "8000000000008080", "0000000080000001", "8000000080008008",
  ];
  const RC = new Uint32Array(48);
  RC_HEX.forEach((h, i) => { RC[2 * i] = parseInt(h.slice(8), 16) >>> 0; RC[2 * i + 1] = parseInt(h.slice(0, 8), 16) >>> 0; });

  // rotation offsets r[x + 5y]
  const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  // pi: lane (x, y) moves to (y, 2x + 3y)
  const PI = new Array(25);
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) PI[x + 5 * y] = y + 5 * ((2 * x + 3 * y) % 5);

  function keccakF(s) {
    const C = new Uint32Array(10), B = new Uint32Array(50);
    for (let round = 0; round < 24; round++) {
      // theta
      for (let x = 0; x < 5; x++) {
        C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
        C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
      }
      for (let x = 0; x < 5; x++) {
        const l1 = C[2 * ((x + 1) % 5)], h1 = C[2 * ((x + 1) % 5) + 1];
        const dl = C[2 * ((x + 4) % 5)] ^ ((l1 << 1) | (h1 >>> 31));
        const dh = C[2 * ((x + 4) % 5) + 1] ^ ((h1 << 1) | (l1 >>> 31));
        for (let y = 0; y < 25; y += 5) { s[2 * (x + y)] ^= dl; s[2 * (x + y) + 1] ^= dh; }
      }
      // rho + pi
      for (let i = 0; i < 25; i++) {
        const lo = s[2 * i], hi = s[2 * i + 1], r = ROT[i], d = PI[i];
        let nl, nh;
        if (r === 0) { nl = lo; nh = hi; }
        else if (r < 32) { nl = (lo << r) | (hi >>> (32 - r)); nh = (hi << r) | (lo >>> (32 - r)); }
        else if (r === 32) { nl = hi; nh = lo; }
        else { const m = r - 32; nl = (hi << m) | (lo >>> (32 - m)); nh = (lo << m) | (hi >>> (32 - m)); }
        B[2 * d] = nl; B[2 * d + 1] = nh;
      }
      // chi
      for (let y = 0; y < 25; y += 5) {
        for (let x = 0; x < 5; x++) {
          const a = 2 * (y + x), b = 2 * (y + ((x + 1) % 5)), c = 2 * (y + ((x + 2) % 5));
          s[a] = B[a] ^ (~B[b] & B[c]);
          s[a + 1] = B[a + 1] ^ (~B[b + 1] & B[c + 1]);
        }
      }
      // iota
      s[0] ^= RC[2 * round]; s[1] ^= RC[2 * round + 1];
    }
  }

  /* Sponge with rate 136 bytes (capacity 512 bits), 32-byte output.
     domain = 0x01 -> original Keccak-256 (used by Ethereum)
     domain = 0x06 -> SHA3-256 as standardized in FIPS 202 (2015)      */
  function sponge256(msg, domain) {
    const rate = 136, s = new Uint32Array(50);
    const padded = new Uint8Array(Math.floor(msg.length / rate + 1) * rate);
    padded.set(msg);
    padded[msg.length] ^= domain;
    padded[padded.length - 1] ^= 0x80;
    for (let off = 0; off < padded.length; off += rate) {
      for (let j = 0; j < rate; j++) s[(j >> 2)] ^= padded[off + j] << (8 * (j & 3));
      keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let j = 0; j < 32; j++) out[j] = (s[j >> 2] >>> (8 * (j & 3))) & 255;
    return out;
  }
  const keccak256 = (msg) => sponge256(typeof msg === "string" ? enc.encode(msg) : msg, 0x01);
  const sha3_256 = (msg) => sponge256(typeof msg === "string" ? enc.encode(msg) : msg, 0x06);

  // ---------------------------------------------------------------------
  // Web Crypto wrappers: SHA-256, SHA-512, HMAC-SHA512, PBKDF2
  // ---------------------------------------------------------------------

  const sha256 = async (b) => new Uint8Array(await subtle.digest("SHA-256", b));
  const sha512 = async (b) => new Uint8Array(await subtle.digest("SHA-512", b));
  async function hmacSha512(key, data) {
    const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    return new Uint8Array(await subtle.sign("HMAC", k, data));
  }
  async function pbkdf2Sha512(password, salt, iterations, bytes) {
    const k = await subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-512" }, k, bytes * 8));
  }

  // ---------------------------------------------------------------------
  // secp256k1 (Jacobian coordinates for speed)
  // ---------------------------------------------------------------------

  const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
  const GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

  const md = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
  function inv(a, m = P) {
    let [r0, r1] = [md(a, m), m], [s0, s1] = [1n, 0n];
    while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return md(s0, m);
  }
  function jDouble(X, Y, Z) {
    if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
    const A = md(X * X), B = md(Y * Y), C = md(B * B);
    const D = md(2n * (md((X + B) * (X + B)) - A - C));
    const E = md(3n * A), F = md(E * E);
    const X3 = md(F - 2n * D);
    return [X3, md(E * (D - X3) - 8n * C), md(2n * Y * Z)];
  }
  // Jacobian + affine (mixed addition)
  function jAddAffine(X1, Y1, Z1, x2, y2) {
    if (Z1 === 0n) return [x2, y2, 1n];
    const Z1Z1 = md(Z1 * Z1);
    const U2 = md(x2 * Z1Z1), S2 = md(y2 * Z1 * Z1Z1);
    const H = md(U2 - X1), R = md(S2 - Y1);
    if (H === 0n) return R === 0n ? jDouble(X1, Y1, Z1) : [0n, 1n, 0n];
    const HH = md(H * H), HHH = md(H * HH), V = md(X1 * HH);
    const X3 = md(R * R - HHH - 2n * V);
    return [X3, md(R * (V - X3) - Y1 * HHH), md(Z1 * H)];
  }
  // k * (x, y) with double-and-add; returns affine {x, y} or null (point at infinity)
  function pointMul(k, x = GX, y = GY) {
    k = md(k, N);
    if (k === 0n) return null;
    let [X, Y, Z] = [0n, 1n, 0n];
    for (const bit of k.toString(2)) {
      [X, Y, Z] = jDouble(X, Y, Z);
      if (bit === "1") [X, Y, Z] = jAddAffine(X, Y, Z, x, y);
    }
    if (Z === 0n) return null;
    const zi = inv(Z), zi2 = md(zi * zi);
    return { x: md(X * zi2), y: md(Y * zi2 * zi) };
  }
  const isOnCurve = (Q) => md(Q.y * Q.y - Q.x ** 3n - 7n) === 0n;
  const pubCompressed = (Q) => concat(new Uint8Array([Q.y & 1n ? 3 : 2]), bigToBytes(Q.x));
  const pubUncompressed64 = (Q) => concat(bigToBytes(Q.x), bigToBytes(Q.y));

  // ---------------------------------------------------------------------
  // BIP-39: entropy <-> mnemonic, mnemonic -> seed
  // ---------------------------------------------------------------------

  const WORDS = () => root.BIP39_WORDLIST || globalThis.BIP39_WORDLIST;

  async function entropyToMnemonic(entropy) {
    const ENT = entropy.length * 8;
    if (![128, 160, 192, 224, 256].includes(ENT)) throw new Error("Entropy must be 128-256 bits, multiple of 32");
    const CS = ENT / 32;
    const hash = await sha256(entropy);
    const entBits = bitsOf(entropy), csBits = bitsOf(hash).slice(0, CS);
    const all = entBits + csBits;
    const groups = all.match(/.{11}/g);
    const indices = groups.map((g) => parseInt(g, 2));
    return { words: indices.map((i) => WORDS()[i]), indices, groups, entBits, csBits, ENT, CS, hash };
  }

  function normalizeMnemonic(m) {
    return m.normalize("NFKD").trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  async function checkMnemonic(m) {
    const words = normalizeMnemonic(m), list = WORDS();
    if (![12, 15, 18, 21, 24].includes(words.length)) return { ok: false, reason: `${words.length} words (must be 12, 15, 18, 21 or 24)` };
    const indices = words.map((w) => list.indexOf(w));
    const bad = words.filter((_, i) => indices[i] < 0);
    if (bad.length) return { ok: false, reason: `not in the BIP-39 wordlist: ${bad.join(", ")}` };
    const bits = indices.map((i) => i.toString(2).padStart(11, "0")).join("");
    const CS = bits.length / 33, ENT = bits.length - CS;
    const entropy = fromHex(BigInt("0b" + bits.slice(0, ENT)).toString(16).padStart(ENT / 4, "0"));
    const expected = bitsOf(await sha256(entropy)).slice(0, CS);
    const given = bits.slice(ENT);
    return { ok: expected === given, reason: expected === given ? "checksum OK" : `checksum mismatch (expected ${expected}, found ${given})`,
      words, indices, entropy, ENT, CS, expected, given };
  }

  async function mnemonicToSeed(mnemonic, passphrase = "") {
    const m = normalizeMnemonic(mnemonic).join(" ");
    return pbkdf2Sha512(enc.encode(m), enc.encode("mnemonic" + passphrase.normalize("NFKD")), 2048, 64);
  }

  // ---------------------------------------------------------------------
  // BIP-32 / BIP-44: hierarchical deterministic derivation
  // ---------------------------------------------------------------------

  const HARDENED = 0x80000000;

  async function masterKey(seed) {
    const I = await hmacSha512(enc.encode("Bitcoin seed"), seed);
    const k = bytesToBig(I.slice(0, 32));
    if (k === 0n || k >= N) throw new Error("Invalid master key (probability < 2^-127)");
    return { k, c: I.slice(32), I };
  }

  async function childKey(parent, index) {
    const hardened = index >= HARDENED;
    const data = hardened
      ? concat(new Uint8Array([0]), bigToBytes(parent.k), ser32(index))
      : concat(pubCompressed(pointMul(parent.k)), ser32(index));
    const I = await hmacSha512(parent.c, data);
    const IL = bytesToBig(I.slice(0, 32));
    if (IL >= N) throw new Error("Invalid child (IL >= n), use the next index");
    const k = md(IL + parent.k, N);
    if (k === 0n) throw new Error("Invalid child (k = 0), use the next index");
    return { k, c: I.slice(32), I, hardened, index };
  }

  function parsePath(path) {
    const parts = path.trim().split("/");
    if (parts[0] !== "m") throw new Error("Path must start with m");
    return parts.slice(1).map((p) => {
      const h = /['hH]$/.test(p), n = parseInt(p, 10);
      if (!Number.isInteger(n) || n < 0 || n >= HARDENED) throw new Error(`Bad path element: ${p}`);
      return { index: h ? n + HARDENED : n, label: p };
    });
  }

  async function derivePath(seed, path) {
    const steps = [];
    let node = await masterKey(seed);
    steps.push({ label: "m", node });
    for (const { index, label } of parsePath(path)) {
      node = await childKey(node, index);
      steps.push({ label, node });
    }
    return { node, steps };
  }

  // ---------------------------------------------------------------------
  // Ethereum address and EIP-55
  // ---------------------------------------------------------------------

  function addressFromPrivateKey(k) {
    const Q = pointMul(k);
    const pub = pubUncompressed64(Q);
    const hash = keccak256(pub);
    const addr = toHex(hash.slice(12));
    return { Q, pub, hash, addr };
  }

  function toChecksumAddress(addrHex) {
    const a = addrHex.replace(/^0x/i, "").toLowerCase();
    const h = toHex(keccak256(a));
    let out = "";
    for (let i = 0; i < 40; i++) out += /[a-f]/.test(a[i]) && parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
    return { checksummed: "0x" + out, hashHex: h, lower: a };
  }

  // "valid" = all-lowercase / all-uppercase (no checksum) or matching mixed case
  function checkAddress(addr) {
    const a = addr.replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{40}$/.test(a)) return { ok: false, reason: "not 40 hex characters" };
    if (a === a.toLowerCase() || a === a.toUpperCase()) return { ok: true, reason: "no checksum (single case): cannot detect typos" };
    const ok = toChecksumAddress(a).checksummed === "0x" + a;
    return { ok, reason: ok ? "EIP-55 checksum valid" : "EIP-55 checksum INVALID: probably a typo" };
  }

  const API = {
    toHex, fromHex, concat, bytesToBig, bigToBytes, randomBytes, bitsOf,
    keccak256, sha3_256, keccakF, sha256, sha512, hmacSha512, pbkdf2Sha512,
    P, N, GX, GY, pointMul, isOnCurve, pubCompressed, pubUncompressed64,
    entropyToMnemonic, checkMnemonic, mnemonicToSeed, normalizeMnemonic,
    HARDENED, masterKey, childKey, parsePath, derivePath,
    addressFromPrivateKey, toChecksumAddress, checkAddress,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.W = API;
})(typeof window !== "undefined" ? window : globalThis);