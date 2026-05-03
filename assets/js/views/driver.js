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

      // Career mean championship position across all seasons raced.
      const seasonPositions = career.map(yr => yr.finalStanding?.position)
                                    .filter(p => p != null);
      const avgChampPos = seasonPositions.length
        ? seasonPositions.reduce((a, b) => a + b, 0) / seasonPositions.length
        : null;

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
          UI.statBlock('Avg championship pos',
            avgChampPos != null ? avgChampPos.toFixed(1) : '—',
            seasonPositions.length ? `${seasonPositions.length} seasons` : ''),
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
            UI.statBlock('Mean Finish', DPI.fmtScore(myDpi.meanFinish)),
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

// All-time drivers leaderboard — sortable table joining driver totals,
// years-active, and DPI career metrics.
const DriversListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading drivers…'));
    const [drivers, search, dpiAll] = await Promise.all([
      F1Data.drivers(), F1Data.driverSearch(), F1Data.dpiAll(),
    ]);
    const searchById = new Map(search.map(s => [s.id, s]));
    const dpiById = new Map(dpiAll.map(d => [d.driverId, d]));

    // Joined row per driver — one source of truth the table sorts/filters from.
    const rows = drivers.map(d => {
      const s = searchById.get(d.id);
      const dpi = dpiById.get(d.id);
      const years = s?.years || [];
      return {
        id: d.id,
        name: d.fullName || d.name,
        nat: d.nationality,
        firstYear: years[0] || null,
        lastYear: years[years.length - 1] || null,
        seasons: years.length,
        starts: d.totalRaceStarts || 0,
        wins: d.totalRaceWins || 0,
        podiums: d.totalPodiums || 0,
        poles: d.totalPolePositions || 0,
        titles: d.totalChampionshipWins || 0,
        bestChamp: d.bestChampionshipPosition,
        points: d.totalPoints || 0,
        avgChamp: s?.avgChampPos ?? null,
        shrunkDpi: dpi?.shrunkOverall ?? null,
        qElo: dpi?.qualiElo ?? null,
        rElo: dpi?.raceElo ?? null,
        teams: s?.teams || [],
      };
    });

    const view = UI.div({});
    view.appendChild(UI.h1({}, 'All-time drivers'));
    view.appendChild(UI.p({ class: 'muted' },
      `${drivers.length} drivers from 1950 to today. Click any column header to sort.`));

    // Filter row
    const filterRow = UI.el('div', { class: 'selector-row' });
    const searchInp = UI.el('input', { type: 'search',
      placeholder: 'Search name, team, year…', style: 'flex:1;' });
    const eraSel = UI.el('select');
    const ERAS = [
      { val: 'all',     label: 'All eras' },
      { val: '1950-69', label: '1950–69' },
      { val: '1970-89', label: '1970–89' },
      { val: '1990-09', label: '1990–2009' },
      { val: '2010+',   label: '2010 → present' },
      { val: 'current', label: 'Current grid (raced 2024+)' },
    ];
    for (const e of ERAS) eraSel.appendChild(UI.el('option', { value: e.val }, e.label));
    const minStartsSel = UI.el('select');
    for (const v of [0, 1, 25, 50, 100, 200]) {
      minStartsSel.appendChild(UI.el('option', { value: v },
        v === 0 ? 'Any starts' : `≥ ${v} starts`));
    }
    minStartsSel.value = '1';
    filterRow.appendChild(searchInp);
    filterRow.appendChild(eraSel);
    filterRow.appendChild(minStartsSel);
    view.appendChild(filterRow);

    const tableWrap = UI.el('div', { class: 'card', style: 'padding:0;overflow-x:auto;' });
    view.appendChild(tableWrap);

    const COLS = [
      { key: 'rank',      label: '#',       align: 'right',  fmt: (_, i) => i + 1, sort: null },
      { key: 'name',      label: 'Driver',  align: 'left',
        fmt: (r) => UI.el('a', { href: `#/driver/${r.id}` }, r.name) },
      { key: 'nat',       label: 'Nat',     align: 'left',
        fmt: (r) => r.nat ? r.nat.slice(0, 3).toUpperCase() : '—' },
      { key: 'years',     label: 'Years',   align: 'left',
        fmt: (r) => r.firstYear ? `${r.firstYear}–${r.lastYear}` : '—',
        sort: (a, b) => (b.firstYear || 0) - (a.firstYear || 0) },
      { key: 'seasons',   label: 'Sn',      align: 'right' },
      { key: 'starts',    label: 'Starts',  align: 'right' },
      { key: 'wins',      label: 'Wins',    align: 'right' },
      { key: 'podiums',   label: 'Pod',     align: 'right' },
      { key: 'poles',     label: 'Pole',    align: 'right' },
      { key: 'titles',    label: 'WDC',     align: 'right' },
      { key: 'bestChamp', label: 'Best',    align: 'right',
        fmt: (r) => r.bestChamp ?? '—',
        sort: (a, b) => (a.bestChamp || 99) - (b.bestChamp || 99) },
      { key: 'avgChamp',  label: 'Avg pos', align: 'right',
        fmt: (r) => r.avgChamp != null ? r.avgChamp.toFixed(1) : '—',
        sort: (a, b) => (a.avgChamp ?? 99) - (b.avgChamp ?? 99) },
      { key: 'points',    label: 'Pts',     align: 'right' },
      { key: 'shrunkDpi', label: 'DPI',     align: 'right',
        fmt: (r) => r.shrunkDpi != null
          ? UI.el('span', { style: `color:${DPI.scoreColor(r.shrunkDpi)};font-weight:700` },
                  r.shrunkDpi.toFixed(1))
          : '—' },
      { key: 'qElo',      label: 'qElo',    align: 'right',
        fmt: (r) => r.qElo != null ? Math.round(r.qElo) : '—' },
      { key: 'rElo',      label: 'rElo',    align: 'right',
        fmt: (r) => r.rElo != null ? Math.round(r.rElo) : '—' },
    ];

    let sortKey = 'wins';
    let sortDir = 'desc';

    const inEra = (r) => {
      const era = eraSel.value;
      if (era === 'all') return true;
      if (!r.firstYear) return false;
      const overlap = (lo, hi) =>
        r.firstYear <= hi && (r.lastYear || r.firstYear) >= lo;
      switch (era) {
        case '1950-69': return overlap(1950, 1969);
        case '1970-89': return overlap(1970, 1989);
        case '1990-09': return overlap(1990, 2009);
        case '2010+':   return overlap(2010, 9999);
        case 'current': return (r.lastYear || 0) >= 2024;
      }
      return true;
    };

    const matches = (r, q) => {
      if (!q) return true;
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hay = `${r.name} ${(r.teams || []).join(' ')} ${r.nat || ''} `
        + `${r.firstYear || ''} ${r.lastYear || ''}`;
      const lower = hay.toLowerCase();
      return tokens.every(t => lower.includes(t));
    };

    const sortFor = (key) => {
      const col = COLS.find(c => c.key === key);
      if (col?.sort) return col.sort;
      // numeric default — handle null as "worst"
      const numeric = (v) => v == null ? -Infinity : v;
      return (a, b) => numeric(b[key]) - numeric(a[key]);
    };

    const renderTable = () => {
      const q = searchInp.value.trim();
      const minStarts = parseInt(minStartsSel.value, 10);
      let filtered = rows.filter(r =>
        r.starts >= minStarts && inEra(r) && matches(r, q));

      const cmp = sortFor(sortKey);
      filtered.sort(cmp);
      if (sortDir === 'asc') filtered.reverse();

      const t = UI.el('table', { class: 'f1-table all-time' });
      const thead = UI.el('thead');
      const trh = UI.el('tr');
      for (const c of COLS) {
        const isSorted = c.key === sortKey;
        const arrow = isSorted ? (sortDir === 'desc' ? ' ▾' : ' ▴') : '';
        const th = UI.el('th', {
          class: `sortable ${c.align === 'right' ? 'right' : ''} ${isSorted ? 'sorted' : ''}`,
          onclick: () => {
            if (c.key === 'rank') return;
            if (sortKey === c.key) sortDir = (sortDir === 'desc' ? 'asc' : 'desc');
            else { sortKey = c.key; sortDir = 'desc'; }
            renderTable();
          },
        }, c.label + arrow);
        trh.appendChild(th);
      }
      thead.appendChild(trh);
      t.appendChild(thead);

      const tbody = UI.el('tbody');
      const PAGE = 250;
      filtered.slice(0, PAGE).forEach((r, i) => {
        const tr = UI.el('tr');
        for (const c of COLS) {
          const v = c.fmt ? c.fmt(r, i) : (r[c.key] ?? '—');
          if (v && v.nodeType) tr.appendChild(UI.el('td', { class: c.align === 'right' ? 'right' : '' }, v));
          else tr.appendChild(UI.el('td', { class: c.align === 'right' ? 'right' : '' }, String(v)));
        }
        tbody.appendChild(tr);
      });
      t.appendChild(tbody);

      UI.clearChildren(tableWrap);
      tableWrap.appendChild(UI.el('div', { class: 'table-wrap' }, t));
      if (filtered.length > PAGE) {
        tableWrap.appendChild(UI.el('div', { class: 'muted', style: 'padding:10px 14px;font-size:12px;' },
          `Showing ${PAGE} of ${filtered.length}. Refine filters to see the rest.`));
      } else if (!filtered.length) {
        tableWrap.appendChild(UI.el('div', { class: 'muted', style: 'padding:14px;' },
          'No drivers match these filters.'));
      } else {
        tableWrap.appendChild(UI.el('div', { class: 'muted', style: 'padding:10px 14px;font-size:12px;' },
          `${filtered.length} drivers.`));
      }
    };

    searchInp.addEventListener('input', renderTable);
    eraSel.addEventListener('change', renderTable);
    minStartsSel.addEventListener('change', renderTable);

    root.replaceChildren(view);
    renderTable();
  },
};

window.DriverView = DriverView;
window.DriversListView = DriversListView;
