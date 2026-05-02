// DPI views: per-season leaderboard + chart, and the explainer page.

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

      // Header + selector
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
        `Custom rating designed to isolate driver skill from car performance. Quali rating uses teammate delta (car-controlled). Race rating uses weighted positions gained on Sunday. Higher = better; 50 is average.`));

      // Points vs DPI scatter
      const standings = new Map(season.finalDriverStandings.map(s => [s.driverId, s]));
      const points = dpi.drivers.filter(d => d.meanOverall != null).map(d => {
        const drv = drivers.get(d.driverId);
        const tm = constructors.get(d.team);
        return {
          driverId: d.driverId,
          driverName: drv?.fullName || drv?.name,
          team: tm?.name,
          x: standings.get(d.driverId)?.points || 0,
          y: d.meanOverall,
          label: drv?.abbreviation || drv?.lastName || d.driverId,
        };
      });

      const chartCard = UI.el('section', { class: 'card' },
        UI.h2({}, 'Points vs DPI'),
        UI.p({ class: 'muted' },
          'Drivers above the diagonal "punch above their car"; below means the car is doing the heavy lifting.')
      );
      const canvas = UI.el('canvas');
      chartCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
      view.appendChild(chartCard);

      // Leaderboard table
      view.appendChild(UI.el('section', { class: 'card' },
        UI.h2({}, 'Leaderboard'),
        UI.table(
          ['#', 'Driver', 'Team', 'Quali', 'Race', 'Overall', 'Mean Δ%', 'TM W-L', 'Pts'],
          dpi.drivers.map((d, i) => {
            const drv = drivers.get(d.driverId);
            const tm = constructors.get(d.team);
            const tmRecord = `${d.teammateBeats}-${d.teammateRaces - d.teammateBeats}`;
            const seasonPts = standings.get(d.driverId)?.points;
            return [
              { value: i + 1, class: 'pos' },
              UI.driverLink(drv),
              UI.constructorLink(tm),
              { value: DPI.fmtScore(d.meanQuali), class: 'pts' },
              { value: DPI.fmtScore(d.meanRace), class: 'pts' },
              UI.el('span', { class: 'pts',
                style: d.meanOverall != null ? `color:${DPI.scoreColor(d.meanOverall)};font-weight:700` : '' },
                DPI.fmtScore(d.meanOverall)),
              { value: d.meanQualiDelta != null ? DPI.fmtDelta(d.meanQualiDelta) : '—', class: 'mono' },
              { value: tmRecord, class: 'mono' },
              { value: seasonPts ?? '—', class: 'pts' },
            ];
          })
        )
      ));

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
              y: { title: { display: true, text: 'DPI overall', color: '#9aa3af' },
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
    const idx = await F1Data.manifest();

    const view = UI.div({});
    view.appendChild(UI.crumbs({ label: 'Home', href: '#/' }, { label: 'DPI' }));
    view.appendChild(UI.h1({}, 'Driver Performance Index'));
    view.appendChild(UI.el('section', { class: 'card', html: `
      <h2>The hypothesis</h2>
      <p>F1 qualifying time is dominated by car performance — so the only honest measurement of <em>driver</em> qualifying skill is the delta to your teammate, who is in identical machinery.</p>
      <p>Race results, on the other hand, reflect the driver: position gained from grid to finish is on you. Therefore:</p>
      <ul>
        <li><strong>Quali Rating (40%)</strong> = how well you beat your teammate to a tenth.</li>
        <li><strong>Racecraft Rating (60%)</strong> = how well you converted your starting position into a finish, weighted toward the front (P3→P1 is way harder than P19→P18).</li>
      </ul>

      <h2>Formulas</h2>
      <p><strong>Quali rating</strong> per race:<br>
      <code>Δ% = (t_driver − t_teammate) / t_teammate × 100</code><br>
      <code>QualiRating = clamp(50 − Δ% × 25, 0, 100)</code><br>
      A 1% advantage = 75; a 1% deficit = 25. Uses the deepest qualifying session both drivers reached (Q3, then Q2, Q1, then legacy single-session for pre-2003).</p>

      <p><strong>Racecraft rating</strong> per race:<br>
      <code>net = Σ(1/k for k in positions_gained) − Σ(1/k for k in positions_lost)</code><br>
      <code>Racecraft = clamp(50 + net × 25, 0, 100)</code><br>
      Each gained or lost position contributes <code>1/p</code>, where <code>p</code> is the position number — so gaining P3→P1 = 1/2 + 1/1 = 1.5 is much more valuable than P19→P18 = 1/18 = 0.056.</p>

      <p><strong>Overall</strong> = 0.40 × Quali + 0.60 × Racecraft. Season DPI is the average across non-excluded races.</p>

      <h2>Edge cases</h2>
      <ul>
        <li><strong>Mechanical DNF</strong>: race is excluded from racecraft (the driver kept the quali credit but Sunday is muted). The "leading by 20s and the engine dies on the last lap" case lives here — no penalty.</li>
        <li><strong>Driver-fault DNF</strong> (collision / accident / spun off): racecraft = 0.</li>
        <li><strong>No teammate / no qualifying time</strong>: that weekend's quali score is excluded from the average.</li>
        <li><strong>Pit-lane start (grid 0)</strong>: treated as P20 for weighting.</li>
      </ul>

      <h2>Things to watch for</h2>
      <p>This metric rewards midfield drivers who maximise low-grid starts (because gains compound through the field) just as much as it rewards front-runners who hold P1. It also penalises a driver who qualified well but bled positions on Sunday.</p>
      <p>It does <em>not</em> directly penalise drivers in slow cars — that's the whole point. A high DPI in a back-marker car is much more impressive than a high DPI in a front-runner.</p>
      <h2>Pick a season</h2>
    `}));

    const grid = UI.el('div', { class: 'grid grid-auto', style: 'margin-top:8px;' });
    for (const y of [...idx.years].reverse()) {
      grid.appendChild(UI.el('a', { href: `#/dpi/${y}`, class: 'card',
        style: 'text-align:center;padding:18px;cursor:pointer;' },
        UI.el('div', { style: 'font-size:24px;font-weight:700;font-family:var(--mono);' }, String(y)),
        UI.el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' }, 'View leaderboard')
      ));
    }
    view.appendChild(grid);

    // All-time leaderboard
    const [dpiAll, drivers] = await Promise.all([F1Data.dpiAll(), F1Data.driverMap()]);
    const minRaces = 50;
    const top = dpiAll
      .filter(d => d.totalRaces >= minRaces && d.meanOverall != null)
      .slice(0, 30);
    view.appendChild(UI.el('section', { class: 'card', style: 'margin-top:20px;' },
      UI.h2({}, 'All-time DPI leaderboard'),
      UI.p({ class: 'muted' },
        `Drivers with ${minRaces}+ races, ranked by career-weighted DPI overall.`),
      UI.table(
        ['#', 'Driver', 'Races', 'Mean Quali', 'Mean Race', 'Overall'],
        top.map((d, i) => {
          const drv = drivers.get(d.driverId);
          return [
            { value: i + 1, class: 'pos' },
            UI.driverLink(drv),
            { value: d.totalRaces, class: 'mono' },
            { value: DPI.fmtScore(d.meanQuali), class: 'pts' },
            { value: DPI.fmtScore(d.meanRace), class: 'pts' },
            UI.el('span', { class: 'pts',
              style: `color:${DPI.scoreColor(d.meanOverall)};font-weight:700` },
              DPI.fmtScore(d.meanOverall)),
          ];
        })
      )
    ));

    root.replaceChildren(view);
  },
};

window.DPISeasonView = DPISeasonView;
window.DPIExplainView = DPIExplainView;
