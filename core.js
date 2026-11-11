/*
 * ROI Guarantee Monitor - core statistics (no dependencies).
 * Works in the browser (window.ViGuarantee) and in Node (module.exports).
 *
 * What it does
 *  - Each pilot randomizes members into Vi-treated vs. holdout groups.
 *  - Every day, members whose attribution window has closed are added.
 *  - The incremental value per treated member (delta) is estimated with a
 *    predictable, regression-adjusted (CUPED-style) pseudo-outcome:
 *        phi_i = (A_i / pi - (1 - A_i) / (1 - pi)) * (Y_i - m_{i-1}(X_i))
 *    where m_{i-1} is an OLS fit of outcome on pre-period value using ONLY
 *    members matured on earlier days. E[phi_i] = delta for any predictable m.
 *  - Uncertainty is an asymptotic confidence sequence (Waudby-Smith, Arnold,
 *    Wu, Wang & Ramdas, "Time-uniform central limit theory and asymptotic
 *    confidence sequences", Annals of Statistics 2024), which stays valid
 *    no matter how often the dashboard is checked, so the pilot can be
 *    certified (or stopped) the first day the evidence is in.
 *  - ROI = delta / fee per treated member. Guarantee: ROI >= 4X; downside
 *    protection: ROI < 1X.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ViGuarantee = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- seeded randomness ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const u = mulberry32(seed >>> 0);
    let spare = null;
    const rng = {
      u,
      normal() {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let a, b, r;
        do { a = 2 * u() - 1; b = 2 * u() - 1; r = a * a + b * b; } while (r >= 1 || r === 0);
        const f = Math.sqrt(-2 * Math.log(r) / r);
        spare = b * f; return a * f;
      },
      poisson(l) {
        if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * rng.normal()));
        const L = Math.exp(-l); let k = 0, p = 1;
        do { k++; p *= u(); } while (p > L);
        return k - 1;
      }
    };
    return rng;
  }

  const POC_DAYS = 90;
  const GUARANTEE = 4;   // 4X ROI commitment
  const DOWNSIDE = 1;    // 1X downside protection
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // ---------- synthetic pilot generator ----------
  // spec: {id, perDay, holdout, window, fee, xShare, xMu, xSigma, a, b, gamma,
  //        value, valueSigma, lift, startDay(optional)}
  // Outcome Y over the attribution window = conversion * value + gamma * X * e
  // (ongoing value from members already active before the pilot).
  // Treatment raises conversion probability by `lift` (absolute), so the true
  // incremental value per treated member is lift * value and true ROI is
  // lift * value / fee (exact, as long as p0 + lift <= 1, which specs keep).
  function generatePilot(spec, seed, lastEnrollDay) {
    const rng = makeRng(seed);
    const members = [];
    const endEnroll = lastEnrollDay == null ? POC_DAYS - spec.window : lastEnrollDay;
    const pi = 1 - spec.holdout;
    for (let d = 0; d <= endEnroll; d++) {
      const weekday = d % 7;
      const rate = spec.perDay * (weekday === 5 || weekday === 6 ? 0.55 : 1.12);
      const n = rng.poisson(rate);
      for (let k = 0; k < n; k++) {
        const hasX = rng.u() < spec.xShare;
        const x = hasX ? Math.exp(spec.xMu + spec.xSigma * rng.normal()) : 0;
        const a = rng.u() < pi ? 1 : 0;
        const p0 = sigmoid(spec.a + spec.b * Math.log1p(x));
        const p = Math.min(1, p0 + (a ? spec.lift : 0));
        const conv = rng.u() < p ? 1 : 0;
        const vs = spec.valueSigma;
        const v = conv ? spec.value * Math.exp(vs * rng.normal() - 0.5 * vs * vs) : 0;
        const carry = spec.gamma * x * Math.exp(0.35 * rng.normal() - 0.06125);
        members.push({ d, a, x, y: v + carry });
      }
    }
    return members;
  }

  function trueROI(spec) { return (spec.lift * spec.value) / spec.fee; }

  // ---------- confidence sequence boundary ----------
  function rhoFor(tStar, alpha) {
    const la = -2 * Math.log(alpha);
    return Math.sqrt((la + Math.log(la + 1)) / tStar);
  }
  // half-width multiplier for a unit-variance mean after n observations
  function csMultiplier(n, rho, alpha) {
    const r2 = rho * rho;
    return Math.sqrt((2 * (n * r2 + 1)) / (n * n * r2) * Math.log(Math.sqrt(n * r2 + 1) / alpha));
  }

  // 3x3 linear solve (Gaussian elimination with partial pivoting)
  function solve3(A, b) {
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  function Welford() { return { n: 0, mean: 0, m2: 0 }; }
  function wAdd(w, v) { w.n++; const d = v - w.mean; w.mean += d / w.n; w.m2 += d * (v - w.mean); }
  function wVar(w) { return w.n > 1 ? w.m2 / (w.n - 1) : NaN; }

  // ---------- main analysis ----------
  // opts: {fee, holdout, window, today, alpha, tStar}
  // Returns a per-day series (days window..today) with three interval types:
  //   cs     : regression-adjusted anytime-valid confidence sequence (running intersection)
  //   csRaw  : unadjusted anytime-valid confidence sequence (m = running mean of Y)
  //   naive  : fixed-horizon 95% Welch interval on difference in means, re-checked daily
  // All in ROI units (delta / fee).
  function analyze(members, opts) {
    const fee = opts.fee, pi = 1 - opts.holdout, W = opts.window;
    const alpha = opts.alpha == null ? 0.05 : opts.alpha;
    const today = Math.min(opts.today, POC_DAYS);
    const rho = rhoFor(opts.tStar, alpha);
    // bucket members by maturity day
    const byDay = new Map();
    for (const m of members) {
      const md = m.d + W;
      if (md > today) continue;
      if (!byDay.has(md)) byDay.set(md, []);
      byDay.get(md).push(m);
    }
    // running regression sums for features f = [1, x, log1p(x)]
    const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], XtY = [0, 0, 0];
    let ySum = 0, yN = 0;
    const adj = Welford(), raw = Welford(), t1 = Welford(), t0 = Welford();
    let lo = -Infinity, hi = Infinity, loR = -Infinity, hiR = Infinity;
    let beta = null;
    const series = [];
    let first = { cert: null, certRaw: null, certNaive: null, down: null, below: null, belowRaw: null };
    for (let day = W; day <= today; day++) {
      const batch = byDay.get(day) || [];
      // predictable fits: computed from members matured BEFORE this day
      const meanPrev = yN > 0 ? ySum / yN : 0;
      if (yN >= 30) beta = solve3(XtX, XtY);
      for (const m of batch) {
        const f = [1, m.x, Math.log1p(m.x)];
        const pred = beta ? beta[0] + beta[1] * f[1] + beta[2] * f[2] : meanPrev;
        const w = m.a ? 1 / pi : -1 / (1 - pi);
        wAdd(adj, w * (m.y - pred));
        wAdd(raw, w * (m.y - meanPrev));
        if (m.a) wAdd(t1, m.y); else wAdd(t0, m.y);
      }
      // update sums after scoring the batch (keeps fits predictable)
      for (const m of batch) {
        const f = [1, m.x, Math.log1p(m.x)];
        for (let i = 0; i < 3; i++) { XtY[i] += f[i] * m.y; for (let j = 0; j < 3; j++) XtX[i][j] += f[i] * f[j]; }
        ySum += m.y; yN++;
      }
      if (adj.n < 50 || t0.n < 5) { series.push({ day, n: adj.n, ready: false }); continue; }
      const mult = csMultiplier(adj.n, rho, alpha);
      const hw = Math.sqrt(wVar(adj)) * mult / fee;
      const hwR = Math.sqrt(wVar(raw)) * mult / fee;
      const est = adj.mean / fee, estR = raw.mean / fee;
      const l = est - hw, h = est + hw;
      // running intersection keeps the sequence valid and monotone
      if (l > lo) lo = l; if (h < hi) hi = h;
      if (lo > hi) { const mid = (lo + hi) / 2; lo = hi = mid; }
      if (estR - hwR > loR) loR = estR - hwR; if (estR + hwR < hiR) hiR = estR + hwR;
      if (loR > hiR) { const mid = (loR + hiR) / 2; loR = hiR = mid; }
      const naiveEst = (t1.mean - t0.mean) / fee;
      const naiveHw = 1.959964 * Math.sqrt(wVar(t1) / t1.n + wVar(t0) / t0.n) / fee;
      const row = {
        day, n: adj.n, nT: t1.n, nC: t0.n, ready: true,
        est, lo, hi, estRaw: estR, loRaw: loR, hiRaw: hiR,
        naiveEst, naiveLo: naiveEst - naiveHw, naiveHi: naiveEst + naiveHw,
        sd: Math.sqrt(wVar(adj)), sdRaw: Math.sqrt(wVar(raw))
      };
      series.push(row);
      if (first.cert == null && lo >= GUARANTEE) first.cert = day;
      if (first.certRaw == null && loR >= GUARANTEE) first.certRaw = day;
      if (first.certNaive == null && row.naiveLo >= GUARANTEE) first.certNaive = day;
      if (first.down == null && hi < DOWNSIDE) first.down = day;
      if (first.below == null && hi < GUARANTEE) first.below = day;
      if (first.belowRaw == null && hiR < GUARANTEE) first.belowRaw = day;
    }
    const ready = series.filter((r) => r.ready);
    const last = ready[ready.length - 1] || null;
    return { series, last, first, rho, alpha, beta };
  }

  // Expected matured members by POC end, for tuning rho.
  function expectedTotal(spec) { return spec.perDay * (POC_DAYS - spec.window + 1); }

  // Project the first future day (<= POC end) at which the anytime-valid interval
  // would clear `threshold` from above (dir=+1) or below (dir=-1) if the current
  // estimate and spread hold and enrollment continues at `perDay`.
  function projectDay(last, today, perDay, fee, rho, alpha, threshold, dir, sdKey, estKey, enrollEnd) {
    if (!last) return null;
    const sd = last[sdKey || 'sd'], est = last[estKey || 'est'];
    for (let d = today + 1; d <= POC_DAYS; d++) {
      const added = perDay * 0.957 * (d - today); // mean weekday-adjusted maturity rate
      const n = last.n + added;
      const hw = sd * csMultiplier(n, rho, alpha) / fee;
      if (dir > 0 && est - hw >= threshold) return d;
      if (dir < 0 && est + hw < threshold) return d;
    }
    return null;
  }

  function verdict(res, spec, today) {
    const L = res.last;
    if (!L) return { code: 'warming', label: 'Warming up' };
    const rho = res.rho, alpha = res.alpha;
    const enrollEnd = POC_DAYS - spec.window;
    if (L.lo >= GUARANTEE) return { code: 'certified', label: 'Certified \u2265 4X', day: res.first.cert };
    if (L.hi < DOWNSIDE) return { code: 'downside', label: 'Downside protection', day: res.first.down };
    if (L.hi < GUARANTEE) return { code: 'below', label: L.lo >= DOWNSIDE ? 'Below 4X, above 1X' : 'Below 4X', day: res.first.below };
    const up = projectDay(L, today, spec.perDay, spec.fee, rho, alpha, GUARANTEE, +1, 'sd', 'est', enrollEnd);
    const dn = L.est < GUARANTEE ? projectDay(L, today, spec.perDay, spec.fee, rho, alpha, GUARANTEE, -1, 'sd', 'est', enrollEnd) : null;
    return { code: 'monitoring', label: 'Monitoring', projected: up || dn, projectedOutcome: up ? 'certify' : dn ? 'rule out' : null };
  }

  // First certification day with and without pre-period adjustment (observed or projected).
  function certificationDays(res, spec, today) {
    const enrollEnd = POC_DAYS - spec.window;
    const obsAdj = res.first.cert, obsRaw = res.first.certRaw;
    const adj = obsAdj != null ? { day: obsAdj, projected: false }
      : (() => { const d = projectDay(res.last, today, spec.perDay, spec.fee, res.rho, res.alpha, GUARANTEE, +1, 'sd', 'est', enrollEnd); return d ? { day: d, projected: true } : null; })();
    const raw = obsRaw != null ? { day: obsRaw, projected: false }
      : (() => { const d = projectDay(res.last, today, spec.perDay, spec.fee, res.rho, res.alpha, GUARANTEE, +1, 'sdRaw', 'est', enrollEnd); return d ? { day: d, projected: true } : null; })();
    return { adj, raw };
  }

  // Variance reduction from the pre-period adjustment (share of spread removed).
  function varianceReduction(res) {
    const L = res.last; if (!L) return null;
    return 1 - (L.sd * L.sd) / (L.sdRaw * L.sdRaw);
  }

  // Monte Carlo: how often does each method "certify" 4X for a pilot whose true
  // ROI is below 4X, when the dashboard is checked every day of the 90-day POC?
  function falseCertification(spec, reps, seed) {
    let naive = 0, cs = 0, csRaw = 0;
    const tStar = expectedTotal(spec);
    for (let r = 0; r < reps; r++) {
      const mem = generatePilot(spec, (seed + r * 7919) >>> 0);
      const res = analyze(mem, { fee: spec.fee, holdout: spec.holdout, window: spec.window, today: POC_DAYS, tStar });
      if (res.first.certNaive != null) naive++;
      if (res.first.cert != null) cs++;
      if (res.first.certRaw != null) csRaw++;
    }
    return { reps, naive: naive / reps, cs: cs / reps, csRaw: csRaw / reps, trueROI: trueROI(spec) };
  }


  // Monte Carlo replay of a pilot design: distribution of the first day each
  // method reaches a guarantee decision over the full 90-day POC: either
  // "certified >= 4X" (lower bound >= 4) or "4X ruled out" (upper bound < 4).
  // null = no decision by day 90.
  function simulateDecisionDays(spec, reps, seed) {
    const tStar = expectedTotal(spec);
    const adj = [], raw = [], naiveCert = [];
    for (let r = 0; r < reps; r++) {
      const mem = generatePilot(spec, (seed + r * 104729) >>> 0);
      const res = analyze(mem, { fee: spec.fee, holdout: spec.holdout, window: spec.window, today: POC_DAYS, tStar });
      const f = res.first;
      const mn = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
      adj.push(mn(f.cert, f.below)); raw.push(mn(f.certRaw, f.belowRaw)); naiveCert.push(f.certNaive);
    }
    const summarize = (arr) => {
      const all = arr.map((d) => (d == null ? Infinity : d)).sort((a, b) => a - b);
      const med = all[Math.floor((all.length - 1) / 2)];
      return { rate: arr.filter((d) => d != null).length / arr.length, median: Number.isFinite(med) ? med : null };
    };
    return { reps, adj: summarize(adj), raw: summarize(raw), naiveCert: summarize(naiveCert) };
  }

  // Same pilot design with the effect scaled so true ROI equals `roi`.
  function withTrueROI(spec, roi) {
    return Object.assign({}, spec, { lift: (roi * spec.fee) / spec.value });
  }

  // ---------- demo portfolio ----------
  // Five pilots at different points of their 90-day POC (synthetic).
  const PILOTS = [
    { id: 'zx-activate', program: 'Zirexava new-patient activation', client: 'PharmaCorp', vertical: 'Life Sciences', product: 'Vi Activate',
      start: '2026-09-01', perDay: 900, holdout: 0.2, window: 14, fee: 2.5,
      xShare: 0.5, xMu: 4.2, xSigma: 1.0, a: -4.0, b: 0.25, gamma: 1.6, value: 640, valueSigma: 0.45, lift: 0.026, seed: 15 },
    { id: 'msk-enroll', program: 'MSK program enrollment', client: 'Northwind Health Plan', vertical: 'Healthcare', product: 'Vi Engage',
      start: '2026-10-11', perDay: 700, holdout: 0.15, window: 14, fee: 3.0,
      xShare: 0.55, xMu: 4.6, xSigma: 0.9, a: -3.4, b: 0.2, gamma: 1.2, value: 520, valueSigma: 0.4, lift: 0.036, seed: 23 },
    { id: 'zx-adherence', program: 'Zirexava refill adherence', client: 'PharmaCorp', vertical: 'Life Sciences', product: 'Vi Engage',
      start: '2026-08-18', perDay: 500, holdout: 0.15, window: 14, fee: 4.0,
      xShare: 0.8, xMu: 5.6, xSigma: 0.7, a: -2.2, b: 0.12, gamma: 1.3, value: 380, valueSigma: 0.35, lift: 0.044, seed: 37 },
    { id: 'peak-react', program: 'Lapsed member reactivation', client: 'Peak Fitness Clubs', vertical: 'Wellness', product: 'Vi Activate',
      start: '2026-09-08', perDay: 1100, holdout: 0.1, window: 14, fee: 1.2,
      xShare: 0.6, xMu: 3.6, xSigma: 0.8, a: -3.0, b: 0.15, gamma: 0.8, value: 95, valueSigma: 0.3, lift: 0.03, seed: 41 },
    { id: 'lake-sched', program: 'Outbound visit scheduling', client: 'Lakeshore Health System', vertical: 'Healthcare', product: 'Vi Operate',
      start: '2026-09-10', perDay: 1400, holdout: 0.2, window: 14, fee: 3.5,
      xShare: 0.5, xMu: 4.0, xSigma: 0.8, a: -2.6, b: 0.15, gamma: 0.3, value: 210, valueSigma: 0.35, lift: 0.008, seed: 53 }
  ];
  const TODAY_ISO = '2026-11-10';

  function dayIndex(startIso, todayIso) {
    const ms = Date.parse(todayIso + 'T00:00:00Z') - Date.parse(startIso + 'T00:00:00Z');
    return Math.round(ms / 86400000);
  }

  function runPortfolio(opts) {
    opts = opts || {};
    const todayIso = opts.today || TODAY_ISO;
    const alpha = opts.alpha == null ? 0.05 : opts.alpha;
    return PILOTS.map((spec) => {
      const today = Math.min(dayIndex(spec.start, todayIso), POC_DAYS);
      const members = generatePilot(spec, spec.seed);
      const tStar = expectedTotal(spec);
      const res = analyze(members, { fee: spec.fee, holdout: spec.holdout, window: spec.window, today, alpha, tStar });
      // Bonferroni-adjusted run for a simultaneous portfolio lower bound
      const resB = analyze(members, { fee: spec.fee, holdout: spec.holdout, window: spec.window, today, alpha: alpha / PILOTS.length, tStar });
      const v = verdict(res, spec, today);
      const cd = certificationDays(res, spec, today);
      const L = res.last;
      const fees = L ? L.nT * spec.fee : 0;
      return {
        spec, today, res, verdict: v, certDays: cd, vr: varianceReduction(res),
        fees, value: L ? L.est * fees : 0, valueLoSimul: resB.last ? resB.last.lo * fees : 0,
        enrolled: members.filter((m) => m.d <= today).length
      };
    });
  }

  return {
    makeRng, generatePilot, trueROI, rhoFor, csMultiplier, solve3, analyze, verdict,
    certificationDays, varianceReduction, falseCertification, simulateDecisionDays, withTrueROI, expectedTotal, projectDay,
    runPortfolio, dayIndex, PILOTS, TODAY_ISO, POC_DAYS, GUARANTEE, DOWNSIDE
  };
});
