/* Numerical methods for the standard normal CDF  Φ(x) = ∫_{-∞}^{x} φ(t) dt,  φ(t) = e^{-t²/2}/√(2π). */

(function (root) {
  "use strict";

  const SQ2PI = Math.sqrt(2 * Math.PI), SQRT2 = Math.SQRT2, SQPI = Math.sqrt(Math.PI);
  const phi = (t) => Math.exp(-0.5 * t * t) / SQ2PI;

  // 1. Trapezoidal rule on [0, x]:  Φ(x) = 1/2 + ∫_0^x φ
  function trapezoid(x, n = 100) {
    const h = x / n;
    let s = 0.5 * (phi(0) + phi(x));
    for (let i = 1; i < n; i++) s += phi(i * h);
    return 0.5 + h * s;
  }

  // 2. Simpson's rule on [0, x] (n even)
  function simpson(x, n = 100) {
    if (n % 2) n++;
    const h = x / n;
    let s = phi(0) + phi(x);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * phi(i * h);
    return 0.5 + (h / 3) * s;
  }

  // 3. Taylor series of erf (alternating):  erf(z) = 2/√π Σ (-1)^k z^{2k+1} / (k! (2k+1)),  Φ(x) = ½(1 + erf(x/√2))
  function erfTaylor(x) {
    const z = x / SQRT2, z2 = z * z;
    let term = z, sum = z, k = 0;
    while (k < 2000) {
      k++;
      term *= -z2 / k;                 // (-1)^k z^{2k+1} / k!
      const add = term / (2 * k + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 0.5 * (1 + (2 / SQPI) * sum);
  }

  // 4. Positive-term series (Marsaglia 2004):  Φ(x) = 1/2 + φ(x)·(x + x³/3 + x⁵/(3·5) + …)
  function seriesSum(x) {
    const x2 = x * x;
    let term = x, sum = x, k = 0;
    while (k < 5000) {
      k++;
      term *= x2 / (2 * k + 1);
      const old = sum; sum += term;
      if (sum === old) break;
    }
    return sum;
  }
  const positiveSeries = (x) => 0.5 + phi(x) * seriesSum(x);

  // 5. Laplace continued fraction for the upper tail, x > 0:
  //    Q(x) = 1 - Φ(x) = φ(x) / (x + 1/(x + 2/(x + 3/(x + …))))   (evaluated backwards with N terms)
  function tailCF(x, N = 80) {
    let f = x;
    for (let k = N; k >= 1; k--) f = x + k / f;
    return phi(x) / f;
  }
  const contFrac = (x) => (x >= 0 ? 1 - tailCF(x) : tailCF(-x));

  // 6. Hybrid: series in the centre, continued fraction in the tails; always computes the smaller tail
  //    probability first, so that tiny probabilities keep full relative accuracy.
  function lowerTail(a) { // Q(a) for a >= 0
    return a < 2.5 ? 0.5 - phi(a) * seriesSum(a) : tailCF(a, a < 4 ? 160 : 60);
  }
  function hybrid(x) {
    const q = lowerTail(Math.abs(x));
    return x < 0 ? q : 1 - q;
  }

  // 7. Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8)
  function as26217(x) {
    const a = Math.abs(x), t = 1 / (1 + 0.2316419 * a);
    const q = phi(a) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x < 0 ? q : 1 - q;
  }

  // 8. erf via Abramowitz & Stegun 7.1.26 (|error of erf| < 1.5e-7), Φ(x) = ½(1 + erf(x/√2))
  function erfAS(z) {
    const s = z < 0 ? -1 : 1; z = Math.abs(z);
    const t = 1 / (1 + 0.3275911 * z);
    const y = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
    return s * y;
  }
  const as7126 = (x) => 0.5 * (1 + erfAS(x / SQRT2));

  const METHODS = [
    { id: "trap", name: "Trapezoid (n = 100)", fn: (x) => trapezoid(x, 100), kind: "integration" },
    { id: "simp", name: "Simpson (n = 100)", fn: (x) => simpson(x, 100), kind: "integration" },
    { id: "taylor", name: "erf Taylor series", fn: erfTaylor, kind: "series" },
    { id: "pos", name: "Positive series (Marsaglia)", fn: positiveSeries, kind: "series" },
    { id: "cf", name: "Continued fraction", fn: contFrac, kind: "continued fraction" },
    { id: "as7126", name: "erf, A&S 7.1.26", fn: as7126, kind: "erf approximation" },
    { id: "as26217", name: "A&S 26.2.17", fn: as26217, kind: "rational approximation" },
    { id: "hybrid", name: "Hybrid (series + CF)", fn: hybrid, kind: "series + continued fraction" },
  ];

  const API = { phi, trapezoid, simpson, erfTaylor, positiveSeries, seriesSum, tailCF, contFrac, hybrid, lowerTail, as26217, as7126, erfAS, METHODS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Normal = API;
})(typeof window !== "undefined" ? window : globalThis);
