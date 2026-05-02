// Driver profile: career stats, season-by-season trajectory, points vs DPI chart.

const DriverView = {
  async render(root, driverId) {
    root.replaceChildren(UI.loading('Loading driver…'));
    try {
      const [drivers, constructors] = await Promise.all([
        F1Data.driverMap(), F1Data.constructorMap(),
      ]);
      const d = drivers.get(driverId);
      if (!d) throw new Error(`Unknown driver: ${driverId}`);

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'Drivers', href: '#/drivers' },
        { label: d.name || d.fullName },
      ));

      // Loading rest in parallel
      const career = await F1Data.driverCareer(driverId);
      const dpiAll = await F1Data.dpiAll();

      const flag = d.nationality ? d.nationality.toUpperCase().slice(0, 3) : '';
      view.appendChild(UI.el('section', { class: 'hero' },
        UI.h1({}, d.fullName || d.name),
        UI.p({}, [d.abbreviation, flag, d.dateOfBirth ? `b. ${d.dateOfBirth}` : null,
                  d.permanentNumber ? `#${d.permanentNumber}` : null].filter(Boolean).join(' · ')),
        UI.el('div', { class: 'stat-grid', style: 'margin-top:14px;' },
          UI.statBlock('Race starts', d.totalRaceStarts),
          UI.statBlock('Wins', d.totalRaceWins),
          UI.statBlock('Podiums', d.totalPodiums),
          UI.statBlock('Poles', d.totalPolePositions),
          UI.statBlock('Career points', d.totalPoints),
          UI.statBlock('Championships', d.totalChampionshipWins,
            d.bestChampionshipPosition ? `best #${d.bestChampionshipPosition}` : ''),
        )
      ));

      // DPI summary
      const myDpi = dpiAll.find(x => x.driverId === driverId);
      if (myDpi && (myDpi.meanOverall != null || myDpi.qualiElo != null)) {
        view.appendChild(UI.el('section', { class: 'card' },
          UI.h2({}, 'Driver Performance Index — v2'),
          UI.p({ class: 'muted' },
            'Career metrics. Shrunk DPI is the recommended summary; Elo and DSC are orthogonal lenses.'),
          UI.el('div', { class: 'stat-grid' },
            UI.statBlock('Shrunk DPI',
              UI.el('span', { style: `color:${DPI.scoreColor(myDpi.shrunkOverall)}` },
                DPI.fmtScore(myDpi.shrunkOverall)),
              `${myDpi.totalRaces} races, ${myDpi.totalSprints || 0} sprints`),
            UI.statBlock('Best 75% DPI', DPI.fmtScore(myDpi.best75Overall)),
            UI.statBlock('Mean Quali', DPI.fmtScore(myDpi.meanQuali)),
            UI.statBlock('Mean Race (DNF-adj)', DPI.fmtScore(myDpi.meanRace)),
            UI.statBlock('Quali Elo',
              myDpi.qualiElo != null ? Math.round(myDpi.qualiElo) : '—',
              'teammate H2H'),
            UI.statBlock('Race Elo',
              myDpi.raceElo != null ? Math.round(myDpi.raceElo) : '—',
              'teammate finish H2H'),
            UI.statBlock('DSC',
              UI.el('span', { style: myDpi.meanDsc != null ? `color:${DPI.scoreColor(myDpi.meanDsc)}` : '' },
                DPI.fmtScore(myDpi.meanDsc)),
              'ridge-decomposed'),
            UI.statBlock('Seasons', myDpi.seasons.length),
          ),
        ));
      }

      // Tabs: Seasons | Per-race DPI/points | Career races
      const tabs = UI.el('div', { class: 'tabs' });
      const content = UI.div({});
      const defs = [
        { id: 'seasons', label: 'Season history' },
        { id: 'chart', label: 'Points vs DPI' },
        { id: 'races', label: 'All races' },
      ];
      let cur = 'seasons';
      const renderTab = () => {
        UI.clearChildren(content);
        $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === cur));
        if (cur === 'seasons') content.appendChild(seasonsTab());
        else if (cur === 'chart') content.appendChild(chartTab());
        else if (cur === 'races') content.appendChild(racesTab());
      };
      for (const dd of defs) {
        tabs.appendChild(UI.el('button', { 'data-tab': dd.id,
          onclick: () => { cur = dd.id; renderTab(); } }, dd.label));
      }
      view.appendChild(tabs);
      view.appendChild(content);
      root.replaceChildren(view);
      renderTab();

      function seasonsTab() {
        const dpiByYear = new Map((myDpi?.seasons || []).map(s => [s.year, s]));
        return UI.el('section', { class: 'card' },
          UI.h2({}, 'Season-by-season'),
          UI.table(
            ['Year', 'Team', 'Pos', 'Points', 'Wins', 'Shrunk DPI', 'Best 75%', 'qElo', 'DSC'],
            career.map(yr => {
              const team = yr.races[0]?.result.constructorId;
              const c = constructors.get(team);
              const fs = yr.finalStanding;
              const dr = dpiByYear.get(yr.year);
              const dpiVal = dr?.shrunkOverall ?? dr?.meanOverall;
              return [
                UI.el('a', { href: `#/season/${yr.year}` }, String(yr.year)),
                UI.constructorLink(c),
                { value: fs?.position ?? '—', class: 'mono' },
                { value: fs?.points ?? '—', class: 'pts' },
                { value: fs?.wins ?? '—', class: 'pts' },
                UI.el('span', { class: 'pts',
                  style: dpiVal != null ? `color:${DPI.scoreColor(dpiVal)};font-weight:700` : '' },
                  DPI.fmtScore(dpiVal)),
                { value: DPI.fmtScore(dr?.best75Overall), class: 'pts' },
                { value: dr?.qualiElo != null ? Math.round(dr.qualiElo) : '—', class: 'mono' },
                { value: DPI.fmtScore(dr?.dscScore), class: 'pts' },
              ];
            })
          )
        );
      }

      function chartTab() {
        const wrap = UI.el('section', { class: 'card' });
        wrap.appendChild(UI.h2({}, 'Season points vs DPI'));
        wrap.appendChild(UI.p({ class: 'muted' },
          "Both metrics by season. Points (red bars) show what the driver scored. DPI (blue line) is car-controlled; gaps reveal seasons where the driver outperformed or was let down by the machinery."));
        const dpiByYear = new Map((myDpi?.seasons || []).map(s => [s.year, s]));
        const data = career.map(yr => ({
          year: yr.year,
          points: yr.finalStanding?.points ?? 0,
          dpi: dpiByYear.get(yr.year)?.shrunkOverall ?? dpiByYear.get(yr.year)?.meanOverall ?? null,
        }));
        const labels = data.map(x => String(x.year));
        const points = data.map(x => x.points);
        const dpiVals = data.map(x => x.dpi);

        const canvas = UI.el('canvas');
        wrap.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
        setTimeout(() => {
          new Chart(canvas, {
            data: {
              labels,
              datasets: [
                { type: 'bar', label: 'Points', data: points,
                  backgroundColor: '#e10600', yAxisID: 'y' },
                { type: 'line', label: 'DPI', data: dpiVals,
                  borderColor: '#1f8efa', backgroundColor: '#1f8efa',
                  pointRadius: 4, tension: 0.2, yAxisID: 'y1', spanGaps: true },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { labels: { color: '#e6e9ee' } } },
              scales: {
                x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                y: { type: 'linear', position: 'left',
                     title: { display: true, text: 'Championship points', color: '#9aa3af' },
                     ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                y1: { type: 'linear', position: 'right',
                      title: { display: true, text: 'DPI score (0-100)', color: '#9aa3af' },
                      min: 0, max: 100,
                      ticks: { color: '#9aa3af' }, grid: { display: false } },
              },
            },
          });
        }, 10);
        return wrap;
      }

      function racesTab() {
        const rows = [];
        for (const yr of career) {
          for (const race of yr.races) {
            const r = race.result;
            const c = constructors.get(r.constructorId);
            rows.push([
              UI.raceLink(yr.year, race.round, `${yr.year} R${race.round}`),
              race.raceName,
              UI.constructorLink(c),
              { value: r.grid ?? '—', class: 'mono' },
              { value: r.positionText ?? '—', class: `pos ${UI.posClass(r.position)}` },
              { value: r.points ?? 0, class: 'pts' },
              { value: r.status, class: 'muted' },
            ]);
          }
        }
        return UI.el('section', { class: 'card' },
          UI.h2({}, `All races (${rows.length})`),
          UI.table(['Round', 'Race', 'Team', 'Grid', 'Finish', 'Pts', 'Status'], rows)
        );
      }
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load driver: ' + e.message));
      console.error(e);
    }
  },
};

const DriversListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading drivers…'));
    const drivers = await F1Data.drivers();
    const view = UI.div({});
    view.appendChild(UI.h1({}, 'Drivers'));
    view.appendChild(UI.p({ class: 'muted' }, `${drivers.length} drivers in F1 history.`));

    // Sort + filter
    const filterRow = UI.el('div', { class: 'selector-row' });
    const search = UI.el('input', { type: 'search', placeholder: 'Search by name…', style: 'flex:1;' });
    const sort = UI.el('select');
    for (const [k, l] of [
      ['lastName', 'A → Z'],
      ['totalPoints', 'Most career points'],
      ['totalRaceWins', 'Most wins'],
      ['totalChampionshipWins', 'Most titles'],
      ['totalRaceStarts', 'Most starts'],
    ]) sort.appendChild(UI.el('option', { value: k }, l));
    filterRow.appendChild(search);
    filterRow.appendChild(sort);
    view.appendChild(filterRow);

    const list = UI.el('div', { class: 'grid grid-auto' });
    view.appendChild(list);

    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      let filtered = drivers.filter(d => {
        if (!q) return true;
        return (d.fullName || d.name || '').toLowerCase().includes(q);
      });
      const sortKey = sort.value;
      filtered.sort((a, b) => {
        if (sortKey === 'lastName') return (a.lastName || a.name).localeCompare(b.lastName || b.name);
        return (b[sortKey] || 0) - (a[sortKey] || 0);
      });
      UI.clearChildren(list);
      for (const d of filtered.slice(0, 200)) {
        list.appendChild(UI.el('a', { class: 'card', href: `#/driver/${d.id}`,
          style: 'padding:14px;cursor:pointer;' },
          UI.el('div', { style: 'font-weight:600;font-size:15px;' }, d.fullName || d.name),
          UI.el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' },
            [d.nationality?.toUpperCase().slice(0, 3),
             d.totalRaceStarts ? `${d.totalRaceStarts} starts` : null,
             d.totalRaceWins ? `${d.totalRaceWins} wins` : null,
             d.totalChampionshipWins ? `${d.totalChampionshipWins}× champion` : null,
            ].filter(Boolean).join(' · ')),
        ));
      }
      if (filtered.length > 200) {
        list.appendChild(UI.el('div', { class: 'muted', style: 'padding:14px;' },
          `Showing 200 of ${filtered.length}. Refine search to see more.`));
      }
    };
    search.addEventListener('input', renderList);
    sort.addEventListener('change', renderList);
    renderList();

    root.replaceChildren(view);
  },
};

window.DriverView = DriverView;
window.DriversListView = DriversListView;
