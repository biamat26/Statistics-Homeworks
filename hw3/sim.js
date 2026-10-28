/* Simulation of the penetration process and the statistics needed to study it.

   Attacker j (j = 1..m) goes through the n systems one after the other and gets
   a score X_i at system i. The increments are i.i.d.:
     Bernoulli:  X_i in {0, 1},   P(X_i = 1) = p        mean p, variance p(1-p)
     Rademacher: X_i in {-1, +1}, probability 1/2 each  mean 0, variance 1
   The trajectory of attacker j is S_k = X_1 + ... + X_k, k = 1..n. */

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------
  // Fast PRNG: xoshiro128** seeded from the browser's crypto generator
  // ---------------------------------------------------------------------
  function makeRng() {
    const s = new Uint32Array(4);
    globalThis.crypto.getRandomValues(s);
    if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
    const rotl = (x, k) => (x << k) | (x >>> (32 - k));
    function next() { // uint32
      const r = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
      const t = s[1] << 9;
      s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
      s[2] ^= t; s[3] = rotl(s[3], 11);
      return r;
    }
    return { next, uniform: () => next() / 4294967296 };
  }

  const model = (name, p) => name === "bern"
    ? { name, p, mu: p, var: p * (1 - p), label: `Bernoulli(p = ${p})` }
    : { name, p: 0.5, mu: 0, var: 1, label: "Rademacher (±1)" };

  /* Simulate m attackers over n systems.
     checkpoints: values of k (<= n) at which S_k is recorded for every attacker
     keepPaths:   number of attackers whose full trajectory is kept (down-sampled to ~pts points)
     Returns { at: Map(k -> Float64Array(m) of S_k), paths: [{k: [...], S: [...]}] } */
  function simulate(M, n, m, { checkpoints = [n], keepPaths = 0, pts = 600 } = {}) {
    const rng = makeRng();
    const cps = [...new Set(checkpoints.filter((k) => k >= 1 && k <= n))].sort((a, b) => a - b);
    const at = new Map(cps.map((k) => [k, new Float64Array(m)]));
    const grid = [];
    if (keepPaths) {
      const step = Math.max(1, Math.floor(n / pts));
      for (let k = 1; k <= n; k += step) grid.push(k);
      if (grid[grid.length - 1] !== n) grid.push(n);
    }
    const paths = [];
    const thr = Math.floor(M.p * 4294967296); // X = 1 if uint32 < thr
    for (let j = 0; j < m; j++) {
      let S = 0, ci = 0, gi = 0, bits = 0, left = 0;
      const keep = j < keepPaths, path = keep ? { k: grid, S: new Float64Array(grid.length) } : null;
      for (let k = 1; k <= n; k++) {
        if (M.name === "bern") S += rng.next() < thr ? 1 : 0;
        else { if (!left) { bits = rng.next(); left = 32; } S += (bits & 1) ? 1 : -1; bits >>>= 1; left--; }
        if (k === cps[ci]) { at.get(k)[j] = S; ci++; }
        if (keep && k === grid[gi]) { path.S[gi] = S; gi++; }
      }
      if (keep) paths.push(path);
    }
    return { at, paths, n, m };
  }

  // ---------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------
  function mean(a) { let s = 0; for (const v of a) s += v; return s / a.length; }
  function variance(a) { const mu = mean(a); let s = 0; for (const v of a) s += (v - mu) ** 2; return s / (a.length - 1); }
  const scale = (a, c, d = 0) => Float64Array.from(a, (v) => (v - d) * c);

  // standard normal pdf / cdf
  const phi = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  function Phi(x) { // Abramowitz-Stegun 7.1.26 via erf, error < 1.5e-7
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }
  // Kolmogorov-Smirnov distance between the sample and N(mu, sd^2)
  function ksNormal(a, mu = 0, sd = 1) {
    const s = Float64Array.from(a).sort(), n = s.length;
    let d = 0;
    for (let i = 0; i < n; ) {
      let j = i; while (j < n && s[j] === s[i]) j++; // ties (lattice values)
      const F = Phi((s[i] - mu) / sd);
      d = Math.max(d, Math.abs(j / n - F), Math.abs(i / n - F));
      i = j;
    }
    return d;
  }
  // log of the binomial pmf, for exact overlays
  function lnFact(k) { let s = 0; for (let i = 2; i <= k; i++) s += Math.log(i); return s; }
  const lnFactCache = [0];
  function lnF(k) { while (lnFactCache.length <= k) { const i = lnFactCache.length; lnFactCache.push(lnFactCache[i - 1] + Math.log(i)); } return lnFactCache[k]; }
  const binomPmf = (n, p, k) => (k < 0 || k > n ? 0 : Math.exp(lnF(n) - lnF(k) - lnF(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p)));

  // histogram with given edges
  function histogram(a, lo, hi, bins) {
    const c = new Array(bins).fill(0), w = (hi - lo) / bins;
    for (const v of a) { const b = Math.floor((v - lo) / w); if (b >= 0 && b < bins) c[b]++; }
    return { counts: c, lo, hi, w, dens: c.map((x) => x / (a.length * w)) };
  }

  const API = { makeRng, model, simulate, mean, variance, scale, phi, Phi, ksNormal, binomPmf, histogram, lnFact };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Sim = API;
})(typeof window !== "undefined" ? window : globalThis);
