# ROI Guarantee Monitor for Vi Pulse (concept)

**Live demo:** https://mohith26.github.io/vi-roi-guarantee-monitor/

An unofficial concept feature for [Vi](https://vi.co)'s Pulse command center, built by Mohith Gajjela. Not affiliated with Vi. All data is synthetic.

## What it is

Vi commits to 4X ROI with 1X downside protection on every pilot, measured against a randomized holdout, and Pulse shows ROI in real time. This page adds the missing piece between those two promises: **a range around each pilot's ROI that stays valid no matter how often anyone looks at it**, so a pilot can be certified (or stopped) on the first day the evidence is in instead of waiting out the 90-day POC, without the false certifications you get from re-reading a fixed t-test every day.

For each pilot it shows:

- **ROI estimate and a 95% anytime-valid range** (incremental value per treated member divided by Vi's fee per member), updated daily as attribution windows close.
- **A verdict:** Certified ≥ 4X (lower bound above 4X), 4X ruled out (upper bound below 4X), Downside protection (upper bound below 1X), On track (with a projected certification day if today's effect holds), or Too close to call.
- **Time to a decision** with and without pre-period data, from 100 seeded replays of the pilot's own design at today's estimate.
- **Why not a daily t-test:** 100 replays of the same design with a true ROI of 3.6X (guarantee missed), checked every day.

## How it works

1. **Randomized holdout.** Each member is assigned to Vi-treated (probability π) or holdout (1 − π). A member counts once their attribution window (14 days here) closes.
2. **Pre-period adjustment (CUPED-style, predictable).** Each matured member contributes
   `φ = (A/π − (1−A)/(1−π)) · (Y − m(X))`,
   where `X` is the member's pre-period value and `m` is an OLS fit of outcome on `[1, X, log(1+X)]` using **only members that matured on earlier days**. Because `m` is fixed before the member is scored, `E[φ] = Δ` (the incremental value per treated member) for any `m`; a good `m` just removes variance. In the demo this removes 57% of the variance for the Zirexava pilot.
3. **Anytime-valid range.** The running mean of `φ` gets an asymptotic confidence sequence (Waudby-Smith, Arnold, Wu, Wang & Ramdas, *Time-uniform central limit theory and asymptotic confidence sequences*, Annals of Statistics 2024), with the mixing parameter tuned for the expected sample size at day 90. Its running intersection is reported, so the lower bound never falls and the upper bound never rises.
4. **ROI = Δ / fee.** Guarantee certified when the lower bound reaches 4X; downside protection when the upper bound falls below 1X.
5. **Portfolio lower bound.** The "verified" incremental value sums per-pilot lower bounds computed at α/5 (Bonferroni), so it holds for all five pilots simultaneously.

Headline numbers on the demo data (all computed by `core.js`, reproducible from the seeds):

- Zirexava new-patient activation: estimated 6.84X, range 4.53X to 9.04X on day 70; certified ≥ 4X on day 54.
- Replays at today's estimate: median decision on day 49 with pre-period data vs. day 83 without.
- Replays at a true 3.6X: a fixed 95% t-test re-checked daily "certified" 4X in 22% of pilots; the anytime-valid range in 0%.

## Files

- `core.js`: generator (seeded), estimator, confidence sequence, verdicts, projections, replays. No dependencies; runs in the browser and Node.
- `app.js`, `index.html`, `styles.css`: the Pulse page (static, CDN fonts/icons only).
- `scripts/precompute-replays.js`: writes `replays.json` so the replay cards load instantly. The page's "Re-run live" button recomputes them in a Web Worker from the same seeds and marks whether the results are identical.
- `test/core.test.js`: unit tests.

## Tests

```
node --test test/core.test.js
```

Nine tests: linear solve, the sequence is always wider than a fixed interval, ROI formula, unbiasedness of the adjusted estimator (Monte Carlo), time-uniform coverage across replays (miss rate ≤ 12.5% over 40 replays at a 5% target), monotone running intersection, variance reduction only when the pre-period is predictive, daily t-test over-certifies while the sequence does not, and the demo portfolio's verdicts and internal consistency.

## Honest limitations

- **Synthetic data.** Pilot names reuse the fictional "PharmaCorp / Zirexava" from Vi's own product screenshots; clients, volumes, fees and effects are invented. Seeds were chosen so the five pilots show five different verdicts; the replay cards show the distribution over 100 seeds, which is the fairer comparison (on the Zirexava path shown, the unadjusted sequence would have certified on day 67 vs. day 54).
- **Asymptotic validity.** The confidence sequence is valid as samples grow; with very small daily volumes or extremely heavy-tailed outcomes, a finite-sample (e.g. betting-based) sequence would be safer. It is also conservative: the 0% false-certification rate is below the 5% target, which costs some speed.
- **Fee model.** ROI is incremental value divided by a fixed per-treated-member fee. Value-share or tiered pricing would change the denominator, not the method.
- **Interference and drift.** It assumes the holdout is untouched by spillover (e.g. HCP-level outreach reaching holdout patients) and that the effect is roughly stable over the POC; time-varying effects are averaged.
- **Projections** assume today's estimate and spread hold and enrollment continues at the planned rate.
- The UI recreates the Pulse shell from Vi's public screenshots; icon set is Tabler (thin stroke) as the closest CDN match to Vi's custom icons.

## Novelty note

Vi describes randomized holdouts, control-group benchmarking and real-time ROI tracking in Pulse (vi.co/verticals FAQ, the July 2026 "Why Architecture Decides" post), but nothing public mentions sequential or anytime-valid inference, pre-period variance reduction, or certifying the 4X guarantee before the POC ends. General A/B platforms (Eppo, Statsig, Optimizely) ship sequential testing and CUPED for product experiments; this applies the same ideas to Vi's outcome-based guarantee.
