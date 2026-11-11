/* ROI Guarantee page for Vi Pulse (concept). All numbers come from core.js. */
(function () {
  'use strict';
  const V = window.ViGuarantee;
  const SIM_REPS = 100;
  const portfolio = V.runPortfolio();
  const byId = Object.fromEntries(portfolio.map((p) => [p.spec.id, p]));
  const state = { sel: 'zx-activate', mode: 'cs' };
  const simCache = {};

  // ---------- formatting ----------
  const $ = (id) => document.getElementById(id);
  const roi = (x) => (x == null || !isFinite(x) ? '–' : (x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + 'X');
  const money = (x) => {
    const s = x < 0 ? '−$' : '$'; const a = Math.abs(x);
    if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'm';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'k';
    return s + Math.round(a);
  };
  const int = (x) => Math.round(x).toLocaleString('en-US');
  const pct = (x) => (x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0) + '%';
  const dateOf = (p, day) => new Date(Date.parse(p.spec.start + 'T00:00:00Z') + day * 86400000);
  const md = (d) => (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  const mon = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function verdictPill(p) {
    const v = p.verdict;
    if (v.code === 'certified') return '<span class="pill green"><i class="ti ti-circle-check-filled"></i>Certified ≥ 4X</span>';
    if (v.code === 'downside') return '<span class="pill red"><i class="ti ti-arrow-back-up"></i>Downside protection</span>';
    if (v.code === 'below') return '<span class="pill amber">4X ruled out</span>';
    if (v.projectedOutcome === 'certify') return '<span class="pill violet">On track</span>';
    return '<span class="pill gray">Too close to call</span>';
  }
  function decisionText(p, long) {
    const v = p.verdict;
    if (v.code === 'certified') return (long ? 'Certified on day ' : 'Day ') + v.day + ' · ' + mon(dateOf(p, v.day));
    if (v.code === 'downside') return (long ? 'Below 1X confirmed day ' : 'Day ') + v.day + ' · ' + mon(dateOf(p, v.day));
    if (v.code === 'below') return (long ? '4X ruled out on day ' : 'Day ') + v.day + ' · ' + mon(dateOf(p, v.day));
    if (v.projected) return (long ? 'Projected to certify by day ' : 'Proj. day ') + v.projected + ' · ' + mon(dateOf(p, v.projected));
    return long ? 'Not decidable by day 90 at this effect' : 'Not by day 90';
  }

  // ---------- KPIs ----------
  function renderKPIs() {
    const cert = portfolio.filter((p) => p.verdict.code === 'certified');
    const down = portfolio.filter((p) => p.verdict.code === 'downside');
    const est = portfolio.reduce((s, p) => s + p.value, 0);
    const lo = portfolio.reduce((s, p) => s + p.valueLoSimul, 0);
    const fees = portfolio.reduce((s, p) => s + p.fees, 0);
    const members = portfolio.reduce((s, p) => s + p.res.last.n, 0);
    const clients = new Set(portfolio.map((p) => p.spec.client)).size;
    const firstCert = cert.length ? cert.slice().sort((a, b) => a.verdict.day - b.verdict.day)[0] : null;
    // sparkline: portfolio cumulative estimated value by calendar day
    const spark = sparkPath();
    $('kpis').innerHTML = `
      <div class="card kpi"><div class="k-label">Pilots in POC</div>
        <div class="k-value">${portfolio.length}<small>${clients} clients</small></div>
        <div class="k-foot"><span class="pill gray">${int(members)} matured members</span></div></div>
      <div class="card kpi"><div class="k-label">Guarantee certified</div>
        <div class="k-value">${cert.length}<small>of ${portfolio.length}</small></div>
        <div class="k-foot">${firstCert ? `<span class="pill green">≥ 4X since ${mon(dateOf(firstCert, firstCert.verdict.day))}</span>` : '<span class="pill gray">None yet</span>'}</div></div>
      <div class="card kpi"><div class="k-label">Downside protection</div>
        <div class="k-value">${down.length}<small>${down.length === 1 ? 'pilot' : 'pilots'}</small></div>
        <div class="k-foot">${down.length ? `<span class="pill red">ROI &lt; 1X confirmed</span>` : '<span class="pill gray">None</span>'}</div></div>
      <div class="card kpi"><div class="k-label">Incremental value</div>
        <div class="k-value">${money(est)}</div>
        <svg class="spark" width="96" height="40" viewBox="0 0 96 40">${spark}</svg>
        <div class="k-foot"><span class="pill green">≥ ${money(lo)} verified</span><span>on ${money(fees)} fees</span></div></div>`;
  }
  function sparkPath() {
    // estimated cumulative incremental value across pilots by calendar date
    const start = Math.min(...portfolio.map((p) => Date.parse(p.spec.start)));
    const end = Date.parse(V.TODAY_ISO);
    const pts = [];
    for (let t = start; t <= end; t += 86400000 * 3) {
      let s = 0;
      for (const p of portfolio) {
        const day = Math.round((t - Date.parse(p.spec.start)) / 86400000);
        const row = p.res.series.find((r) => r.day === day && r.ready);
        if (row) s += row.est * row.nT * p.spec.fee;
        else if (day > p.today) s += p.value;
      }
      pts.push(s);
    }
    const mx = Math.max(...pts, 1);
    const xy = pts.map((v, i) => [4 + (i / (pts.length - 1)) * 88, 34 - (Math.max(0, v) / mx) * 28]);
    const d = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    return `<path d="${d} L92 38 L4 38 Z" fill="#eaf6e9"/><path d="${d}" fill="none" stroke="#43a32a" stroke-width="2" stroke-linejoin="round"/>`;
  }

  // ---------- chart ----------
  function renderChart() {
    const p = byId[state.sel];
    const el = $('chart');
    const W = Math.max(560, el.clientWidth - 20), H = 420;
    const m = { l: 50, r: 92, t: 14, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const rows = p.res.series.filter((r) => r.ready);
    const naive = state.mode === 'naive';
    // y-domain from the readable part of the sequence (first week of data is very wide)
    const settled = rows.filter((r) => r.day >= rows[0].day + Math.max(8, Math.round(rows.length * 0.15)));
    let yMin = Math.min(0, ...settled.map((r) => (naive ? r.naiveLo : r.lo)));
    let yMax = Math.max(5, ...settled.map((r) => (naive ? r.naiveHi : r.hi)));
    yMin = Math.floor(yMin / 2) * 2; yMax = Math.ceil(yMax / 2) * 2;
    if (yMax - yMin > 16) yMax = yMin + 16;
    const x = (d) => m.l + (d / V.POC_DAYS) * iw;
    const y = (v) => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
    const yt = []; for (let v = yMin; v <= yMax + 1e-9; v += 2) yt.push(v);
    let g = '';
    g += `<defs><clipPath id="clip"><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/></clipPath>
      <pattern id="fut" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fbfbfd"/><line x1="0" y1="0" x2="0" y2="6" stroke="#efeef4" stroke-width="2"/></pattern></defs>`;
    // future region
    if (p.today < V.POC_DAYS) g += `<rect x="${x(p.today)}" y="${m.t}" width="${x(V.POC_DAYS) - x(p.today)}" height="${ih}" fill="url(#fut)"/>`;
    // attribution window (no member has matured yet)
    g += `<rect x="${x(0)}" y="${m.t}" width="${x(p.spec.window) - x(0)}" height="${ih}" fill="#f7f7fa"/><text x="${(x(0) + x(p.spec.window)) / 2}" y="${m.t + ih / 2}" text-anchor="middle" font-size="10.5" fill="#9a97a6" transform="rotate(-90 ${(x(0) + x(p.spec.window)) / 2} ${m.t + ih / 2})">${p.spec.window}-day attribution window</text>`;
    // grid
    for (const v of yt) g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" stroke="#e7e6ec" stroke-dasharray="3 4"/><text x="${m.l - 10}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6f6c7a">${v}X</text>`;
    for (let d = 0; d <= V.POC_DAYS; d += 10) {
      g += `<line x1="${x(d)}" x2="${x(d)}" y1="${m.t}" y2="${m.t + ih}" stroke="#f0eff4" stroke-dasharray="3 4"/>`;
      const isToday = Math.abs(d - p.today) < 6;
      if (!isToday) g += `<text x="${x(d)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#6f6c7a">${md(dateOf(p, d))}</text>`;
    }
    g += `<text x="${x(p.today)}" y="${H - 12}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#15121c">Today</text>`;
    // reference lines
    g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(4)}" y2="${y(4)}" stroke="#3d9a3d" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${m.l + iw + 8}" y="${y(4) + 4}" font-size="11" font-weight="600" fill="#327818">4X guarantee</text>`;
    if (1 >= yMin) g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(1)}" y2="${y(1)}" stroke="#d9534f" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${m.l + iw + 8}" y="${y(1) + 4}" font-size="11" font-weight="600" fill="#c1352b">1X downside</text>`;
    const path = (arr, f) => arr.map((r, i) => (i ? 'L' : 'M') + x(r.day).toFixed(1) + ' ' + y(f(r)).toFixed(1)).join(' ');
    const area = (arr, lo, hi) => path(arr, hi) + ' ' + arr.slice().reverse().map((r) => 'L' + x(r.day).toFixed(1) + ' ' + y(lo(r)).toFixed(1)).join(' ') + ' Z';
    let body = '';
    if (!naive) {
      body += `<path d="${area(rows, (r) => r.lo, (r) => r.hi)}" fill="rgba(97,70,246,.14)"/>`;
      body += `<path d="${path(rows, (r) => r.lo)}" fill="none" stroke="#a79bf9" stroke-width="1.2"/><path d="${path(rows, (r) => r.hi)}" fill="none" stroke="#a79bf9" stroke-width="1.2"/>`;
      // projection for open pilots
      const L = p.res.last;
      if (p.today < V.POC_DAYS && p.verdict.code === 'monitoring') {
        const proj = [];
        for (let d = p.today; d <= V.POC_DAYS; d++) {
          const n = L.n + p.spec.perDay * 0.957 * (d - p.today);
          const hw = L.sd * V.csMultiplier(n, p.res.rho, p.res.alpha) / p.spec.fee;
          proj.push({ day: d, lo: L.est - hw, hi: L.est + hw });
        }
        body += `<path d="${area(proj, (r) => r.lo, (r) => r.hi)}" fill="rgba(97,70,246,.06)"/><path d="${path(proj, (r) => r.lo)}" fill="none" stroke="#a79bf9" stroke-dasharray="3 3"/><path d="${path(proj, (r) => r.hi)}" fill="none" stroke="#a79bf9" stroke-dasharray="3 3"/>`;
        body += `<path d="M${x(p.today)} ${y(L.est)} L${x(V.POC_DAYS)} ${y(L.est)}" stroke="#6146f6" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      }
      body += `<path d="${path(rows, (r) => r.est)}" fill="none" stroke="#6146f6" stroke-width="2.2" stroke-linejoin="round"/>`;
    } else {
      body += `<path d="${area(rows, (r) => r.naiveLo, (r) => r.naiveHi)}" fill="rgba(116,116,119,.12)"/>`;
      body += `<path d="${path(rows, (r) => r.naiveLo)}" fill="none" stroke="#8f8d96" stroke-dasharray="4 3"/><path d="${path(rows, (r) => r.naiveHi)}" fill="none" stroke="#8f8d96" stroke-dasharray="4 3"/>`;
      body += `<path d="${path(rows, (r) => r.naiveEst)}" fill="none" stroke="#4e4c55" stroke-width="2"/>`;
      // days a daily t-test would have "certified"
      for (const r of rows) if (r.naiveLo >= 4) body += `<circle cx="${x(r.day)}" cy="${y(r.naiveLo)}" r="2.6" fill="#f08c2e"/>`;
    }
    g += `<g clip-path="url(#clip)">${body}</g>`;
    // today line
    g += `<line x1="${x(p.today)}" x2="${x(p.today)}" y1="${m.t}" y2="${m.t + ih}" stroke="#15121c" stroke-width="1" stroke-dasharray="2 3"/>`;
    // decision marker
    const v = p.verdict;
    if (!naive && v.day != null) {
      const r = rows.find((q) => q.day === v.day);
      if (r) {
        const yy = v.code === 'certified' ? r.lo : r.hi;
        const col = v.code === 'certified' ? '#327818' : v.code === 'downside' ? '#c1352b' : '#a36a00';
        const lab = v.code === 'certified' ? 'Certified · day ' + v.day : v.code === 'downside' ? 'Below 1X · day ' + v.day : '4X ruled out · day ' + v.day;
        const lx = Math.min(x(v.day) + 10, m.l + iw - 150);
        const ly = Math.max(m.t + 16, Math.min(m.t + ih - 8, y(yy) + (v.code === 'certified' ? 26 : -14)));
        g += `<circle cx="${x(v.day)}" cy="${y(yy)}" r="5.5" fill="#fff" stroke="${col}" stroke-width="2.5"/>`;
        g += `<rect x="${lx - 6}" y="${ly - 14}" rx="4" width="${lab.length * 6.4 + 12}" height="20" fill="#fff" stroke="#e7e6ec"/><text x="${lx}" y="${ly}" font-size="11" font-weight="600" fill="${col}">${lab}</text>`;
      }
    }
    // hover layer
    g += `<line id="hx" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#6146f6" stroke-width="1" opacity="0"/><g id="htip" opacity="0"><rect id="htipr" rx="6" fill="#140923" width="190" height="62"/><text id="htip1" fill="#fff" font-size="11" font-weight="600"></text><text id="htip2" fill="#d9d6e2" font-size="11"></text><text id="htip3" fill="#d9d6e2" font-size="11"></text></g>`;
    g += `<rect id="hover" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}">${g}</svg>`;
    const svg = el.querySelector('svg');
    const hov = svg.querySelector('#hover');
    hov.addEventListener('mousemove', (e) => {
      const pt = svg.getBoundingClientRect();
      const sx = ((e.clientX - pt.left) / pt.width) * W;
      const day = Math.round(((sx - m.l) / iw) * V.POC_DAYS);
      const r = rows.find((q) => q.day === day);
      if (!r) { svg.querySelector('#hx').setAttribute('opacity', 0); svg.querySelector('#htip').setAttribute('opacity', 0); return; }
      const X = x(day);
      svg.querySelector('#hx').setAttribute('x1', X); svg.querySelector('#hx').setAttribute('x2', X); svg.querySelector('#hx').setAttribute('opacity', 0.5);
      const tx = X + 200 > m.l + iw ? X - 198 : X + 8, ty = m.t + 8;
      const tip = svg.querySelector('#htip'); tip.setAttribute('opacity', 1);
      svg.querySelector('#htipr').setAttribute('x', tx); svg.querySelector('#htipr').setAttribute('y', ty);
      const t1 = svg.querySelector('#htip1'), t2 = svg.querySelector('#htip2'), t3 = svg.querySelector('#htip3');
      t1.setAttribute('x', tx + 10); t1.setAttribute('y', ty + 18); t1.textContent = `Day ${day} · ${mon(dateOf(p, day))}`;
      t2.setAttribute('x', tx + 10); t2.setAttribute('y', ty + 35);
      t3.setAttribute('x', tx + 10); t3.setAttribute('y', ty + 51);
      if (naive) { t2.textContent = `t-test: ${roi(r.naiveEst)} (${roi(r.naiveLo)} – ${roi(r.naiveHi)})`; }
      else { t2.textContent = `ROI ${roi(r.est)} (${roi(r.lo)} – ${roi(r.hi)})`; }
      t3.textContent = `${int(r.n)} matured members`;
    });
    hov.addEventListener('mouseleave', () => { svg.querySelector('#hx').setAttribute('opacity', 0); svg.querySelector('#htip').setAttribute('opacity', 0); });

    $('chartTitle').textContent = p.spec.program + ' · ROI trajectory';
    $('chartSub').textContent = naive
      ? `What a dashboard shows if it re-runs a fixed 95% t-test every day. Orange dots: days it would have "certified" 4X (${rows.filter((r) => r.naiveLo >= 4).length} of ${rows.length} days).`
      : `Incremental value per treated member ÷ Vi fee per member, vs. a ${pct(p.spec.holdout)} randomized holdout. Day ${p.today} of ${V.POC_DAYS}.`;
    $('legend').innerHTML = naive
      ? '<span><i class="ln" style="border-color:#4e4c55"></i>Difference in means</span><span><i class="dash" style="border-color:#8f8d96"></i>Fixed 95% interval, re-checked daily</span><span><i class="sw" style="background:#f08c2e;border-radius:50%;width:8px"></i>Would "certify" 4X</span>'
      : '<span><i class="ln" style="border-color:#6146f6"></i>ROI estimate (pre-period adjusted)</span><span><i class="sw" style="background:rgba(97,70,246,.22)"></i>95% anytime-valid range</span>' + (p.verdict.code === 'monitoring' ? '<span><i class="dash" style="border-color:#a79bf9"></i>Projected range if the effect holds</span>' : '');
  }

  // ---------- verdict ----------
  function renderVerdict() {
    const p = byId[state.sel], L = p.res.last, v = p.verdict;
    const dom = [-1, 12];
    const pos = (val) => ((Math.max(dom[0], Math.min(dom[1], val)) - dom[0]) / (dom[1] - dom[0])) * 100;
    const notes = {
      certified: `The lower end of the range has stayed above 4X since day ${v.day}, so the guarantee holds at 95% confidence even though this page has been checked every day.`,
      downside: `The whole range has been below 1X since day ${v.day}. Downside protection applies; pausing the program now saves about ${money(p.spec.fee * p.spec.perDay * 0.957 * (1 - p.spec.holdout) * Math.max(0, V.POC_DAYS - p.spec.window - p.today))} in remaining fees.`,
      below: `The range rules out 4X${L.lo >= 1 ? ' but confirms ROI above 1X' : ''}. Worth re-scoping targeting before the POC ends rather than waiting for day 90.`,
      monitoring: v.projected ? `Not decided yet. If today's effect holds, the lower bound crosses 4X around day ${v.projected}.` : `The estimate sits too close to 4X to separate in 90 days at this holdout size. A larger holdout or longer window would be needed.`
    };
    $('verdict').innerHTML = `
      <div class="v-top">${verdictPill(p)}<span class="muted small">Day ${p.today} of ${V.POC_DAYS}</span></div>
      <div style="margin-top:14px"><div class="v-program">${esc(p.spec.program)}</div><div class="v-client">${esc(p.spec.client)} · ${esc(p.spec.product)}</div></div>
      <div class="v-roi">${roi(L.est)}<small>estimated ROI</small></div>
      <div class="v-range">95% anytime-valid range <b>${roi(L.lo)} – ${roi(L.hi)}</b></div>
      <div class="rangebar"><div class="track"></div>
        <div class="band" style="left:${pos(L.lo)}%;width:${Math.max(1, pos(L.hi) - pos(L.lo))}%"></div>
        <div class="tick" style="left:${pos(1)}%;border-color:#d9534f"><b style="color:#c1352b">1X</b></div>
        <div class="tick" style="left:${pos(4)}%;border-color:#3d9a3d"><b style="color:#327818">4X</b></div>
        <div class="dot" style="left:${pos(L.est)}%"></div></div>
      <ul class="v-list">
        <li><span>Matured members</span><b>${int(L.n)} <span style="font-weight:400">(${int(L.nC)} holdout)</span></b></li>
        <li><span>Vi fees to date</span><b>${money(p.fees)}</b></li>
        <li><span>Incremental value</span><b>${money(p.value)}</b></li>
        <li><span>Noise removed by pre-period data</span><b>${pct(p.vr)}</b></li>
        <li><span>Decision</span><b>${decisionText(p, true)}</b></li>
      </ul>
      <div class="v-note">${notes[v.code]}</div>`;
  }

  // ---------- table ----------
  function renderTable() {
    const dom = [-1, 12];
    const pos = (val) => ((Math.max(dom[0], Math.min(dom[1], val)) - dom[0]) / (dom[1] - dom[0])) * 100;
    $('pilotCount').textContent = portfolio.length + ' results';
    $('tbl').innerHTML = `<thead><tr><th>Program</th><th>POC day</th><th>Holdout</th><th>Matured</th><th>ROI estimate</th><th>Anytime-valid range</th><th></th><th>Verdict</th><th>Decision</th></tr></thead><tbody>` +
      portfolio.map((p) => {
        const L = p.res.last;
        return `<tr data-id="${p.spec.id}" class="${p.spec.id === state.sel ? 'sel' : ''}">
          <td class="prog">${esc(p.spec.program)}<span class="sub2">${esc(p.spec.client)} · ${esc(p.spec.product)}</span></td>
          <td class="num">${p.today} / ${V.POC_DAYS}</td>
          <td class="num">${pct(p.spec.holdout)}</td>
          <td class="num">${int(L.n)}</td>
          <td class="num"><b>${roi(L.est)}</b></td>
          <td><div class="mini"><div class="t"></div><div class="r" style="left:${pos(1)}%"></div><div class="g" style="left:${pos(4)}%"></div><div class="b" style="left:${pos(L.lo)}%;width:${Math.max(1, pos(L.hi) - pos(L.lo))}%"></div><div class="m" style="left:${pos(L.est)}%"></div></div></td>
          <td class="num muted">${roi(L.lo)} – ${roi(L.hi)}</td>
          <td>${verdictPill(p)}</td>
          <td class="muted">${decisionText(p, false)}</td></tr>`;
      }).join('') + '</tbody>';
    $('tbl').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => select(tr.dataset.id)));
  }

  // ---------- replays (Web Worker, main-thread fallback) ----------
  function computeSims(spec, est) {
    const dec = V.simulateDecisionDays(V.withTrueROI(spec, Math.max(0.2, est)), SIM_REPS, 2026);
    const fal = V.falseCertification(V.withTrueROI(spec, 3.6), SIM_REPS, 4242);
    return { dec, fal, est: Math.max(0.2, est) };
  }
  let worker = null, verifying = null;
  function getWorker() {
    if (worker) return worker;
    try {
      const coreUrl = new URL('core.js', location.href).href;
      const src = `importScripts(${JSON.stringify(coreUrl)});
        onmessage = (e) => { const V = self.ViGuarantee; const { id, spec, est, reps } = e.data;
          const dec = V.simulateDecisionDays(V.withTrueROI(spec, Math.max(0.2, est)), reps, 2026);
          const fal = V.falseCertification(V.withTrueROI(spec, 3.6), reps, 4242);
          postMessage({ id, res: { dec, fal, est: Math.max(0.2, est) } }); };`;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = (e) => onLive(e.data.id, e.data.res);
      worker.onerror = () => { worker = null; };
    } catch (err) { worker = null; }
    return worker;
  }
  function onLive(id, res) {
    const prev = simCache[id];
    const same = prev && JSON.stringify(prev.dec) === JSON.stringify(res.dec) && JSON.stringify(prev.fal) === JSON.stringify(res.fal);
    simCache[id] = res; verifying = null;
    simCache[id].verified = prev ? (same ? 'match' : 'updated') : 'live';
    if (id === state.sel) renderSims();
  }
  function rerun() {
    const p = byId[state.sel];
    verifying = p.spec.id; renderSims();
    const w = getWorker();
    if (w) w.postMessage({ id: p.spec.id, spec: p.spec, est: p.res.last.est, reps: SIM_REPS });
    else setTimeout(() => onLive(p.spec.id, computeSims(p.spec, p.res.last.est)), 30);
  }
  function runSims() {
    if (simCache[state.sel] || verifying) return renderSims();
    rerun();
  }
  // replays.json is produced by scripts/precompute-replays.js from the same seeded core.js
  fetch('replays.json').then((r) => r.json()).then((j) => {
    for (const id in j.pilots) if (!simCache[id]) simCache[id] = Object.assign(j.pilots[id], { verified: null });
    if (verifying && simCache[verifying]) verifying = null;
    renderSims();
  }).catch(() => runSims());
  function renderSims() {
    const p = byId[state.sel], s = simCache[p.spec.id];
    if (!s || verifying === p.spec.id) {
      const ld = `<div class="loading"><div class="spin"></div>Replaying this pilot's design ${SIM_REPS} times in your browser…</div>`;
      $('simDays').innerHTML = ld; $('simFalse').innerHTML = ld; return;
    }
    const tag = s.verified === 'match' ? '<span class="pill green">Re-run in browser · identical</span>' : s.verified ? '<span class="pill violet">Computed in browser</span>' : '<button class="rerun" id="rerun"><i class="ti ti-refresh"></i>Re-run live</button>';
    const dA = s.dec.adj, dR = s.dec.raw;
    const w = (d) => (d == null ? 100 : (d / V.POC_DAYS) * 100);
    const lbl = (d) => (d == null ? '> day 90' : 'Day ' + d);
    let take;
    if (dA.median != null && dR.median != null) take = `With pre-period data the guarantee is decided a median of <b>${dR.median - dA.median} days sooner</b> (day ${dA.median} vs. day ${dR.median}).`;
    else if (dA.median != null) take = `With pre-period data the median pilot is decided by <b>day ${dA.median}</b>; without it, most replays (${pct(1 - dR.rate)}) are still undecided at day 90.`;
    else take = `At ${roi(s.est)}, the effect is too close to 4X: ${pct(1 - dA.rate)} of replays are still undecided at day 90 even with pre-period data.`;
    $('simDays').innerHTML = `<div class="sim-cap">Median first day the range certifies 4X or rules it out, across ${s.dec.reps} replays at today's estimate (${roi(s.est)}). ${tag}</div>
      <div class="bars">
        <div class="bar-row"><div class="lab">Pre-period adjusted<small>Decided by day 90: ${pct(dA.rate)}</small></div><div class="trk"><div class="fill violet" style="width:${w(dA.median)}%"></div></div><div class="val">${lbl(dA.median)}</div></div>
        <div class="bar-row"><div class="lab">Holdout comparison only<small>Decided by day 90: ${pct(dR.rate)}</small></div><div class="trk"><div class="fill soft" style="width:${w(dR.median)}%"></div></div><div class="val">${lbl(dR.median)}</div></div>
      </div><div class="sim-take">${take}</div>`;
    const f = s.fal;
    const fw = (r) => Math.max(0.6, (r / 0.3) * 100);
    $('simFalse').innerHTML = `<div class="sim-cap">Share of ${f.reps} replays with a true ROI of ${roi(f.trueROI)} (guarantee missed) that got "certified ≥ 4X" at some point when checked daily.</div>
      <div class="bars">
        <div class="bar-row"><div class="lab">Daily t-test<small>Fixed 95% interval, re-checked</small></div><div class="trk"><div class="fill gray" style="width:${fw(f.naive)}%"></div></div><div class="val">${pct(f.naive)}</div></div>
        <div class="bar-row"><div class="lab">Anytime-valid range<small>This feature (target ≤ 5%)</small></div><div class="trk"><div class="fill violet" style="width:${fw(f.cs)}%"></div></div><div class="val">${pct(f.cs)}</div></div>
      </div><div class="sim-take">Checking a fixed t-test every day would have certified the 4X guarantee for <b>${pct(f.naive)}</b> of pilots that missed it; the anytime-valid range did so for <b>${pct(f.cs)}</b>.</div>`;
    const rb = document.getElementById('rerun'); if (rb) rb.addEventListener('click', rerun);
    if (!$('assistant').hidden) renderAssistant();
  }

  // ---------- assistant ----------
  function renderAssistant() {
    const p = byId[state.sel], L = p.res.last, v = p.verdict, s = simCache[p.spec.id];
    let a;
    if (v.code === 'certified') a = `Yes. ${esc(p.spec.program)} is at ${roi(L.est)} with a 95% anytime-valid range of ${roi(L.lo)} to ${roi(L.hi)}. The lower bound crossed 4X on day ${v.day} (${mon(dateOf(p, v.day))}) and has stayed there, so the guarantee is certified today without waiting for day ${V.POC_DAYS}.`;
    else if (v.code === 'downside') a = `No. ${esc(p.spec.program)} is at ${roi(L.est)} (range ${roi(L.lo)} to ${roi(L.hi)}). ROI below 1X has been confirmed since day ${v.day}, so downside protection applies.`;
    else if (v.code === 'below') a = `Not at 4X. ${esc(p.spec.program)} is at ${roi(L.est)} (range ${roi(L.lo)} to ${roi(L.hi)}); 4X was ruled out on day ${v.day}.`;
    else a = `Not yet. ${esc(p.spec.program)} is at ${roi(L.est)} (range ${roi(L.lo)} to ${roi(L.hi)}). ${v.projected ? `If the effect holds, it certifies around day ${v.projected} (${mon(dateOf(p, v.projected))}).` : 'At this effect size it is unlikely to be decided by day 90.'}`;
    if (s) a += ` A daily t-test would have falsely certified ${pct(s.fal.naive)} of pilots like this one that really returned 3.6X.`;
    $('asBody').innerHTML = `<div class="msg-u">Can we certify the ${esc(p.spec.program)} guarantee yet?</div><div class="msg-v"><span class="as-av">Vi</span><div>${a}</div></div>`;
  }

  // ---------- interactions ----------
  function select(id) {
    state.sel = id;
    renderTable(); renderChart(); renderVerdict(); runSims();
    if (!$('assistant').hidden) renderAssistant();
  }
  $('seg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    $('seg').querySelectorAll('button').forEach((q) => q.classList.toggle('on', q === b));
    renderChart();
  }));
  $('fab').addEventListener('click', () => { const a = $('assistant'); a.hidden = !a.hidden; if (!a.hidden) renderAssistant(); });
  $('asClose').addEventListener('click', () => { $('assistant').hidden = true; });
  $('download').addEventListener('click', () => {
    const head = ['program', 'client', 'product', 'poc_day', 'holdout', 'matured_members', 'roi_estimate', 'range_low', 'range_high', 'verdict', 'decision'];
    const lines = [head.join(',')].concat(portfolio.map((p) => {
      const L = p.res.last;
      return [p.spec.program, p.spec.client, p.spec.product, p.today, p.spec.holdout, L.n, L.est.toFixed(3), L.lo.toFixed(3), L.hi.toFixed(3), p.verdict.code, decisionText(p, true)].map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',');
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'roi-guarantee-pilots.csv'; a.click();
  });
  window.addEventListener('resize', () => renderChart());

  const upd = new Date(Date.parse(V.TODAY_ISO + 'T00:00:00Z'));
  $('updated').textContent = 'Last updated: ' + upd.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + '-' + upd.getUTCDate() + '-' + upd.getUTCFullYear();
  // optional deep-link state: ?pilot=<id>&mode=naive&assistant=1
  const qs = new URLSearchParams(location.search);
  if (qs.get('pilot') && byId[qs.get('pilot')]) state.sel = qs.get('pilot');
  if (qs.get('mode') === 'naive') { state.mode = 'naive'; $('seg').querySelectorAll('button').forEach((q) => q.classList.toggle('on', q.dataset.mode === 'naive')); }
  renderKPIs(); renderTable(); renderChart(); renderVerdict(); renderSims();
  if (qs.get('assistant') === '1') { $('assistant').hidden = false; renderAssistant(); }
})();
