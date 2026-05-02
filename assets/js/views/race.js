// Race detail: results table, qualifying, lap-by-lap chart, DPI breakdown.

const RaceView = {
  async render(root, year, round) {
    year = parseInt(year, 10); round = parseInt(round, 10);
    root.replaceChildren(UI.loading(`Loading race…`));
    try {
      const [season, dpi, drivers, constructors, gpMap, circuitMap] = await Promise.all([
        F1Data.season(year),
        F1Data.dpi(year),
        F1Data.driverMap(),
        F1Data.constructorMap(),
        F1Data.grandPrixMap(),
        F1Data.circuitMap(),
      ]);
      const race = season.races.find(r => r.round === round);
      if (!race) throw new Error(`Race not found: ${year} R${round}`);
      const gp = gpMap.get(race.grandPrixId);
      const circ = circuitMap.get(race.circuitId);

      const dpiRace = dpi.races.find(r => r.round === round);
      const dpiByDriver = dpiRace ? new Map(dpiRace.entries.map(e => [e.driverId, e])) : new Map();

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'Seasons', href: '#/seasons' },
        { label: String(year), href: `#/season/${year}` },
        { label: gp?.name || race.name },
      ));

      // Header
      const winner = race.results[0];
      const wd = winner ? drivers.get(winner.driverId) : null;
      view.appendChild(UI.el('section', { class: 'hero', style: 'padding:24px;' },
        UI.h1({}, gp?.name || race.name),
        UI.p({}, `Round ${race.round} · ${UI.fmtDate(race.date)} · ${circ?.fullName || circ?.name || '—'} · ${race.laps || '—'} laps`),
        UI.el('div', { class: 'stat-grid', style: 'margin-top:14px;' },
          UI.statBlock('Winner', wd ? (wd.name || wd.fullName) : '—',
            wd && winner ? (constructors.get(winner.constructorId)?.name || '') : ''),
          UI.statBlock('Pole', (() => {
            const pole = race.qualifying.find(q => q.position === 1);
            const pd = pole ? drivers.get(pole.driverId) : null;
            return pd ? (pd.name || pd.fullName) : '—';
          })()),
          UI.statBlock('Fastest lap', (() => {
            const fl = race.results.find(r => r.fastestLap);
            const fd = fl ? drivers.get(fl.driverId) : null;
            return fd ? (fd.name || fd.fullName) : '—';
          })()),
          UI.statBlock('Distance', race.distance ? `${race.distance} km` : '—'),
        )
      ));

      // Tabs
      const tabs = UI.el('div', { class: 'tabs' });
      const content = UI.div({});
      const defs = [
        { id: 'race', label: 'Race results' },
        { id: 'quali', label: 'Qualifying' },
        { id: 'gainers', label: 'Position changes' },
        { id: 'dpi', label: 'DPI breakdown' },
      ];
      let cur = 'race';
      const renderTab = () => {
        UI.clearChildren(content);
        $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === cur));
        if (cur === 'race') content.appendChild(raceTab());
        else if (cur === 'quali') content.appendChild(qualiTab());
        else if (cur === 'gainers') content.appendChild(gainersTab());
        else if (cur === 'dpi') content.appendChild(dpiTab());
      };
      for (const d of defs) {
        tabs.appendChild(UI.el('button', { 'data-tab': d.id,
          onclick: () => { cur = d.id; renderTab(); } }, d.label));
      }
      view.appendChild(tabs);
      view.appendChild(content);

      // Race-week navigation
      const navRow = UI.el('div', { class: 'selector-row', style: 'justify-content:space-between;' });
      if (round > 1) navRow.appendChild(UI.el('a', { class: 'btn ghost',
        href: `#/season/${year}/race/${round - 1}` }, '← Previous round'));
      else navRow.appendChild(UI.el('div'));
      if (round < season.races.length) navRow.appendChild(UI.el('a', { class: 'btn ghost',
        href: `#/season/${year}/race/${round + 1}` }, 'Next round →'));
      view.appendChild(navRow);

      root.replaceChildren(view);
      renderTab();

      function raceTab() {
        return UI.el('section', { class: 'card' },
          UI.h2({}, 'Race results'),
          UI.table(
            ['#', 'Driver', 'Team', 'Grid', 'Laps', 'Time / Status', 'Pts', 'FL'],
            race.results.map(r => {
              const d = drivers.get(r.driverId);
              const c = constructors.get(r.constructorId);
              const gainsClass = (r.positionsGained > 0) ? 'pos-1' : (r.positionsGained < 0 ? 'pos-3' : '');
              return [
                { value: r.positionText || '—', class: `pos ${UI.posClass(r.position)}` },
                UI.driverLink(d),
                UI.constructorLink(c),
                { value: r.grid ?? '—', class: 'mono' },
                { value: r.laps ?? '—', class: 'mono' },
                { value: r.time || r.gap || r.status, class: 'mono' },
                { value: r.points ?? 0, class: 'pts' },
                { value: r.fastestLap ? '⚡' : '', class: '' },
              ];
            })
          ));
      }

      function qualiTab() {
        if (!race.qualifying.length) {
          return UI.el('section', { class: 'card' }, UI.p({}, 'No qualifying data for this race.'));
        }
        return UI.el('section', { class: 'card' },
          UI.h2({}, 'Qualifying'),
          UI.table(
            ['#', 'Driver', 'Team', 'Q1', 'Q2', 'Q3', 'Time'],
            race.qualifying.map(q => {
              const d = drivers.get(q.driverId);
              const c = constructors.get(q.constructorId);
              return [
                { value: q.positionText || '—', class: `pos ${UI.posClass(q.position)}` },
                UI.driverLink(d),
                UI.constructorLink(c),
                { value: q.q1 || '—', class: 'mono' },
                { value: q.q2 || '—', class: 'mono' },
                { value: q.q3 || '—', class: 'mono' },
                { value: q.time || '—', class: 'mono' },
              ];
            })
          ));
      }

      function gainersTab() {
        const wrap = UI.el('section', { class: 'card' });
        wrap.appendChild(UI.h2({}, 'Grid → Finish'));
        wrap.appendChild(UI.p({ class: 'muted' },
          'Bar chart of positions gained on race day. Mechanical DNFs are shown as × and excluded from DPI race score.'));
        const data = race.results
          .filter(r => r.grid != null && r.position != null)
          .map(r => ({ ...r, gained: r.grid - r.position,
                       driver: drivers.get(r.driverId), team: constructors.get(r.constructorId) }))
          .sort((a, b) => b.gained - a.gained);
        const labels = data.map(d => d.driver?.lastName || d.driver?.name || d.driverId);
        const vals = data.map(d => d.gained);
        const colors = data.map(d => d.gained > 0 ? '#00b853' : d.gained < 0 ? '#e10600' : '#9aa3af');
        const canvas = UI.el('canvas');
        wrap.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
        setTimeout(() => {
          new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Positions gained', data: vals, backgroundColor: colors }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
              plugins: { legend: { display: false } },
              scales: { x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                        y: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } } } },
          });
        }, 10);
        return wrap;
      }

      function dpiTab() {
        if (!dpiRace) {
          return UI.el('section', { class: 'card' }, UI.p({}, 'No DPI breakdown available for this race.'));
        }
        const sorted = [...dpiRace.entries].sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
        return UI.el('section', { class: 'card' },
          UI.h2({}, 'DPI breakdown for this race'),
          UI.p({ class: 'muted' },
            'Quali = (50 − teammate-delta% × 25), Racecraft = (50 + weighted positions gained × 25). Overall = 0.40·Quali + 0.60·Racecraft.'),
          UI.table(
            ['Driver', 'Team', 'Q delta', 'Q rating', 'Grid → Finish', 'Net gain', 'Race rating', 'Status', 'Overall'],
            sorted.map(e => {
              const d = drivers.get(e.driverId);
              const c = constructors.get(e.team);
              const gridFin = (e.grid != null && e.finish != null) ? `P${e.grid} → P${e.finish}` : '—';
              return [
                UI.driverLink(d),
                UI.constructorLink(c),
                { value: DPI.fmtDelta(e.qualiDelta) + (e.qualiSession ? ` (${e.qualiSession})` : ''), class: 'mono' },
                { value: DPI.fmtScore(e.qualiRating), class: 'pts' },
                { value: gridFin, class: 'mono' },
                { value: e.netGain != null ? e.netGain.toFixed(2) : '—', class: 'mono' },
                { value: DPI.fmtScore(e.racecraft), class: 'pts' },
                { value: e.statusKind, class: 'muted' },
                UI.el('span', { class: 'pts',
                  style: e.overall != null ? `color:${DPI.scoreColor(e.overall)};font-weight:700` : '' },
                  DPI.fmtScore(e.overall)),
              ];
            })
          )
        );
      }
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load race: ' + e.message));
      console.error(e);
    }
  },
};

window.RaceView = RaceView;
