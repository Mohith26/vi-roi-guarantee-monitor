// Precomputes the Monte Carlo replays shown in the two bottom cards so the page
// loads instantly. Same seeded functions the page runs live via "Re-run".
//   node scripts/precompute-replays.js   (writes replays.json)
const fs = require('fs');
const path = require('path');
const V = require('../core.js');
const REPS = 100;
const out = { reps: REPS, generated_from: 'core.js runPortfolio() + simulateDecisionDays/falseCertification, seeds 2026/4242', pilots: {} };
for (const p of V.runPortfolio()) {
  const est = Math.max(0.2, p.res.last.est);
  const dec = V.simulateDecisionDays(V.withTrueROI(p.spec, est), REPS, 2026);
  const fal = V.falseCertification(V.withTrueROI(p.spec, 3.6), REPS, 4242);
  out.pilots[p.spec.id] = { dec, fal, est };
  console.log(p.spec.id, JSON.stringify(dec), JSON.stringify(fal));
}
fs.writeFileSync(path.join(__dirname, '..', 'replays.json'), JSON.stringify(out, null, 1));
