/* =========================================================================
   ec.js — Elliptic-curve arithmetic over a prime field F_p
   Curve in short Weierstrass form:  y^2 = x^3 + a*x + b  (mod p)
   All numbers are BigInt, so the same code works for the toy curve
   (p = 17) and for the real secp256k1 curve used by Ethereum.
   ========================================================================= */

(function (root) {
  "use strict";

  // The point at infinity O (neutral element of the group)
  const O = null;

  // ---------- modular arithmetic ----------

  // Correct modulo: JavaScript's % keeps the sign of the dividend
  function mod(a, p) {
    const r = a % p;
    return r >= 0n ? r : r + p;
  }

  // Modular inverse with the extended Euclidean algorithm
  function inv(a, p) {
    a = mod(a, p);
    if (a === 0n) throw new Error("0 has no modular inverse");
    let [oldR, r] = [a, p];
    let [oldS, s] = [1n, 0n];
    while (r !== 0n) {
      const q = oldR / r;
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
    }
    return mod(oldS, p);
  }

  // ---------- curve ----------

  function makeCurve(p, a, b, name) {
    p = BigInt(p); a = BigInt(a); b = BigInt(b);
    const disc = mod(4n * a ** 3n + 27n * b ** 2n, p);
    if (disc === 0n) throw new Error("Singular curve: 4a^3 + 27b^2 = 0 (mod p)");
    return { p, a, b, name: name || `y^2 = x^3 + ${a}x + ${b} (mod ${p})` };
  }

  function isOnCurve(C, P) {
    if (P === O) return true;
    return mod(P.y * P.y - (P.x ** 3n + C.a * P.x + C.b), C.p) === 0n;
  }

  function eq(P, Q) {
    if (P === O || Q === O) return P === Q;
    return P.x === Q.x && P.y === Q.y;
  }

  function neg(C, P) {
    return P === O ? O : { x: P.x, y: mod(-P.y, C.p) };
  }

  /* Point addition. Returns { R, info } where info describes the step
     (case, slope numerator/denominator, lambda) — used by the visualizer. */
  function addVerbose(C, P, Q) {
    const p = C.p;
    if (P === O) return { R: Q, info: { kind: "identity", text: "O + Q = Q" } };
    if (Q === O) return { R: P, info: { kind: "identity", text: "P + O = P" } };
    if (P.x === Q.x && mod(P.y + Q.y, p) === 0n) {
      return { R: O, info: { kind: "inverse", text: "P + (-P) = O (vertical line)" } };
    }
    let num, den, kind;
    if (eq(P, Q)) {
      kind = "double";
      num = mod(3n * P.x * P.x + C.a, p);
      den = mod(2n * P.y, p);
    } else {
      kind = "add";
      num = mod(Q.y - P.y, p);
      den = mod(Q.x - P.x, p);
    }
    const lambda = mod(num * inv(den, p), p);
    const x3 = mod(lambda * lambda - P.x - Q.x, p);
    const y3 = mod(lambda * (P.x - x3) - P.y, p);
    return { R: { x: x3, y: y3 }, info: { kind, num, den, lambda } };
  }

  function add(C, P, Q) {
    return addVerbose(C, P, Q).R;
  }

  // Naive scalar multiplication: G, 2G, 3G, ..., kG (k-1 additions)
  function multiplesTrace(C, G, k) {
    const steps = [{ k: 1n, R: G, info: { kind: "start" } }];
    let R = G;
    for (let i = 2n; i <= k; i++) {
      const r = addVerbose(C, R, G);
      R = r.R;
      steps.push({ k: i, R, info: r.info });
      if (R === O) break; // reached the order of G
    }
    return steps;
  }

  // Fast scalar multiplication: double-and-add (left-to-right)
  function mul(C, k, P) {
    k = BigInt(k);
    if (k < 0n) return mul(C, -k, neg(C, P));
    let R = O;
    for (const bit of k.toString(2)) {
      R = add(C, R, R);
      if (bit === "1") R = add(C, R, P);
    }
    return R;
  }

  // Double-and-add with a trace of every operation (for the page)
  function mulTrace(C, k, P) {
    k = BigInt(k);
    const bits = k.toString(2);
    const trace = [];
    let R = O, partial = 0n;
    for (let i = 0; i < bits.length; i++) {
      R = add(C, R, R); partial *= 2n;
      trace.push({ bit: bits[i], op: "double", partial, R });
      if (bits[i] === "1") {
        R = add(C, R, P); partial += 1n;
        trace.push({ bit: bits[i], op: "add", partial, R });
      }
    }
    return { R, trace, bits };
  }

  // All affine points of a (small) curve
  function allPoints(C) {
    const p = Number(C.p);
    if (p > 5000) throw new Error("Curve too large to enumerate");
    const squares = new Map();
    for (let y = 0; y < p; y++) {
      const s = (y * y) % p;
      if (!squares.has(s)) squares.set(s, []);
      squares.get(s).push(y);
    }
    const pts = [];
    for (let x = 0; x < p; x++) {
      const rhs = Number(mod(BigInt(x) ** 3n + C.a * BigInt(x) + C.b, C.p));
      for (const y of squares.get(rhs) || []) pts.push({ x: BigInt(x), y: BigInt(y) });
    }
    return pts;
  }

  // Order of a point: smallest n >= 1 with nP = O (small curves only)
  function order(C, P) {
    if (P === O) return 1n;
    let n = 1n, R = P;
    while (R !== O) {
      R = add(C, R, P);
      n++;
      if (n > 100000n) throw new Error("Order too large to compute by enumeration");
    }
    return n;
  }

  function fmt(P) {
    return P === O ? "O" : `(${P.x}, ${P.y})`;
  }

  function hex(n, width = 64) {
    return n.toString(16).toUpperCase().padStart(width, "0");
  }

  // ---------- predefined curves ----------

  const TOY = makeCurve(17, 0, 7, "y² = x³ + 7 (mod 17)");
  const MINI = makeCurve(211, 0, 7, "y² = x³ + 7 (mod 211)");

  const SECP256K1 = {
    ...makeCurve(
      0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn, 0, 7, "secp256k1"
    ),
    G: {
      x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
      y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,
    },
    n: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,
  };

  const EC = {
    O, mod, inv, makeCurve, isOnCurve, eq, neg, add, addVerbose,
    multiplesTrace, mul, mulTrace, allPoints, order, fmt, hex,
    TOY, MINI, SECP256K1,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = EC;
  else root.EC = EC;
})(this);