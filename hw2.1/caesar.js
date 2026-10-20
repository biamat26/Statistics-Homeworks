/* Caesar cipher and its statistical cryptanalysis.
   Language statistics come from corpus.js (window.CORPUS). */

(function (root) {
  "use strict";

  const A = "abcdefghijklmnopqrstuvwxyz";

  // ---------------------------------------------------------------------
  // Cipher
  // ---------------------------------------------------------------------

  // shift every letter by k positions (mod 26); case is kept, other characters are unchanged
  function shift(text, k) {
    k = ((k % 26) + 26) % 26;
    let out = "";
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c >= 65 && c <= 90) out += String.fromCharCode(65 + ((c - 65 + k) % 26));
      else if (c >= 97 && c <= 122) out += String.fromCharCode(97 + ((c - 97 + k) % 26));
      else out += ch;
    }
    return out;
  }
  const encrypt = (text, k) => shift(text, k);
  const decrypt = (text, k) => shift(text, -k);

  // letters only, lowercase, as indices 0..25
  function letterIdx(text) {
    const out = [];
    for (const ch of text.toLowerCase()) { const c = ch.charCodeAt(0) - 97; if (c >= 0 && c < 26) out.push(c); }
    return out;
  }
  function counts(idx) { const c = new Array(26).fill(0); for (const i of idx) c[i]++; return c; }

  // ---------------------------------------------------------------------
  // Language model from the corpus
  // ---------------------------------------------------------------------

  let LM = null;
  function model() {
    if (LM) return LM;
    const C = root.CORPUS, tot = C.letters.reduce((a, b) => a + b, 0);
    LM = {
      p: C.letters.map((v) => v / tot),
      big: Float64Array.from(C.bigramLog10),
      tri: Float64Array.from(C.trigramLog10),
    };
    return LM;
  }

  // ---------------------------------------------------------------------
  // Key-recovery methods. Each returns { scores[26], key, better: "max"|"min" }
  // where scores[k] rates the hypothesis "the key is k".
  // ---------------------------------------------------------------------

  // 1. Most frequent ciphertext letter is assumed to be 'e'
  function mostFrequent(idx) {
    const c = counts(idx);
    const scores = Array.from({ length: 26 }, (_, k) => c[(4 + k) % 26]);
    return { scores, key: argBest(scores, "max"), better: "max" };
  }

  // 2. Chi-squared distance between observed letter counts (after undoing shift k) and English
  function chiSquared(idx) {
    const c = counts(idx), n = idx.length, { p } = model();
    const scores = Array.from({ length: 26 }, (_, k) => {
      let x = 0;
      for (let i = 0; i < 26; i++) { const e = n * p[i]; x += (c[(i + k) % 26] - e) ** 2 / e; }
      return x;
    });
    return { scores, key: argBest(scores, "min"), better: "min" };
  }

  // 3. Correlation (inner product) between observed frequencies and English frequencies
  function correlation(idx) {
    const c = counts(idx), { p } = model();
    const scores = Array.from({ length: 26 }, (_, k) => {
      let s = 0; for (let i = 0; i < 26; i++) s += p[i] * c[(i + k) % 26];
      return s / Math.max(idx.length, 1);
    });
    return { scores, key: argBest(scores, "max"), better: "max" };
  }

  // 4-5. n-gram log-likelihood of the candidate plaintext (exhaustive search over the 26 keys)
  function ngram(idx, n) {
    const { big, tri } = model();
    const scores = Array.from({ length: 26 }, (_, k) => {
      let s = 0;
      if (n === 2) for (let i = 0; i + 1 < idx.length; i++) s += big[((idx[i] - k + 26) % 26) * 26 + ((idx[i + 1] - k + 26) % 26)];
      else for (let i = 0; i + 2 < idx.length; i++) s += tri[((idx[i] - k + 26) % 26) * 676 + ((idx[i + 1] - k + 26) % 26) * 26 + ((idx[i + 2] - k + 26) % 26)];
      return s;
    });
    return { scores, key: argBest(scores, "max"), better: "max" };
  }
  const bigram = (idx) => ngram(idx, 2);
  const trigram = (idx) => ngram(idx, 3);

  function argBest(a, better) {
    let b = 0;
    for (let i = 1; i < a.length; i++) if (better === "max" ? a[i] > a[b] : a[i] < a[b]) b = i;
    return b;
  }

  const METHODS = [
    { id: "freq", short: "Most frequent = e", name: "Most frequent letter = e", fn: mostFrequent },
    { id: "chi", short: "χ²", name: "χ² on letter frequencies", fn: chiSquared },
    { id: "corr", short: "Correlation", name: "Frequency correlation", fn: correlation },
    { id: "big", short: "Bigrams", name: "Bigram log-likelihood", fn: bigram },
    { id: "tri", short: "Trigrams", name: "Trigram log-likelihood", fn: trigram },
  ];

  // a random excerpt of the test pool containing exactly `letters` letters
  function sample(pool, letters) {
    for (;;) {
      let i = Math.floor(Math.random() * (pool.length - 20));
      while (i > 0 && pool[i - 1] !== " ") i--; // start at a word boundary
      let n = 0, j = i;
      while (j < pool.length && n < letters) { if (/[A-Za-z]/.test(pool[j])) n++; j++; }
      if (n === letters) return pool.slice(i, j);
    }
  }

  const API = { A, shift, encrypt, decrypt, letterIdx, counts, model, mostFrequent, chiSquared, correlation, bigram, trigram, METHODS, sample };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Caesar = API;
})(typeof window !== "undefined" ? window : globalThis);
