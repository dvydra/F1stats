// DPI views: per-season leaderboard + scatter, all-time leaderboards, explainer.

const DPISeasonView = {
  async render(root, year) {
    year = parseInt(year, 10);
    root.replaceChildren(UI.loading(`Loading ${year} DPI…`));
    try {
      const [season, dpi, drivers, constructors, idx] = await Promise.all([
        F1Data.season(year), F1Data.dpi(year),
        F1Data.driverMap(), F1Data.constructorMap(), F1Data.manifest(),
      ]);

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'DPI', href: '#/dpi' },
        { label: String(year) },
      ));

      const sel = UI.el('select', { onchange: (e) => location.hash = `#/dpi/${e.target.value}` });
      for (const y of [...idx.years].reverse()) {
        const o = UI.el('option', { value: y }, String(y));
        if (y === year) o.selected = true;
        sel.appendChild(o);
      }
      view.appendChild(UI.el('div', { class: 'selector-row' },
        UI.h1({}, `${year} Driver Performance Index`),
        sel,
        UI.el('a', { class: 'btn ghost', href: `#/dpi` }, 'Method'),
      ));
      view.appendChild(UI.p({ class: 'muted' },
        'DPI v2: car-adjusted via teammate qualifying delta; race score uses DNF-adjusted weighted positions gained; sprints fold in at 0.3 weight; Bayesian-shrunk for sample size; Elo and ridge-decomposition columns expose orthogonal lenses on the same season.'));

      // Points vs DPI scatter (uses shrunkOverall — the recommended metric)
      const standings = new Map(season.finalDriverStandings.map(s => [s.driverId, s]));
      const points = dpi.drivers.filter(d => d.shrunkOverall != null).map(d => {
        const drv = drivers.get(d.driverId);
        const tm = constructors.get(d.team);
        return {
          driverId: d.driverId,
          driverName: drv?.fullName || drv?.name,
          team: tm?.name,
          x: standings.get(d.driverId)?.points || 0,
          y: d.shrunkOverall,
          label: drv?.abbreviation || drv?.lastName || d.driverId,
        };
      });

      const chartCard = UI.el('section', { class: 'card' },
        UI.h2({}, 'Points vs shrunken DPI'),
        UI.p({ class: 'muted' },
          'Drivers above the diagonal are punching above their car. Colour = DPI score (red→green). Hover for details.'));
      const canvas = UI.el('canvas');
      chartCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
      view.appendChild(chartCard);

      // Leaderboard with all v2 metrics
      view.appendChild(UI.el('section', { class: 'card' },
        UI.el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;' },
          UI.h2({}, 'Season leaderboard'),
          UI.el('div', { class: 'muted', style: 'font-size:12px;' },
            'Δ% = mean teammate quali delta · TM = teammate H2H wins · Sp = sprints')),
        UI.table(
          ['#', 'Driver', 'Team', 'R/Sp', 'Quali', 'Race (adj)', 'Overall', 'Best 75%', 'Shrunk', 'Δ%', 'TM', 'Pts', 'qElo', 'DSC'],
          dpi.drivers.map((d, i) => {
            const drv = drivers.get(d.driverId);
            const tm = constructors.get(d.team);
            const tmRecord = `${d.teammateBeats}-${d.teammateRaces - d.teammateBeats}`;
            const seasonPts = standings.get(d.driverId)?.points;
            return [
              { value: i + 1, class: 'pos' },
              UI.driverLink(drv),
              UI.constructorLink(tm),
              { value: `${d.races}/${d.sprints}`, class: 'mono' },
              { value: DPI.fmtScore(d.meanQuali), class: 'pts' },
              { value: DPI.fmtScore(d.meanRaceAdj), class: 'pts' },
              { value: DPI.fmtScore(d.meanOverallAdj), class: 'pts' },
              { value: DPI.fmtScore(d.best75Overall), class: 'pts' },
              UI.el('span', { class: 'pts',
                style: d.shrunkOverall != null ? `color:${DPI.scoreColor(d.shrunkOverall)};font-weight:700` : '' },
                DPI.fmtScore(d.shrunkOverall)),
              { value: d.meanQualiDelta != null ? DPI.fmtDelta(d.meanQualiDelta) : '—', class: 'mono' },
              { value: tmRecord, class: 'mono' },
              { value: seasonPts ?? '—', class: 'pts' },
              { value: d.qualiElo != null ? Math.round(d.qualiElo) : '—', class: 'mono' },
              { value: DPI.fmtScore(d.dscScore), class: 'pts' },
            ];
          })
        )
      ));

      // Per-team DSC ("car effect" — most negative = fastest car)
      const dscTeamRows = Object.entries(dpi.dscTeams || {})
        .map(([tid, alpha]) => ({ tid, alpha, c: constructors.get(tid) }))
        .filter(x => x.c)
        .sort((a, b) => a.alpha - b.alpha);  // most negative first = fastest
      if (dscTeamRows.length) {
        view.appendChild(UI.el('section', { class: 'card' },
          UI.h2({}, 'Ridge-decomposed car pace'),
          UI.p({ class: 'muted' },
            'Pure car effect from the season qualifying decomposition (driver effect held constant). More negative = faster machinery, expressed as log-time relative to the field median.'),
          UI.table(
            ['#', 'Constructor', 'Car effect (log-time)', 'Implied % advantage'],
            dscTeamRows.map((x, i) => [
              { value: i + 1, class: 'pos' },
              UI.constructorLink(x.c),
              { value: x.alpha.toFixed(5), class: 'mono' },
              { value: `${(-x.alpha * 100).toFixed(2)}%`, class: 'mono' },
            ])
          )
        ));
      }

      root.replaceChildren(view);

      setTimeout(() => {
        new Chart(canvas, {
          type: 'scatter',
          data: { datasets: [{ data: points, parsing: false, pointRadius: 7,
            backgroundColor: points.map(p => DPI.scoreColor(p.y)),
            borderColor: '#0b0d10', borderWidth: 1 }] },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: {
              label: (ctx) => `${ctx.raw.driverName} (${ctx.raw.team}): ${ctx.raw.x} pts · DPI ${ctx.raw.y.toFixed(1)}` } } },
            scales: {
              x: { title: { display: true, text: 'Championship points', color: '#9aa3af' },
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
              y: { title: { display: true, text: 'Shrunk DPI', color: '#9aa3af' },
                   suggestedMin: 0, suggestedMax: 100,
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
            },
          },
          plugins: [{
            id: 'driverLabels',
            afterDatasetsDraw(chart) {
              const { ctx } = chart;
              const meta = chart.getDatasetMeta(0);
              ctx.save();
              ctx.fillStyle = '#e6e9ee';
              ctx.font = '11px ui-monospace, monospace';
              for (let i = 0; i < meta.data.length; i++) {
                const pt = meta.data[i];
                ctx.fillText(points[i].label, pt.x + 9, pt.y + 4);
              }
              ctx.restore();
            },
          }],
        });
      }, 10);
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load DPI: ' + e.message));
      console.error(e);
    }
  },
};

const DPIExplainView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading…'));
    const [idx, dpiAll, drivers] = await Promise.all([
      F1Data.manifest(), F1Data.dpiAll(), F1Data.driverMap(),
    ]);

    const view = UI.div({});
    view.appendChild(UI.crumbs({ label: 'Home', href: '#/' }, { label: 'DPI' }));
    view.appendChild(UI.h1({}, 'Driver Performance Index — v2'));

    view.appendChild(UI.el('section', { class: 'card', html: `
      <h2>The hypothesis</h2>
      <p>F1 qualifying time is dominated by car performance, so a driver's true qualifying skill is the delta to their teammate (identical machinery). Race results, on the other hand, reflect the driver: position gained from grid to finish.</p>

      <h2>v1 — the original metric</h2>
      <p><strong>Quali rating</strong> per race:<br>
      <code>Δ% = (t_driver − t_teammate) / t_teammate × 100</code><br>
      <code>QualiRating = clamp(50 − Δ% × 25, 0, 100)</code></p>
      <p><strong>Racecraft rating</strong> per race:<br>
      <code>net = Σ(1/k for k in positions_gained) − Σ(1/k for k in positions_lost)</code><br>
      <code>Racecraft = clamp(50 + net × 25, 0, 100)</code></p>
      <p><strong>Overall</strong> = 0.40 × Quali + 0.60 × Racecraft</p>

      <h2>v2 — the enrichments</h2>

      <h3>1. DNF-adjusted Racecraft</h3>
      <p>Free positions (gained because cars ahead retired) inflate v1's racecraft. v2 re-ranks each driver's grid position <em>among finishers only</em> before computing the gain. If three cars from grid 2/5/7 retire and you started P10 → P5, your adjusted gain is 7 → 5 (= +2 weighted), not 10 → 5 (= +5).</p>

      <h3>2. Sprint-race contribution</h3>
      <p>Each sprint counts as 0.3 of a race in season aggregates — short, noisier, but real H2H data. Sprint qualifying H2Hs also feed Elo.</p>

      <h3>3. Bayesian shrinkage (<code>shrunkOverall</code>)</h3>
      <p>One-race wonders shouldn't sit at 100/100. Each driver's season mean is shrunk toward the field prior of 50:<br>
      <code>shrunk = (n × observed + k × 50) / (n + k)</code> with <code>k = 10</code>.<br>
      A driver with 2 races at 95 → shrunk to ≈87. With 24 races at 95 → ≈82. With 1 race at 100 → ≈54.</p>

      <h3>4. Best-75% (<code>best75Overall</code>)</h3>
      <p>Drops the worst 25% of races before averaging — historically how F1 awarded the championship until 1990. Mutes unlucky weekends without throwing them away entirely.</p>

      <h3>5. Pit-stop counts</h3>
      <p>We expose pit-stop counts per driver per race so users can spot strategy-driven gains. Without lap-by-lap data we can't fully attribute on-track vs pit-cycle passes — but the count is now visible alongside the result.</p>

      <h3>6. Teammate Elo</h3>
      <p>Each teammate qualifying H2H since 1950 updates a pair of Elo ratings (K = 24, init 1500). Sprint quali also counted. A separate Elo runs for finishing position H2H. Elo solves the unbounded-teammate-quality problem in DPI: beating a 4-time champion is now mechanically harder to register than beating a rookie.</p>

      <h3>7. Ridge driver/car decomposition (<code>DSC</code>)</h3>
      <p>For each season we fit a ridge-regularized linear model:<br>
      <code>log(t / median_in_session) = α_driver + β_team + ε</code><br>
      The driver coefficient α isolates who is fast independent of the car. Negative α = faster than expected. We map it to a 0-100 score: <code>DSC = clamp(50 − α × 2500, 0, 100)</code>. Ridge regularisation gives natural Bayesian-style shrinkage so small samples don't blow up.</p>

      <h2>Edge cases</h2>
      <ul>
        <li><strong>Mechanical DNF</strong> → racecraft excluded, quali kept. The "leading by 20s and the engine dies" case lives here.</li>
        <li><strong>Driver-fault DNF</strong> (collision / accident / spun off) → racecraft = 0.</li>
        <li><strong>No teammate / no quali time</strong> → that race's quali score excluded.</li>
        <li><strong>Pit-lane start (grid 0)</strong> → treated as P20.</li>
      </ul>

      <h2>Known limits</h2>
      <ul>
        <li>No track-character normalisation (a 0.3% Monaco delta ≠ 0.3% at Monza qualitatively).</li>
        <li>No on-track vs pit-cycle pass attribution — needs lap-by-lap data, not in f1db.</li>
        <li>No wet-weather flag.</li>
        <li>DSC uses qualifying only, not race pace.</li>
      </ul>
    `}));

    // Pick season
    view.appendChild(UI.h2({}, 'Pick a season'));
    const grid = UI.el('div', { class: 'grid grid-auto', style: 'margin-top:8px;' });
    for (const y of [...idx.years].reverse()) {
      grid.appendChild(UI.el('a', { href: `#/dpi/${y}`, class: 'card',
        style: 'text-align:center;padding:18px;cursor:pointer;' },
        UI.el('div', { style: 'font-size:24px;font-weight:700;font-family:var(--mono);' }, String(y)),
        UI.el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' }, 'View leaderboard')
      ));
    }
    view.appendChild(grid);

    // ── All-time leaderboards (multiple, since metrics are orthogonal) ──
    const minRaces = 50;
    const filt = dpiAll.filter(d => (d.totalRaces || 0) >= minRaces);

    function leaderboard(title, blurb, sortKey, formatter, columns = 30) {
      const sorted = [...filt]
        .filter(d => d[sortKey] != null)
        .sort((a, b) => (b[sortKey] - a[sortKey]))
        .slice(0, columns);
      return UI.el('section', { class: 'card', style: 'margin-top:18px;' },
        UI.h2({}, title),
        UI.p({ class: 'muted' }, blurb),
        UI.table(
          ['#', 'Driver', 'Races', sortKey === 'qualiElo' || sortKey === 'raceElo' ? 'Elo' : 'Score'],
          sorted.map((d, i) => [
            { value: i + 1, class: 'pos' },
            UI.driverLink(drivers.get(d.driverId)),
            { value: d.totalRaces, class: 'mono' },
            UI.el('span', { class: 'pts',
              style: sortKey !== 'qualiElo' && sortKey !== 'raceElo'
                ? `color:${DPI.scoreColor(d[sortKey])};font-weight:700` : 'font-weight:700' },
              formatter(d[sortKey])),
          ])
        )
      );
    }

    view.appendChild(leaderboard(
      'All-time DPI (shrunkOverall)',
      `Bayesian-shrunk season DPI averaged over career. ≥${minRaces} races. Surfaces sustained excellence rather than one-hit wonders.`,
      'shrunkOverall', x => DPI.fmtScore(x)));

    view.appendChild(leaderboard(
      'All-time qualifying Elo',
      `Teammate-only qualifying H2H Elo. Started at 1500, K = 24. Solves the "beating Hamilton vs beating a rookie" problem in raw DPI.`,
      'qualiElo', x => Math.round(x).toString()));

    view.appendChild(leaderboard(
      'All-time race-finish Elo',
      `Teammate-only finish-position H2H Elo. Both drivers must have finished. Less car-distorted than championship points.`,
      'raceElo', x => Math.round(x).toString()));

    view.appendChild(leaderboard(
      'All-time DSC',
      `Ridge-decomposed driver skill coefficient — qualifying time isolated from car effect. ${minRaces}+ races. Caps at 100 in eras with sparse teammate data.`,
      'meanDsc', x => DPI.fmtScore(x)));

    view.appendChild(leaderboard(
      'All-time best-75% DPI',
      `Career mean of season best-75% scores — drops worst quartile of races to mute unlucky weekends.`,
      'best75Overall', x => DPI.fmtScore(x)));

    root.replaceChildren(view);
  },
};

window.DPISeasonView = DPISeasonView;
window.DPIExplainView = DPIExplainView;
