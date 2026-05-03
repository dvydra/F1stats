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
        'DPI v3: 30% Quali (teammate delta) + 40% Racecraft (points-weighted positions gained, DNF-adjusted) + 30% Finish (absolute result anchor). Sprints fold in at 0.3 weight; Bayesian-shrunk for sample size; Elo and DSC are orthogonal lenses.'));

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
          ['#', 'Driver', 'Team', 'R/Sp', 'Quali', 'Race', 'Finish', 'Overall', 'Best 75%', 'Shrunk', 'Δ%', 'TM', 'Pts', 'qElo'],
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
              { value: DPI.fmtScore(d.meanFinish), class: 'pts' },
              { value: DPI.fmtScore(d.meanOverallAdj), class: 'pts' },
              { value: DPI.fmtScore(d.best75Overall), class: 'pts' },
              UI.el('span', { class: 'pts',
                style: d.shrunkOverall != null ? `color:${DPI.scoreColor(d.shrunkOverall)};font-weight:700` : '' },
                DPI.fmtScore(d.shrunkOverall)),
              { value: d.meanQualiDelta != null ? DPI.fmtDelta(d.meanQualiDelta) : '—', class: 'mono' },
              { value: tmRecord, class: 'mono' },
              { value: seasonPts ?? '—', class: 'pts' },
              { value: d.qualiElo != null ? Math.round(d.qualiElo) : '—', class: 'mono' },
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
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const xMin = 0;
        const xMax = Math.max(...xs, 1);
        const yLo = Math.min(...ys);
        const yHi = Math.max(...ys);
        const yPad = Math.max((yHi - yLo) * 0.08, 1);
        const yMin = yLo - yPad;
        const yMax = yHi + yPad;

        new Chart(canvas, {
          type: 'scatter',
          data: { datasets: [{ data: points, parsing: false, pointRadius: 7,
            backgroundColor: points.map(p => DPI.scoreColor(p.y)),
            borderColor: '#0b0d10', borderWidth: 1 }] },
          options: { responsive: true, maintainAspectRatio: false,
            clip: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: {
              label: (ctx) => `${ctx.raw.driverName} (${ctx.raw.team}): ${ctx.raw.x} pts · DPI ${ctx.raw.y.toFixed(1)}` } } },
            scales: {
              x: { title: { display: true, text: 'Championship points', color: '#9aa3af' },
                   min: xMin, max: xMax,
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
              y: { title: { display: true, text: 'Shrunk DPI', color: '#9aa3af' },
                   min: yMin, max: yMax,
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
            },
          },
          plugins: [{
            id: 'diagonal',
            beforeDatasetsDraw(chart) {
              const { ctx, scales: { x, y }, chartArea } = chart;
              ctx.save();
              ctx.beginPath();
              ctx.rect(chartArea.left, chartArea.top,
                       chartArea.right - chartArea.left,
                       chartArea.bottom - chartArea.top);
              ctx.clip();
              ctx.strokeStyle = 'rgba(154,163,175,0.5)';
              ctx.lineWidth = 1.5;
              ctx.setLineDash([6, 5]);
              ctx.beginPath();
              ctx.moveTo(x.getPixelForValue(x.min), y.getPixelForValue(y.min));
              ctx.lineTo(x.getPixelForValue(x.max), y.getPixelForValue(y.max));
              ctx.stroke();
              ctx.restore();
            },
          }, {
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
    view.appendChild(UI.h1({}, 'Driver Performance Index — v3'));

    view.appendChild(UI.el('section', { class: 'card', html: `
      <h2>The hypothesis</h2>
      <p>F1 qualifying time is dominated by car performance, so a driver's true qualifying skill is the delta to their teammate (identical machinery). Race results reflect the driver: position gained from grid to finish, plus where you actually ended up.</p>

      <h2>The v3 formula</h2>
      <p><strong>Overall = 0.30·Quali + 0.40·Racecraft + 0.30·Finish</strong></p>

      <h3>Quali rating (30%)</h3>
      <p><code>Δ% = (t_driver − t_teammate) / t_teammate × 100</code><br>
      <code>QualiRating = clamp(50 − Δ% × 25, 0, 100)</code><br>
      Uses the deepest Q-session both drivers reached. A 1% advantage = 75; 1% deficit = 25.</p>

      <h3>Racecraft (40%) — points-weighted, DNF-adjusted</h3>
      <p>The earlier <code>1/k</code> weighting summed too generously across deep grids — a P20→P10 recovery was scoring as much as a P3→P1 win. v3 replaces it with the F1 points scale:</p>
      <p><code>v(p) = {25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0…}</code> for p = 1,2,3,…<br>
      <code>net = v(finish) − v(grid)</code><br>
      <code>Racecraft = clamp(50 + net × 2.5, 0, 100)</code></p>
      <p>So P3→P1 gains 10 points (75 score), P20→P10 gains 1 point (52.5 score), P1→P5 loses 15 points (12.5 score). DNF-adjusted: grid is re-ranked among finishers only so retirements ahead don't inflate gains.</p>

      <h3>Finish rating (30%) — absolute anchor</h3>
      <p><code>Finish = clamp(100 × (21 − finish) / 20, 0, 100)</code><br>
      P1 = 100, P5 = 80, P10 = 55, P15 = 30, P20 = 5. Driver-fault DNF = 0; mechanical DNF excluded.</p>
      <p>This is the term the v2 metric was missing. Without it, drivers in slow cars who consistently progressed through the field could out-score race winners. With it, "where you finished" is anchored back into the score.</p>

      <h2>Aggregation enrichments</h2>

      <h3>DNF-adjusted Racecraft</h3>
      <p>Re-ranks each driver's grid position <em>among finishers only</em> before computing the gain, so free positions from cars ahead retiring don't count.</p>

      <h3>Sprint-race contribution</h3>
      <p>Each sprint counts as 0.3 of a race in season aggregates. Sprint qualifying H2Hs also feed Elo.</p>

      <h3>Bayesian shrinkage (<code>shrunkOverall</code>)</h3>
      <p><code>shrunk = (n × observed + k × 50) / (n + k)</code> with <code>k = 10</code>. Pulls one-race-wonder scores toward the field mean.</p>

      <h3>Best-75% (<code>best75Overall</code>)</h3>
      <p>Drops the worst quartile of races — how F1 awarded the championship until 1990. Mutes unlucky weekends.</p>

      <h3>Pit-stop counts</h3>
      <p>Exposed per driver per race so users can spot strategy-driven gains. Without lap-by-lap data we can't fully attribute on-track vs pit-cycle passes.</p>

      <h3>Teammate Elo (<code>qElo</code>, <code>rElo</code>)</h3>
      <p>Each teammate qualifying H2H since 1950 updates a pair of Elo ratings (K = 24, init 1500). Sprint quali included. A separate race-finish Elo also runs. Solves the unbounded-teammate-quality problem.</p>

      <h3>Ridge driver/car decomposition (<code>DSC</code>)</h3>
      <p><code>log(t / median_in_session) = α_driver + β_team + ε</code> with L2 regularisation. <code>DSC = clamp(50 − α × 2500, 0, 100)</code>. Isolates driver effect from car effect using all of a season's quali data simultaneously.</p>

      <h2>Edge cases</h2>
      <ul>
        <li><strong>Mechanical DNF</strong> → racecraft <em>and</em> finish excluded; quali kept.</li>
        <li><strong>Driver-fault DNF</strong> (collision / accident / spun off) → racecraft = 0, finish = 0.</li>
        <li><strong>No teammate / no quali time</strong> → that race's quali excluded.</li>
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
