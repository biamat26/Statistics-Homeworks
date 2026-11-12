/* Riemann (partition of the domain) and Lebesgue (partition of the range) numerical integration. */

(function (root) {
  "use strict";

  // root of a monotone function g on [lo, hi] (g(lo) and g(hi) of opposite sign) by bisection
  function bisect(g, lo, hi, it = 60) {
    let glo = g(lo);
    for (let i = 0; i < it; i++) { const mid = 0.5 * (lo + hi), gm = g(mid); if ((gm > 0) === (glo > 0)) { lo = mid; glo = gm; } else hi = mid; }
    return 0.5 * (lo + hi);
  }
  const sinc = (x) => (x === 0 ? 1 : Math.sin(x) / x);

  /* Each function: domain [a, b], exact integral, range [ymin, ymax] used by the Lebesgue partition,
     and (when known) the distribution functions ge(t) = μ{x : f(x) ≥ t} and gt(t) = μ{x : f(x) > t},
     i.e. the measures of the preimages of [t, ∞) and (t, ∞). */
  const FUNCS = [
    { id: "sin", label: "sin x on [0, π]", tex: "\\int_0^{\\pi} \\sin x\\,dx = 2", a: 0, b: Math.PI, f: Math.sin, exact: 2, ymin: 0, ymax: 1,
      ge: (t) => (t <= 0 ? Math.PI : t > 1 ? 0 : Math.PI - 2 * Math.asin(t)), note: "smooth" },
    { id: "sq", label: "x² on [0, 1]", tex: "\\int_0^1 x^2\\,dx = \\tfrac13", a: 0, b: 1, f: (x) => x * x, exact: 1 / 3, ymin: 0, ymax: 1,
      ge: (t) => (t <= 0 ? 1 : t > 1 ? 0 : 1 - Math.sqrt(t)), note: "smooth, monotone" },
    { id: "step13", label: "1 if x < ½, 3 if x ≥ ½", tex: "\\int_0^1 f = \\tfrac12\\cdot1 + \\tfrac12\\cdot3 = 2", a: 0, b: 1, f: (x) => (x < 0.5 ? 1 : 3), exact: 2, ymin: 0, ymax: 3,
      ge: (t) => (t <= 1 ? 1 : t <= 3 ? 0.5 : 0), gt: (t) => (t < 1 ? 1 : t < 3 ? 0.5 : 0), note: "jump discontinuity" },
    { id: "abs", label: "|x − ½| on [0, 1]", tex: "\\int_0^1 |x-\\tfrac12|\\,dx = \\tfrac14", a: 0, b: 1, f: (x) => Math.abs(x - 0.5), exact: 0.25, ymin: 0, ymax: 0.5,
      ge: (t) => (t <= 0 ? 1 : t > 0.5 ? 0 : 1 - 2 * t), note: "kink at ½" },
    { id: "invsqrt", label: "1/√x on (0, 1]", tex: "\\int_0^1 \\frac{dx}{\\sqrt x} = 2", a: 0, b: 1, f: (x) => 1 / Math.sqrt(x), exact: 2, ymin: 0, ymax: Infinity,
      ge: (t) => (t <= 1 ? 1 : 1 / (t * t)), note: "unbounded: improper Riemann integral" },
    { id: "ind", label: "1 if x < ½, 0 if x ≥ ½", tex: "\\int_0^1 \\mathbf 1_{[0,1/2)} = \\tfrac12", a: 0, b: 1, f: (x) => (x < 0.5 ? 1 : 0), exact: 0.5, ymin: 0, ymax: 1,
      ge: (t) => (t <= 0 ? 1 : t <= 1 ? 0.5 : 0), gt: (t) => (t < 0 ? 1 : t < 1 ? 0.5 : 0), note: "indicator (simple function)" },
    { id: "sinc", label: "sin x / x on [0, π]", tex: "\\int_0^{\\pi} \\frac{\\sin x}{x}dx = \\mathrm{Si}(\\pi) \\approx 1.851937", a: 0, b: Math.PI, f: sinc, exact: 1.8519370519824661704, ymin: 0, ymax: 1,
      ge: (t) => (t <= 0 ? Math.PI : t >= 1 ? 0 : bisect((x) => sinc(x) - t, 0, Math.PI)), note: "no elementary antiderivative; preimages by root finding" },
    { id: "sininv", label: "sin(1/x) on (0, 1]", tex: "\\int_0^1 \\sin\\tfrac1x\\,dx = \\sin 1 - \\mathrm{Ci}(1) \\approx 0.504067", a: 0, b: 1, f: (x) => Math.sin(1 / x), exact: 0.50406706190692837199, ymin: -1, ymax: 1,
      ge: null, note: "infinitely many oscillations near 0; preimages are infinite unions of intervals" },
  ];

  // ---------------- Riemann: partition of the domain into N equal subintervals ----------------
  function riemann(F, N, rule) {
    const { a, b, f } = F, h = (b - a) / N;
    let s = 0;
    if (rule === "left") { for (let i = 0; i < N; i++) s += f(a + i * h); return s * h; }
    if (rule === "right") { for (let i = 1; i <= N; i++) s += f(a + i * h); return s * h; }
    if (rule === "mid") { for (let i = 0; i < N; i++) s += f(a + (i + 0.5) * h); return s * h; }
    if (rule === "trap") { s = 0.5 * (f(a) + f(b)); for (let i = 1; i < N; i++) s += f(a + i * h); return s * h; }
    if (rule === "simp") { if (N % 2) N++; const k = (b - a) / N; s = f(a) + f(b); for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * f(a + i * k); return (s * k) / 3; }
    throw new Error(rule);
  }

  /* ---------------- Lebesgue: partition of the range into M levels ----------------
     Levels y_0 < y_1 < … < y_M on [ymin, ymax]; on E_k = f⁻¹([y_k, y_{k+1})) the simple function is y_k (lower)
     or y_{k+1} (upper). Its integral Σ y_k μ(E_k) can be rewritten with the distribution function:
        lower = ymin·|D| + Δ Σ_{k=1}^{M} μ{f ≥ y_k},      upper = ymin·|D| + Δ Σ_{k=0}^{M-1} μ{f > y_k}.
     For unbounded f the range is truncated at T = M^{2/3} (balancing truncation and discretization error). */
  function lebesgue(F, M, variant = "mid") {
    const len = F.b - F.a, ge = F.ge, gt = F.gt || F.ge;
    const top = isFinite(F.ymax) ? F.ymax : Math.pow(M, 2 / 3) + 1;
    const d = (top - F.ymin) / M;
    let lo = 0, up = 0;
    for (let k = 1; k <= M; k++) lo += ge(F.ymin + k * d);
    for (let k = 0; k < M; k++) up += gt(F.ymin + k * d);
    lo = F.ymin * len + d * lo; up = F.ymin * len + d * up;
    return variant === "lower" ? lo : variant === "upper" ? up : 0.5 * (lo + up);
  }

  /* Lebesgue with measured preimages: when μ{f ∈ [y_k, y_{k+1})} is not known in closed form we can only
     estimate it, e.g. by counting the fraction of K equally spaced sample points of the domain that fall in it.
     Each sample is rounded to the midpoint of its level; levels are taken on [ymin, ymax] of the samples. */
  function lebesgueCount(F, M, K) {
    const { a, b, f } = F, h = (b - a) / K, ys = new Float64Array(K);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < K; i++) { const y = f(a + (i + 0.5) * h); ys[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
    if (!isFinite(hi) || hi > 1e6) hi = Math.min(hi, Math.pow(M, 2 / 3) + 1);
    const d = (hi - lo) / M || 1, count = new Float64Array(M);
    for (const y of ys) count[Math.min(M - 1, Math.max(0, Math.floor((y - lo) / d)))]++;
    let s = 0;
    for (let k = 0; k < M; k++) s += (lo + (k + 0.5) * d) * (count[k] / K) * (b - a); // level value × measure of its preimage
    return s;
  }

  // ---------------- Pathological functions ----------------
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  // Thomae at a rational p/q given as integers
  const thomae = (p, q) => 1 / (q / gcd(p, q));
  // smallest denominator of a rational in the closed interval [k/N, (k+1)/N]
  function minDen(k, N) { for (let q = 1; q <= N; q++) if (Math.ceil((k * q) / N) <= Math.floor(((k + 1) * q) / N)) return q; return N; }
  function thomaeSums(N) {
    let left = 0, mid = 0, upper = 0;
    for (let k = 0; k < N; k++) {
      left += thomae(k, N);                 // tag k/N
      mid += thomae(2 * k + 1, 2 * N);      // tag (2k+1)/(2N)
      upper += 1 / minDen(k, N);            // sup of f on the subinterval
    }
    return { left: left / N, mid: mid / N, upper: upper / N, lower: 0 };
  }
  // rationals of [0, 1] in Farey order (by denominator), used for the measure-zero cover
  function rationals(count) {
    const out = [];
    for (let q = 1; out.length < count; q++) for (let p = 0; p <= q && out.length < count; p++) if (gcd(p, q) === 1) out.push([p, q]);
    return out;
  }

  const API = { FUNCS, riemann, lebesgue, lebesgueCount, bisect, gcd, thomae, minDen, thomaeSums, rationals };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Integ = API;
})(typeof window !== "undefined" ? window : globalThis);
