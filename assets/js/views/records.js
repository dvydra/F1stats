// Records hub — multiple all-time leaderboards & scatters in one place.
// Anchors via #/records/<topic> hash for shareable deep-links.

const RecordsView = {
  async render(root, topic) {
    root.replaceChildren(UI.loading('Loading records…'));
    const [drivers, dpiAll, search, dscMap, comebacks, circuits, ptw, drama,
           engineStats, dynasties, manifest, constructors, dnfReasons] = await Promise.all([
      F1Data.driverMap(), F1Data.dpiAll(), F1Data.driverSearch(),
      F1Data.constructorDsc(), F1Data.comebacks(), F1Data.circuitStats(),
      F1Data.poleToWin(), F1Data.seasonDrama(), F1Data.engineStats(),
      F1Data.dynasties(), F1Data.manifest(), F1Data.constructorMap(),
      F1Data.dnfReasons(),
    ]);
    const searchById = new Map(search.map(s => [s.id, s]));
    const dpiById = new Map(dpiAll.map(d => [d.driverId, d]));

    const view = UI.div({});
    view.appendChild(UI.crumbs({ label: 'Home', href: '#/' }, { label: 'Records' }));
    view.appendChild(UI.h1({}, 'Records & curiosities'));
    view.appendChild(UI.p({ class: 'muted' },
      'Cross-cutting leaderboards built from the same baked data. Pick a topic.'));

    const topics = [
      { id: 'personality',  label: 'Quali vs Race personality', desc: 'Career qElo vs rElo scatter' },
      { id: 'reliability',  label: 'Reliability vs Speed',      desc: 'qElo vs DNF % scatter' },
      { id: 'comebacks',    label: 'Biggest comebacks',         desc: 'Largest grid → finish climbs ever' },
      { id: 'cars',         label: 'Best cars in F1 history',   desc: 'Ridge-decomposed DSC alpha all-time' },
      { id: 'unlucky',      label: 'Best non-champions',        desc: 'Highest DPI, never won a title' },
      { id: 'eras',         label: 'Era leaderboards',          desc: 'Top drivers by decade' },
      { id: 'improvers',    label: 'Most improved (per year)',  desc: 'Biggest YoY DPI jumps' },
      { id: 'poles',        label: 'Pole → win conversion',     desc: 'Who actually closes from pole' },
      { id: 'dynasties',    label: 'F1 family dynasties',       desc: 'Father vs son, brother vs brother' },
      { id: 'drama',        label: 'Most dramatic seasons',     desc: 'Lead changes + late title clinches' },
      { id: 'age',          label: 'Performance vs age',        desc: 'How drivers peak and fall off' },
      { id: 'dnfreasons',   label: 'How drivers retire',        desc: 'Driver-fault vs mechanical breakdown' },
    ];

    // Topic nav strip.
    const navStrip = UI.el('div', { class: 'records-nav' });
    for (const t of topics) {
      const a = UI.el('a', {
        href: `#/records/${t.id}`,
        class: 'records-nav-link' + (t.id === topic ? ' active' : ''),
      }, t.label);
      navStrip.appendChild(a);
    }
    view.appendChild(navStrip);

    const content = UI.div({});
    view.appendChild(content);

    // Default: hub with cards.
    if (!topic) {
      const grid = UI.el('div', { class: 'grid grid-auto', style: 'margin-top:18px;' });
      for (const t of topics) {
        grid.appendChild(UI.el('a', { href: `#/records/${t.id}`, class: 'card',
          style: 'padding:18px;cursor:pointer;display:block;' },
          UI.el('div', { style: 'font-size:16px;font-weight:700;margin-bottom:6px;' }, t.label),
          UI.el('div', { class: 'muted', style: 'font-size:13px;' }, t.desc),
        ));
      }
      content.appendChild(grid);
      root.replaceChildren(view);
      return;
    }

    // Per-topic render.
    const render = {
      personality:  () => personality(),
      reliability:  () => reliability(),
      comebacks:    () => comebacksView(),
      cars:         () => carsView(),
      unlucky:      () => unluckyView(),
      eras:         () => erasView(),
      improvers:    () => improversView(),
      poles:        () => polesView(),
      dynasties:    () => dynastiesView(),
      drama:        () => dramaView(),
      age:          () => ageView(),
      dnfreasons:   () => dnfReasonsView(),
    };
    if (render[topic]) {
      content.appendChild(render[topic]());
    } else {
      content.appendChild(UI.errorBox(`Unknown topic: ${topic}`));
    }
    root.replaceChildren(view);

    // ─────────────────────────── Topic implementations ───────────────────────────

    function personality() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Quali vs Race personality'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Career qualifying Elo (x) vs race-finish Elo (y) — both teammate-only H2H, K=24, init 1500. ' +
        'Above the diagonal = better racer than qualifier (recovers on Sunday). ' +
        'Below = better qualifier than racer (great Saturdays, struggle to convert).'));
      const minRaces = 50;
      const points = dpiAll
        .filter(d => d.qualiElo != null && d.raceElo != null && (d.totalRaces || 0) >= minRaces)
        .map(d => {
          const drv = drivers.get(d.driverId);
          return {
            x: d.qualiElo, y: d.raceElo,
            label: drv?.abbreviation || drv?.lastName || d.driverId,
            driverName: drv?.fullName || drv?.name || d.driverId,
            races: d.totalRaces,
            driverId: d.driverId,
          };
        });
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const lo = Math.min(...xs, ...ys, 1500) - 30;
      const hi = Math.max(...xs, ...ys, 1500) + 30;
      const canvas = UI.el('canvas');
      wrap.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
      setTimeout(() => new Chart(canvas, {
        type: 'scatter',
        data: { datasets: [{ data: points, parsing: false, pointRadius: 5,
          backgroundColor: '#1f8efa', borderColor: '#0b0d10', borderWidth: 1 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              label: (ctx) => `${ctx.raw.driverName} — qElo ${ctx.raw.x.toFixed(0)}, rElo ${ctx.raw.y.toFixed(0)} (${ctx.raw.races} races)`,
            } },
          },
          scales: {
            x: { min: lo, max: hi, title: { display: true, text: 'Quali Elo (career)', color: '#9aa3af' },
                 ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
            y: { min: lo, max: hi, title: { display: true, text: 'Race Elo (career)', color: '#9aa3af' },
                 ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
          },
        },
        plugins: [{
          id: 'diag',
          beforeDatasetsDraw(chart) {
            const { ctx, scales: { x, y }, chartArea } = chart;
            ctx.save();
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top,
                     chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
            ctx.clip();
            ctx.strokeStyle = 'rgba(154,163,175,0.5)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6,5]);
            ctx.beginPath();
            ctx.moveTo(x.getPixelForValue(lo), y.getPixelForValue(lo));
            ctx.lineTo(x.getPixelForValue(hi), y.getPixelForValue(hi));
            ctx.stroke();
            ctx.restore();
          },
        }, {
          id: 'labels',
          afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            ctx.save();
            ctx.fillStyle = '#e6e9ee';
            ctx.font = '10px ui-monospace, monospace';
            for (let i = 0; i < meta.data.length; i++) {
              ctx.fillText(points[i].label, meta.data[i].x + 7, meta.data[i].y + 3);
            }
            ctx.restore();
          },
        }],
      }), 10);
      wrap.appendChild(topListByDelta('Above the diagonal (race specialists)',
        d => d.raceElo - d.qualiElo, true));
      wrap.appendChild(topListByDelta('Below the diagonal (quali specialists)',
        d => d.qualiElo - d.raceElo, true));
      return wrap;
    }

    function topListByDelta(title, scorer, _) {
      const minRaces = 50;
      const rows = dpiAll
        .filter(d => d.qualiElo != null && d.raceElo != null && (d.totalRaces || 0) >= minRaces)
        .map(d => ({ d, delta: scorer(d) }))
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 12);
      return UI.el('section', { class: 'card', style: 'margin-top:14px;' },
        UI.h3({}, title),
        UI.table(
          ['#', 'Driver', 'qElo', 'rElo', 'Δ'],
          rows.map((row, i) => {
            const drv = drivers.get(row.d.driverId);
            return [
              { value: i + 1, class: 'pos' },
              UI.driverLink(drv),
              { value: Math.round(row.d.qualiElo), class: 'mono' },
              { value: Math.round(row.d.raceElo), class: 'mono' },
              { value: (row.delta >= 0 ? '+' : '') + Math.round(row.delta), class: 'pts' },
            ];
          }),
        ),
      );
    }

    function reliability() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Reliability vs Speed'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Career qualifying Elo (x) vs DNF rate (y, inverted so up = more reliable). ' +
        'Top-right = fast and reliable; top-left = reliable but slow; ' +
        'bottom-right = fast but fragile (the de Cesaris quadrant).'));
      const minRaces = 50;
      const rows = dpiAll
        .filter(d => d.qualiElo != null && (d.totalRaces || 0) >= minRaces)
        .map(d => {
          const s = searchById.get(d.driverId);
          if (!s || s.dnfPct == null) return null;
          const drv = drivers.get(d.driverId);
          return {
            x: d.qualiElo, y: 100 - s.dnfPct,
            label: drv?.abbreviation || drv?.lastName || d.driverId,
            driverName: drv?.fullName || drv?.name || d.driverId,
            races: d.totalRaces, dnfPct: s.dnfPct, driverId: d.driverId,
          };
        })
        .filter(Boolean);
      const canvas = UI.el('canvas');
      wrap.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
      setTimeout(() => new Chart(canvas, {
        type: 'scatter',
        data: { datasets: [{ data: rows, parsing: false, pointRadius: 5,
          backgroundColor: '#7bd389', borderColor: '#0b0d10', borderWidth: 1 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              label: (ctx) => `${ctx.raw.driverName} — qElo ${ctx.raw.x.toFixed(0)}, finish-rate ${ctx.raw.y.toFixed(1)}% (DNF ${ctx.raw.dnfPct.toFixed(1)}%)`,
            } },
          },
          scales: {
            x: { title: { display: true, text: 'Quali Elo (career)', color: '#9aa3af' },
                 ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
            y: { min: 0, max: 100, title: { display: true, text: 'Finish rate (100% = no DNFs)', color: '#9aa3af' },
                 ticks: { color: '#9aa3af', callback: v => v + '%' }, grid: { color: '#2a313a' } },
          },
        },
        plugins: [{
          id: 'labels',
          afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            ctx.save();
            ctx.fillStyle = '#e6e9ee';
            ctx.font = '10px ui-monospace, monospace';
            for (let i = 0; i < meta.data.length; i++) {
              ctx.fillText(rows[i].label, meta.data[i].x + 7, meta.data[i].y + 3);
            }
            ctx.restore();
          },
        }],
      }), 10);
      return wrap;
    }

    function comebacksView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Biggest comebacks in F1 history'));
      wrap.appendChild(UI.p({ class: 'muted' },
        `Single-race grid → finish climbs across ${comebacks.length} top results. ` +
        `Δ = positions gained; Δadj uses DNF-aware grid re-ranking (free positions ` +
        `from cars retiring ahead don't count).`));
      wrap.appendChild(UI.table(
        ['#', 'Year', 'Race', 'Driver', 'Team', 'Grid', 'Finish', 'Δ', 'Δ adj'],
        comebacks.slice(0, 200).map((c, i) => {
          const drv = drivers.get(c.driverId);
          const cstr = constructors.get(c.constructorId);
          return [
            { value: i + 1, class: 'pos' },
            { value: c.year, class: 'mono' },
            UI.el('a', { href: `#/season/${c.year}/race/${c.round}` }, c.raceName),
            UI.driverLink(drv),
            UI.constructorLink(cstr),
            { value: c.grid, class: 'mono' },
            { value: c.finish, class: `pos ${UI.posClass(c.finish)}` },
            { value: c.delta, class: 'pts' },
            { value: c.deltaAdj, class: 'mono' },
          ];
        }),
      ));
      return wrap;
    }

    function carsView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Best cars in F1 history'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Every (team, year) ranked by ridge-decomposed DSC alpha — pure car effect ' +
        'after holding driver skill constant. Negative alpha = faster than the field. ' +
        'Sorted ascending (most-dominant car at the top).'));
      const rows = [];
      for (const [tid, byYear] of Object.entries(dscMap)) {
        const c = constructors.get(tid);
        for (const [year, alpha] of Object.entries(byYear)) {
          rows.push({ tid, c, year: parseInt(year, 10), alpha });
        }
      }
      rows.sort((a, b) => a.alpha - b.alpha);
      wrap.appendChild(UI.table(
        ['#', 'Year', 'Constructor', 'DSC α', 'Implied advantage'],
        rows.slice(0, 200).map((r, i) => [
          { value: i + 1, class: 'pos' },
          UI.yearLabel(r.year, manifest, { href: `#/dpi/${r.year}` }),
          UI.constructorLink(r.c),
          { value: r.alpha.toFixed(5), class: 'mono' },
          { value: `${(-r.alpha * 100).toFixed(2)}%`, class: 'pts' },
        ]),
      ));
      return wrap;
    }

    function unluckyView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Best non-champions'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Highest career-DPI drivers who never won a Drivers\' Championship. ' +
        'Filtered to ≥50 races so career averages are meaningful.'));
      const rows = dpiAll
        .filter(d => (d.totalRaces || 0) >= 50 && d.shrunkOverall != null)
        .filter(d => {
          const drv = drivers.get(d.driverId);
          return drv && (drv.totalChampionshipWins || 0) === 0;
        })
        .sort((a, b) => b.shrunkOverall - a.shrunkOverall)
        .slice(0, 50);
      wrap.appendChild(UI.table(
        ['#', 'Driver', 'Races', 'Wins', 'Best WDC', 'Shrunk DPI', 'qElo', 'rElo'],
        rows.map((d, i) => {
          const drv = drivers.get(d.driverId);
          return [
            { value: i + 1, class: 'pos' },
            UI.driverLink(drv),
            { value: d.totalRaces, class: 'mono' },
            { value: drv?.totalRaceWins ?? '—', class: 'pts' },
            { value: drv?.bestChampionshipPosition ?? '—', class: 'mono' },
            UI.el('span', { class: 'pts',
              style: `color:${DPI.scoreColor(d.shrunkOverall)};font-weight:700` },
              DPI.fmtScore(d.shrunkOverall)),
            { value: d.qualiElo != null ? Math.round(d.qualiElo) : '—', class: 'mono' },
            { value: d.raceElo != null ? Math.round(d.raceElo) : '—', class: 'mono' },
          ];
        }),
      ));
      return wrap;
    }

    function erasView() {
      const wrap = UI.div({});
      const decades = [
        { label: '1950s', range: [1950, 1959] },
        { label: '1960s', range: [1960, 1969] },
        { label: '1970s', range: [1970, 1979] },
        { label: '1980s', range: [1980, 1989] },
        { label: '1990s', range: [1990, 1999] },
        { label: '2000s', range: [2000, 2009] },
        { label: '2010s', range: [2010, 2019] },
        { label: '2020s', range: [2020, 2029] },
      ];
      for (const dec of decades) {
        const [lo, hi] = dec.range;
        const scored = [];
        for (const d of dpiAll) {
          const seasons = (d.seasons || []).filter(s => s.year >= lo && s.year <= hi);
          if (!seasons.length) continue;
          const totalR = seasons.reduce((a, s) => a + (s.races || 0), 0);
          if (totalR < 20) continue;
          const sumDPI = seasons.reduce((a, s) =>
            a + ((s.shrunkOverall ?? s.meanOverall ?? 50) * (s.races || 0)), 0);
          scored.push({
            driverId: d.driverId,
            decadeRaces: totalR,
            decadeDPI: sumDPI / totalR,
            decadeSeasons: seasons.length,
          });
        }
        scored.sort((a, b) => b.decadeDPI - a.decadeDPI);
        wrap.appendChild(UI.el('section', { class: 'card', style: 'margin-bottom:14px;' },
          UI.h3({}, `${dec.label} — top by DPI`),
          UI.table(
            ['#', 'Driver', 'Seasons', 'Races', 'DPI'],
            scored.slice(0, 10).map((r, i) => {
              const drv = drivers.get(r.driverId);
              return [
                { value: i + 1, class: 'pos' },
                UI.driverLink(drv),
                { value: r.decadeSeasons, class: 'mono' },
                { value: r.decadeRaces, class: 'mono' },
                UI.el('span', { class: 'pts',
                  style: `color:${DPI.scoreColor(r.decadeDPI)};font-weight:700` },
                  DPI.fmtScore(r.decadeDPI)),
              ];
            }),
          ),
        ));
      }
      return wrap;
    }

    function improversView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Most-improved driver of the year'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'For each season, the driver with the biggest year-on-year jump in shrunk DPI. ' +
        'Filtered to drivers with ≥6 races in both the prior and current year.'));
      const yearly = {};
      for (const d of dpiAll) {
        const seasons = d.seasons || [];
        const byYear = new Map(seasons.map(s => [s.year, s]));
        for (const s of seasons) {
          const prior = byYear.get(s.year - 1);
          if (!prior) continue;
          if ((s.races || 0) < 6 || (prior.races || 0) < 6) continue;
          const cur = s.shrunkOverall ?? s.meanOverall;
          const pre = prior.shrunkOverall ?? prior.meanOverall;
          if (cur == null || pre == null) continue;
          const jump = cur - pre;
          (yearly[s.year] ||= []).push({
            driverId: d.driverId, jump,
            cur, pre, races: s.races,
          });
        }
      }
      const years = Object.keys(yearly).map(y => parseInt(y)).sort((a, b) => b - a);
      const tbl = UI.table(
        ['Year', 'Driver', 'Prior DPI', 'New DPI', 'Δ'],
        years.flatMap(y => {
          const top = yearly[y].sort((a, b) => b.jump - a.jump).slice(0, 1);
          return top.map(r => {
            const drv = drivers.get(r.driverId);
            return [
              UI.yearLabel(y, manifest, { href: `#/dpi/${y}` }),
              UI.driverLink(drv),
              { value: DPI.fmtScore(r.pre), class: 'pts' },
              UI.el('span', { class: 'pts',
                style: `color:${DPI.scoreColor(r.cur)};font-weight:700` }, DPI.fmtScore(r.cur)),
              { value: '+' + r.jump.toFixed(1), class: 'pts' },
            ];
          });
        }),
      );
      wrap.appendChild(tbl);
      return wrap;
    }

    function polesView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Pole → win conversion'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Of every pole position a driver took, how often did they convert it into a win? ' +
        'Filtered to drivers with ≥10 poles.'));
      const rows = Object.entries(ptw)
        .map(([did, v]) => ({ did, ...v }))
        .filter(r => r.poles >= 10)
        .sort((a, b) => b.rate - a.rate);
      wrap.appendChild(UI.table(
        ['#', 'Driver', 'Poles', 'Wins from pole', 'Conversion'],
        rows.map((r, i) => {
          const drv = drivers.get(r.did);
          return [
            { value: i + 1, class: 'pos' },
            UI.driverLink(drv),
            { value: r.poles, class: 'mono' },
            { value: r.winsFromPole, class: 'mono' },
            { value: (r.rate * 100).toFixed(1) + '%', class: 'pts' },
          ];
        }),
      ));
      return wrap;
    }

    function dynastiesView() {
      const wrap = UI.div({});
      wrap.appendChild(UI.h2({}, 'F1 family dynasties'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Curated list of F1 families with two or more grand prix starters. ' +
        'Each card compares career stats side by side.'));
      const grid = UI.el('div', { class: 'grid grid-auto', style: 'gap:18px;margin-top:14px;' });
      for (const dyn of dynasties) {
        const card = UI.el('section', { class: 'card', style: 'padding:14px;' });
        card.appendChild(UI.h3({}, dyn.name));
        const rows = dyn.members.map(mid => {
          const drv = drivers.get(mid);
          const dpi = dpiById.get(mid);
          return {
            drv, dpi,
            wins: drv?.totalRaceWins || 0,
            titles: drv?.totalChampionshipWins || 0,
            dpiVal: dpi?.shrunkOverall,
            qElo: dpi?.qualiElo,
          };
        });
        card.appendChild(UI.table(
          ['Driver', 'Wins', 'Titles', 'DPI', 'qElo'],
          rows.map(r => [
            UI.driverLink(r.drv),
            { value: r.wins, class: 'pts' },
            { value: r.titles, class: 'pts' },
            UI.el('span', { class: 'pts',
              style: r.dpiVal != null ? `color:${DPI.scoreColor(r.dpiVal)};font-weight:700` : '' },
              DPI.fmtScore(r.dpiVal)),
            { value: r.qElo != null ? Math.round(r.qElo) : '—', class: 'mono' },
          ]),
        ));
        grid.appendChild(card);
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function ageView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Performance vs age'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Each dot is a driver-season: their age at season-start (x) vs the season\'s ' +
        'shrunk DPI (y). The orange line is the median DPI per age across the entire ' +
        'F1 history. Most drivers peak in their late 20s/early 30s; sustained DPI > 60 ' +
        'past 35 is rare.'));
      // Build per-driver-season points.
      const points = [];
      const byAge = new Map();
      for (const d of dpiAll) {
        const drv = drivers.get(d.driverId);
        if (!drv?.dateOfBirth) continue;
        const dob = new Date(drv.dateOfBirth);
        if (isNaN(dob)) continue;
        for (const s of (d.seasons || [])) {
          const seasonStart = new Date(`${s.year}-03-01`);
          const ageMs = seasonStart - dob;
          if (ageMs <= 0) continue;
          const age = Math.round(ageMs / (365.25 * 24 * 3600 * 1000));
          if (age < 16 || age > 65) continue;
          const dpi = s.shrunkOverall ?? s.meanOverall;
          if (dpi == null || (s.races || 0) < 5) continue;
          points.push({ x: age, y: dpi, driverId: d.driverId,
                        driverName: drv.fullName || drv.name, year: s.year });
          if (!byAge.has(age)) byAge.set(age, []);
          byAge.get(age).push(dpi);
        }
      }
      // Median DPI per age.
      const ageRange = [...byAge.keys()].sort((a, b) => a - b);
      const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b);
        return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length/2 - 1] + s[s.length/2]) / 2;
      };
      const medianLine = ageRange.map(a => ({ x: a, y: median(byAge.get(a)) }));

      const canvas = UI.el('canvas');
      wrap.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
      setTimeout(() => new Chart(canvas, {
        data: {
          datasets: [
            { type: 'scatter', label: 'Driver-season DPI', data: points, parsing: false,
              pointRadius: 2.5, backgroundColor: 'rgba(31,142,250,0.4)' },
            { type: 'line', label: 'Median per age', data: medianLine, parsing: false,
              borderColor: '#ff7a45', backgroundColor: '#ff7a45',
              tension: 0.25, pointRadius: 4, fill: false },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#e6e9ee' } },
            tooltip: { callbacks: {
              label: (ctx) => ctx.raw.driverName
                ? `${ctx.raw.driverName} ${ctx.raw.year} — age ${ctx.raw.x}, DPI ${ctx.raw.y.toFixed(1)}`
                : `age ${ctx.parsed.x} median DPI ${ctx.parsed.y.toFixed(1)}`,
            } },
          },
          scales: {
            x: { type: 'linear', min: 16, max: 60,
                 title: { display: true, text: 'Age at season start', color: '#9aa3af' },
                 ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
            y: { title: { display: true, text: 'Shrunk DPI', color: '#9aa3af' },
                 ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
          },
        },
      }), 10);
      return wrap;
    }

    function dnfReasonsView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'How drivers retire'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Categorised retirements per driver: driver-fault (collisions, spins), mechanical ' +
        '(engine, gearbox, hydraulics, etc.), penalty (disqualification), retired (officially ' +
        'withdrew). Drivers with ≥5 career DNFs only.'));
      const rows = Object.entries(dnfReasons)
        .map(([did, r]) => {
          const total = r.total || 1;
          return {
            did,
            total,
            driver: r.driver || 0,
            mechanical: r.mechanical || 0,
            penalty: r.penalty || 0,
            retired: r.retired || 0,
            driverPct: 100 * (r.driver || 0) / total,
          };
        })
        .sort((a, b) => b.total - a.total);
      wrap.appendChild(UI.table(
        ['#', 'Driver', 'Total DNFs', 'Driver-fault', 'Mech.', 'Penalty', 'Retired', 'Driver %'],
        rows.slice(0, 100).map((r, i) => {
          const drv = drivers.get(r.did);
          return [
            { value: i + 1, class: 'pos' },
            UI.driverLink(drv),
            { value: r.total, class: 'pts' },
            { value: r.driver, class: 'mono' },
            { value: r.mechanical, class: 'mono' },
            { value: r.penalty, class: 'mono' },
            { value: r.retired, class: 'mono' },
            { value: r.driverPct.toFixed(0) + '%', class: 'pts' },
          ];
        }),
      ));
      return wrap;
    }

    function dramaView() {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Most dramatic seasons'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Drama score = (lead-changes × 8) + (rounds-to-clinch %). ' +
        'Pure runaways (Vettel \'13, Hamilton \'20) score low; tight title fights ' +
        '(Hamilton vs Massa \'08, Hamilton vs Rosberg \'16, Verstappen vs Hamilton \'21) score high.'));
      const rows = Object.entries(drama).map(([y, d]) => {
        const clinchPct = d.clinchRound && d.totalRounds
          ? (100 * d.clinchRound / d.totalRounds) : 0;
        return {
          year: parseInt(y, 10),
          leadChanges: d.leadChanges,
          clinchRound: d.clinchRound,
          totalRounds: d.totalRounds,
          score: (d.leadChanges * 8) + clinchPct,
        };
      }).sort((a, b) => b.score - a.score);
      wrap.appendChild(UI.table(
        ['#', 'Year', 'Lead changes', 'Title clinched', 'Drama'],
        rows.map((r, i) => [
          { value: i + 1, class: 'pos' },
          UI.yearLabel(r.year, manifest, { href: `#/season/${r.year}` }),
          { value: r.leadChanges, class: 'pts' },
          { value: r.clinchRound ? `R${r.clinchRound}/${r.totalRounds}` : '—', class: 'mono' },
          { value: r.score.toFixed(0), class: 'pts' },
        ]),
      ));
      return wrap;
    }
  },
};

window.RecordsView = RecordsView;
