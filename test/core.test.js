const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../core.js');

const base = V.PILOTS.find((p) => p.id === 'zx-activate');

test('solve3 solves a known 3x3 system', () => {
  const x = V.solve3([[2, 1, 0], [1, 3, 1], [0, 1, 4]], [3, 9.5, 14]);
  assert.ok(Math.abs(x[0] - 0.5) < 1e-9 && Math.abs(x[1] - 2) < 1e-9 && Math.abs(x[2] - 3) < 1e-9);
});

test('confidence-sequence multiplier is always wider than a fixed 95% interval', () => {
  const rho = V.rhoFor(60000, 0.05);
  for (const n of [100, 1000, 10000, 60000, 200000]) {
    assert.ok(V.csMultiplier(n, rho, 0.05) > 1.96 / Math.sqrt(n), `n=${n}`);
  }
  assert.ok(V.csMultiplier(1000, rho, 0.05) > V.csMultiplier(10000, rho, 0.05));
});

test('true ROI formula and withTrueROI agree', () => {
  assert.ok(Math.abs(V.trueROI(base) - (base.lift * base.value) / base.fee) < 1e-12);
  assert.ok(Math.abs(V.trueROI(V.withTrueROI(base, 3.6)) - 3.6) < 1e-12);
});

test('regression-adjusted estimate is unbiased for the true ROI (Monte Carlo)', () => {
  const reps = 30; let sum = 0;
  for (let r = 0; r < reps; r++) {
    const m = V.generatePilot(base, 1000 + r);
    const res = V.analyze(m, { fee: base.fee, holdout: base.holdout, window: base.window, today: 90, tStar: V.expectedTotal(base) });
    sum += res.last.est;
  }
  const mean = sum / reps;
  assert.ok(Math.abs(mean - V.trueROI(base)) < 0.45, `mean ${mean} vs ${V.trueROI(base)}`);
});

test('anytime-valid sequence covers the truth at every day in most replays', () => {
  const spec = V.withTrueROI(base, 4.5); const reps = 40; let miss = 0;
  const truth = V.trueROI(spec);
  for (let r = 0; r < reps; r++) {
    const res = V.analyze(V.generatePilot(spec, 5000 + r), { fee: spec.fee, holdout: spec.holdout, window: spec.window, today: 90, tStar: V.expectedTotal(spec) });
    if (res.series.some((d) => d.ready && (d.lo > truth || d.hi < truth))) miss++;
  }
  assert.ok(miss / reps <= 0.125, `time-uniform miss rate ${miss / reps}`);
});

test('running intersection is monotone: lower bound never falls, upper never rises', () => {
  const res = V.analyze(V.generatePilot(base, 77), { fee: base.fee, holdout: base.holdout, window: base.window, today: 90, tStar: V.expectedTotal(base) });
  const r = res.series.filter((d) => d.ready);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i].lo >= r[i - 1].lo - 1e-12 && r[i].hi <= r[i - 1].hi + 1e-12);
  }
});

test('pre-period adjustment removes variance when the pre-period is predictive, not when it is noise', () => {
  const strong = V.analyze(V.generatePilot(base, 9), { fee: base.fee, holdout: base.holdout, window: base.window, today: 90, tStar: V.expectedTotal(base) });
  assert.ok(V.varianceReduction(strong) > 0.4);
  const weak = Object.assign({}, base, { gamma: 0, b: 0 });
  const w = V.analyze(V.generatePilot(weak, 9), { fee: weak.fee, holdout: weak.holdout, window: weak.window, today: 90, tStar: V.expectedTotal(weak) });
  assert.ok(Math.abs(V.varianceReduction(w)) < 0.05);
});

test('daily peeking at a fixed t-test over-certifies a 3.6X pilot; the sequence does not', () => {
  const f = V.falseCertification(V.withTrueROI(base, 3.6), 40, 99);
  assert.ok(f.naive > 0.1, `naive ${f.naive}`);
  assert.ok(f.cs <= 0.075, `cs ${f.cs}`);
  assert.ok(f.naive > f.cs);
});

test('demo portfolio covers each verdict and numbers are internally consistent', () => {
  const out = V.runPortfolio();
  const codes = out.map((p) => p.verdict.code).sort();
  assert.deepEqual(codes, ['below', 'certified', 'downside', 'monitoring', 'monitoring']);
  for (const p of out) {
    const L = p.res.last;
    assert.ok(L.lo <= L.est && L.est <= L.hi);
    assert.ok(Math.abs(p.value - L.est * L.nT * p.spec.fee) < 1e-6);
    if (p.verdict.code === 'certified') assert.ok(L.lo >= V.GUARANTEE);
    if (p.verdict.code === 'downside') assert.ok(L.hi < V.DOWNSIDE);
  }
  const msk = out.find((p) => p.spec.id === 'msk-enroll');
  assert.equal(msk.verdict.projectedOutcome, 'certify');
});
