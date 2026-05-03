// Home view: latest season summary + jump-off points.

const HomeView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading latest season…'));
    try {
      const idx = await F1Data.manifest();
      const year = idx.lastYear;
      const [season, dpi, drivers, constructors] = await Promise.all([
        F1Data.season(year),
        F1Data.dpi(year),
        F1Data.driverMap(),
        F1Data.constructorMap(),
      ]);

      const view = UI.div({});

      // Hero
      const hero = UI.el('section', { class: 'hero' },
        UI.h1({}, `F1 Stats — ${idx.years[0]}–${year}`),
        UI.p({}, `Browse every Formula 1 season, race, driver and team. ${idx.totalDrivers} drivers, ${idx.totalConstructors} constructors, ${idx.years.length} seasons.`),
        UI.el('div', { style: 'margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;' },
          UI.el('a', { class: 'btn', href: `#/season/${year}` }, `${year} season →`),
          UI.el('a', { class: 'btn ghost', href: `#/dpi/${year}` }, `${year} DPI ranking →`),
          UI.el('a', { class: 'btn ghost', href: `#/compare` }, 'Compare drivers →'),
        )
      );
      view.appendChild(hero);

      // Latest season standings
      const cs = season.finalDriverStandings.slice(0, 10);
      const dpiByDriver = new Map(dpi.drivers.map(d => [d.driverId, d]));

      const standingsCard = UI.el('section', { class: 'card' },
        UI.el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;' },
          UI.h2({}, `${year} championship · top 10`),
          UI.el('a', { href: `#/season/${year}`, class: 'muted' }, 'View full standings →'),
        ),
        UI.table(
          ['#', 'Driver', 'Team', 'Pts', 'Wins', 'DPI'],
          cs.map(s => {
            const d = drivers.get(s.driverId);
            const c = constructors.get(s.constructorId);
            const dpiRow = dpiByDriver.get(s.driverId);
            const dpiVal = dpiRow?.shrunkOverall ?? dpiRow?.meanOverallAdj;
            return [
              { value: s.position, class: `pos ${UI.posClass(s.position)}` },
              UI.driverLink(d),
              UI.constructorLink(c),
              { value: s.points, class: 'pts' },
              { value: s.wins ?? '—', class: 'pts' },
              { value: DPI.fmtScore(dpiVal),
                class: 'pts',
              },
            ];
          })
        )
      );
      view.appendChild(standingsCard);

      // Last *completed* race — the season schedule includes upcoming
      // rounds, so we walk backwards to find the most recent one that
      // actually has results.
      const lastRace = [...season.races].reverse().find(
        r => Array.isArray(r.results) && r.results.length > 0
      ) || season.races[season.races.length - 1];
      const winner = lastRace.results?.[0];
      const winnerDriver = winner ? drivers.get(winner.driverId) : null;

      const lastRaceCard = UI.el('section', { class: 'card' },
        UI.h2({}, `Latest race · ${lastRace.name}`),
        UI.p({ class: 'muted' }, `Round ${lastRace.round} · ${UI.fmtDate(lastRace.date)}`),
        UI.el('div', { class: 'stat-grid', style: 'margin:10px 0 16px;' },
          UI.statBlock('Winner', winnerDriver ? (winnerDriver.name || winnerDriver.fullName) : '—'),
          UI.statBlock('Pole', (() => {
            const pole = lastRace.qualifying.find(q => q.position === 1);
            const pd = pole ? drivers.get(pole.driverId) : null;
            return pd ? (pd.name || pd.fullName) : '—';
          })()),
          UI.statBlock('Fastest lap', (() => {
            const fl = lastRace.results.find(r => r.fastestLap);
            const fd = fl ? drivers.get(fl.driverId) : null;
            return fd ? (fd.name || fd.fullName) : '—';
          })()),
          UI.statBlock('Laps', lastRace.laps),
        ),
        UI.el('a', { href: `#/season/${year}/race/${lastRace.round}`, class: 'btn ghost' },
          'Full race detail →')
      );
      view.appendChild(lastRaceCard);

      // Top DPI table (sorted by shrunkOverall — the v2 recommended metric)
      const topDpi = [...dpi.drivers]
        .filter(d => d.shrunkOverall != null)
        .sort((a, b) => b.shrunkOverall - a.shrunkOverall)
        .slice(0, 8);
      const dpiCard = UI.el('section', { class: 'card' },
        UI.el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;' },
          UI.h2({}, `${year} Driver Performance Index`),
          UI.el('a', { href: `#/dpi/${year}`, class: 'muted' }, 'Full leaderboard + chart →'),
        ),
        UI.p({ class: 'muted' },
          'DPI v2 — car-adjusted via teammate quali delta (40%) plus DNF-adjusted weighted positions gained (60%). Sprints fold in at 0.3 weight. Bayesian-shrunk for sample size.'),
        UI.table(
          ['#', 'Driver', 'Team', 'Quali', 'Race', 'Shrunk DPI', 'qElo'],
          topDpi.map((d, i) => {
            const drv = drivers.get(d.driverId);
            const c = constructors.get(d.team);
            return [
              { value: i + 1, class: 'pos' },
              UI.driverLink(drv),
              UI.constructorLink(c),
              { value: DPI.fmtScore(d.meanQuali), class: 'pts' },
              { value: DPI.fmtScore(d.meanRaceAdj), class: 'pts' },
              UI.el('span', { style: `font-family:var(--mono);font-weight:700;color:${DPI.scoreColor(d.shrunkOverall)}` },
                DPI.fmtScore(d.shrunkOverall)),
              { value: d.qualiElo != null ? Math.round(d.qualiElo) : '—', class: 'mono' },
            ];
          })
        )
      );
      view.appendChild(dpiCard);

      root.replaceChildren(view);
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load home: ' + e.message));
      console.error(e);
    }
  },
};

window.HomeView = HomeView;
