// All-seasons index view + Season detail view.

const SeasonsListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading seasons…'));
    const idx = await F1Data.manifest();
    const view = UI.div({});
    view.appendChild(UI.h1({}, 'All seasons'));
    view.appendChild(UI.p({ class: 'muted' },
      `Formula 1 World Championship · ${idx.years[0]}–${idx.years[idx.years.length - 1]}`));

    const grid = UI.el('div', { class: 'grid grid-auto', style: 'margin-top:16px;' });
    for (const y of [...idx.years].reverse()) {
      grid.appendChild(UI.el('a', { href: `#/season/${y}`, class: 'card',
        style: 'text-align:center;padding:18px;cursor:pointer;' },
        UI.el('div', { style: 'font-size:24px;font-weight:700;font-family:var(--mono);' }, String(y)),
        UI.el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' }, 'View season')
      ));
    }
    view.appendChild(grid);
    root.replaceChildren(view);
  },
};

const SeasonView = {
  async render(root, year) {
    year = parseInt(year, 10);
    root.replaceChildren(UI.loading(`Loading ${year} season…`));
    try {
      const [season, dpi, drivers, constructors, gpMap] = await Promise.all([
        F1Data.season(year),
        F1Data.dpi(year),
        F1Data.driverMap(),
        F1Data.constructorMap(),
        F1Data.grandPrixMap(),
      ]);

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'Seasons', href: '#/seasons' },
        { label: String(year) },
      ));

      // Season selector
      const idx = await F1Data.manifest();
      const sel = UI.el('select', { onchange: (e) => location.hash = `#/season/${e.target.value}` });
      for (const y of [...idx.years].reverse()) {
        const o = UI.el('option', { value: y }, String(y));
        if (y === year) o.selected = true;
        sel.appendChild(o);
      }

      view.appendChild(UI.el('div', { class: 'selector-row' },
        UI.h1({}, `${year} season`),
        sel,
        UI.el('a', { class: 'btn ghost', href: `#/dpi/${year}` }, 'DPI ranking'),
      ));

      // Tabs: standings | constructors | schedule | DPI vs Points chart
      const tabs = UI.el('div', { class: 'tabs' });
      const content = UI.div({});

      const tabDefs = [
        { id: 'drivers', label: 'Drivers' },
        { id: 'constructors', label: 'Constructors' },
        { id: 'schedule', label: 'Schedule' },
        { id: 'dpi-vs-points', label: 'DPI vs Points' },
      ];

      let currentTab = 'drivers';
      const renderTab = () => {
        UI.clearChildren(content);
        $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
        if (currentTab === 'drivers') content.appendChild(driversTab(season, drivers, constructors, dpi));
        else if (currentTab === 'constructors') content.appendChild(constructorsTab(season, constructors));
        else if (currentTab === 'schedule') content.appendChild(scheduleTab(season, drivers, gpMap, year));
        else if (currentTab === 'dpi-vs-points') content.appendChild(dpiVsPointsTab(dpi, season, drivers, constructors));
      };
      for (const tdef of tabDefs) {
        const b = UI.el('button', { 'data-tab': tdef.id,
          onclick: () => { currentTab = tdef.id; renderTab(); } }, tdef.label);
        tabs.appendChild(b);
      }
      view.appendChild(tabs);
      view.appendChild(content);
      root.replaceChildren(view);
      renderTab();
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load season: ' + e.message));
      console.error(e);
    }

    function driversTab(season, drivers, constructors, dpi) {
      const dpiByDriver = new Map(dpi.drivers.map(d => [d.driverId, d]));
      return UI.el('section', { class: 'card' },
        UI.h2({}, 'Final driver standings'),
        UI.table(
          ['#', 'Driver', 'Nat', 'Team', 'Points', 'Wins', 'DPI', 'qElo'],
          season.finalDriverStandings.map(s => {
            const d = drivers.get(s.driverId);
            const c = constructors.get(s.constructorId);
            const dr = dpiByDriver.get(s.driverId);
            const dpiVal = dr?.shrunkOverall ?? dr?.meanOverallAdj;
            return [
              { value: s.position, class: `pos ${UI.posClass(s.position)}` },
              UI.driverLink(d),
              { value: d?.nationality?.toUpperCase().slice(0, 3) || '—', class: 'mono' },
              UI.constructorLink(c),
              { value: s.points, class: 'pts' },
              { value: s.wins ?? '—', class: 'pts' },
              UI.el('span', { class: 'pts',
                style: dpiVal != null ? `color:${DPI.scoreColor(dpiVal)};font-weight:700` : '' },
                DPI.fmtScore(dpiVal)),
              { value: dr?.qualiElo != null ? Math.round(dr.qualiElo) : '—', class: 'mono' },
            ];
          })
        )
      );
    }

    function constructorsTab(season, constructors) {
      return UI.el('section', { class: 'card' },
        UI.h2({}, 'Final constructor standings'),
        UI.table(
          ['#', 'Constructor', 'Country', 'Points', 'Wins'],
          season.finalConstructorStandings.map(s => {
            const c = constructors.get(s.constructorId);
            return [
              { value: s.position, class: `pos ${UI.posClass(s.position)}` },
              UI.constructorLink(c),
              { value: c?.country?.toUpperCase().slice(0, 3) || '—', class: 'mono' },
              { value: s.points, class: 'pts' },
              { value: s.wins ?? '—', class: 'pts' },
            ];
          })
        )
      );
    }

    function scheduleTab(season, drivers, gpMap, year) {
      const wrap = UI.el('section', { class: 'card' }, UI.h2({}, `${season.races.length} races`));
      for (const race of season.races) {
        const winner = race.results[0];
        const wd = winner ? drivers.get(winner.driverId) : null;
        const gp = gpMap.get(race.grandPrixId);
        wrap.appendChild(UI.el('a', { class: 'race-card', href: `#/season/${year}/race/${race.round}` },
          UI.el('div', {},
            UI.el('div', { class: 'round' }, `Round ${race.round} · ${UI.fmtDate(race.date)}`),
            UI.el('div', { class: 'name' }, gp?.name || race.name),
          ),
          UI.el('div', { class: 'winner' },
            wd ? `🏆 ${wd.name || wd.fullName}` : (race.results.length ? '—' : 'Upcoming')),
        ));
      }
      return wrap;
    }

    function dpiVsPointsTab(dpi, season, drivers, constructors) {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Points vs DPI'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Each dot is a driver. The horizontal axis is championship points (car-influenced). The vertical axis is DPI (car-controlled performance metric). Drivers above the trend line are outperforming their car; drivers below are being carried by it.'));

      const standings = new Map(season.finalDriverStandings.map(s => [s.driverId, s]));
      const points = [];
      for (const d of dpi.drivers) {
        const s = standings.get(d.driverId);
        const y = d.shrunkOverall ?? d.meanOverallAdj;
        if (y == null) continue;
        const drv = drivers.get(d.driverId);
        const tm = constructors.get(d.team);
        points.push({
          driverId: d.driverId,
          driverName: drv?.name || drv?.fullName || d.driverId,
          team: tm?.name || d.team,
          x: s?.points || 0,
          y,
          label: drv?.abbreviation || drv?.lastName || d.driverId,
        });
      }

      const canvas = UI.el('canvas');
      const cWrap = UI.el('div', { class: 'chart-wrap tall' }, canvas);
      wrap.appendChild(cWrap);

      // Defer chart creation until canvas is in DOM.
      setTimeout(() => {
        new Chart(canvas, {
          type: 'scatter',
          data: {
            datasets: [{
              label: 'Drivers',
              data: points,
              parsing: false,
              pointRadius: 7,
              pointHoverRadius: 10,
              backgroundColor: points.map(p => DPI.scoreColor(p.y)),
              borderColor: '#0b0d10',
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const p = ctx.raw;
                    return `${p.driverName} (${p.team}): ${p.x} pts · DPI ${p.y.toFixed(1)}`;
                  },
                },
              },
            },
            scales: {
              x: { title: { display: true, text: 'Championship points', color: '#9aa3af' },
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
              y: { title: { display: true, text: 'DPI (mean overall)', color: '#9aa3af' },
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                   suggestedMin: 0, suggestedMax: 100 },
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
                const p = points[i];
                ctx.fillText(p.label, pt.x + 9, pt.y + 4);
              }
              ctx.restore();
            },
          }],
        });
      }, 10);

      return wrap;
    }
  },
};

window.SeasonsListView = SeasonsListView;
window.SeasonView = SeasonView;
