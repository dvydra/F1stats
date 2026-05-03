// Constructor (team) profile + listing.

const ConstructorView = {
  async render(root, constructorId) {
    root.replaceChildren(UI.loading('Loading team…'));
    try {
      const [drivers, constructors] = await Promise.all([
        F1Data.driverMap(), F1Data.constructorMap(),
      ]);
      const c = constructors.get(constructorId);
      if (!c) throw new Error(`Unknown constructor: ${constructorId}`);
      const [career, manifest] = await Promise.all([
        F1Data.constructorCareer(constructorId), F1Data.manifest(),
      ]);

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'Teams', href: '#/constructors' },
        { label: c.name },
      ));

      view.appendChild(UI.el('section', { class: 'hero' },
        UI.h1({},
          UI.flag(c.country)
            ? UI.el('span', { class: 'flag flag-lg' }, UI.flag(c.country))
            : null,
          c.fullName || c.name),
        UI.p({}, [UI.countryName(c.country) || c.country,
                  c.totalRaceEntries ? `${c.totalRaceEntries} race entries` : null,
                  c.bestChampionshipPosition ? `best #${c.bestChampionshipPosition}` : null
                 ].filter(Boolean).join(' · ')),
        UI.el('div', { class: 'stat-grid', style: 'margin-top:14px;' },
          UI.statBlock('Race starts', c.totalRaceStarts),
          UI.statBlock('Wins', c.totalRaceWins),
          UI.statBlock('Podiums', c.totalPodiums),
          UI.statBlock('Poles', c.totalPolePositions),
          UI.statBlock('Career points', c.totalPoints),
          UI.statBlock('Championships', c.totalChampionshipWins),
        )
      ));

      // Tabs
      const tabs = UI.el('div', { class: 'tabs' });
      const content = UI.div({});
      const defs = [
        { id: 'seasons', label: 'Seasons' },
        { id: 'chart', label: 'Points by season' },
        { id: 'drivers', label: 'Drivers' },
      ];
      let cur = 'seasons';
      const renderTab = () => {
        UI.clearChildren(content);
        $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === cur));
        if (cur === 'seasons') content.appendChild(seasonsTab());
        else if (cur === 'chart') content.appendChild(chartTab());
        else if (cur === 'drivers') content.appendChild(driversTab());
      };
      for (const d of defs) {
        tabs.appendChild(UI.el('button', { 'data-tab': d.id,
          onclick: () => { cur = d.id; renderTab(); } }, d.label));
      }
      view.appendChild(tabs);
      view.appendChild(content);
      root.replaceChildren(view);
      renderTab();

      function seasonsTab() {
        return UI.el('section', { class: 'card' },
          UI.h2({}, 'Season-by-season'),
          UI.table(
            ['Year', 'Pos', 'Points', 'Wins', 'Drivers'],
            career.map(yr => {
              const fs = yr.finalStanding;
              const ds = new Set();
              for (const r of yr.races) for (const res of r.results) ds.add(res.driverId);
              return [
                UI.yearLabel(yr.year, manifest, { href: `#/season/${yr.year}` }),
                { value: fs?.position ?? '—', class: 'mono' },
                { value: fs?.points ?? '—', class: 'pts' },
                { value: fs?.wins ?? '—', class: 'pts' },
                UI.el('span', {},
                  ...[...ds].map((id, i) => {
                    const d = drivers.get(id);
                    return UI.el('span', {},
                      i > 0 ? ', ' : '',
                      UI.driverLink(d, d?.lastName || d?.name || id));
                  })
                ),
              ];
            })
          )
        );
      }

      function chartTab() {
        const wrap = UI.el('section', { class: 'card' });
        wrap.appendChild(UI.h2({}, 'Constructor points by season'));
        const data = career.map(yr => ({
          year: yr.year, points: yr.finalStanding?.points ?? 0,
          pos: yr.finalStanding?.position ?? null,
        }));
        const labels = data.map(d =>
          UI.isPartialSeason(d.year, manifest) ? `${d.year}*` : String(d.year));
        const points = data.map(d => d.points);
        const canvas = UI.el('canvas');
        wrap.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
        setTimeout(() => {
          new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [{ data: points, backgroundColor: '#e10600',
              label: 'Points' }] },
            options: { responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: {
                callbacks: { afterLabel: (ctx) => `Final position: ${data[ctx.dataIndex].pos ?? '—'}` } } },
              scales: { x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                        y: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } } } },
          });
        }, 10);
        return wrap;
      }

      function driversTab() {
        const counts = new Map();
        for (const yr of career) for (const r of yr.races) for (const res of r.results) {
          const k = res.driverId;
          if (!counts.has(k)) counts.set(k, { id: k, races: 0, points: 0, wins: 0, podiums: 0, poles: 0,
                                              years: new Set() });
          const e = counts.get(k);
          e.races++;
          e.points += res.points || 0;
          if (res.position === 1) e.wins++;
          if (res.position && res.position <= 3) e.podiums++;
          if (res.polePosition) e.poles++;
          e.years.add(yr.year);
        }
        const rows = [...counts.values()].sort((a, b) => b.points - a.points).map(e => {
          const d = drivers.get(e.id);
          const yrs = [...e.years].sort();
          const span = yrs.length === 1 ? `${yrs[0]}` : `${yrs[0]}–${yrs[yrs.length - 1]}`;
          return [UI.driverLink(d), span, e.races, e.wins, e.podiums, e.poles, e.points];
        });
        return UI.el('section', { class: 'card' },
          UI.h2({}, `Drivers (${rows.length})`),
          UI.table(['Driver', 'Years', 'Races', 'Wins', 'Podiums', 'Poles', 'Points'], rows)
        );
      }
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load constructor: ' + e.message));
      console.error(e);
    }
  },
};

// All-time constructors leaderboard — sortable table mirroring the drivers view.
const ConstructorsListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading teams…'));
    const rows = await F1Data.constructorSearch();

    const view = UI.div({});
    view.appendChild(UI.h1({}, 'All-time teams'));
    view.appendChild(UI.p({ class: 'muted' },
      `${rows.length} constructors from 1950 to today. Click any column header to sort.`));

    const filterRow = UI.el('div', { class: 'selector-row' });
    const searchInp = UI.el('input', { type: 'search',
      placeholder: 'Search team or year…', style: 'flex:1;' });
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
    const minSel = UI.el('select');
    for (const v of [0, 1, 5, 25, 100]) {
      minSel.appendChild(UI.el('option', { value: v },
        v === 0 ? 'Any starts' : `≥ ${v} starts`));
    }
    minSel.value = '1';
    filterRow.appendChild(searchInp);
    filterRow.appendChild(eraSel);
    filterRow.appendChild(minSel);
    view.appendChild(filterRow);

    const tableWrap = UI.el('div', { class: 'card', style: 'padding:0;overflow-x:auto;' });
    view.appendChild(tableWrap);

    const COLS = [
      { key: 'rank',       label: '#',      align: 'right',  fmt: (_, i) => i + 1, sort: null },
      { key: 'name',       label: 'Team',   align: 'left',
        fmt: (r) => UI.el('a', { href: `#/constructor/${r.id}` }, r.name) },
      { key: 'country',    label: 'Country', align: 'left',
        fmt: (r) => r.country
          ? UI.el('span', { title: UI.countryName(r.country) || r.country },
                  UI.flag(r.country) || (UI.countryISO(r.country) || '—'))
          : '—',
        sort: (a, b) => (UI.countryName(a.country) || '').localeCompare(UI.countryName(b.country) || '') },
      { key: 'years',      label: 'Years',  align: 'left',
        fmt: (r) => r.firstYear ? `${r.firstYear}–${r.lastYear}` : '—',
        sort: (a, b) => (b.firstYear || 0) - (a.firstYear || 0) },
      { key: 'seasons',    label: 'Sn',     align: 'right' },
      { key: 'totalRaceStarts',     label: 'Starts',  align: 'right' },
      { key: 'totalRaceWins',       label: 'Wins',    align: 'right' },
      { key: 'totalPodiums',        label: 'Pod',     align: 'right' },
      { key: 'totalPolePositions',  label: 'Pole',    align: 'right' },
      { key: 'totalChampionshipWins', label: 'WCC',   align: 'right' },
      { key: 'bestChampionshipPosition', label: 'Best', align: 'right',
        fmt: (r) => r.bestChampionshipPosition ?? '—',
        sort: (a, b) => (a.bestChampionshipPosition || 99) - (b.bestChampionshipPosition || 99) },
      { key: 'avgChampPos', label: 'Avg pos', align: 'right',
        fmt: (r) => r.avgChampPos != null ? r.avgChampPos.toFixed(1) : '—',
        sort: (a, b) => (a.avgChampPos ?? 99) - (b.avgChampPos ?? 99) },
      { key: 'totalPoints',         label: 'Pts',     align: 'right' },
    ];

    let sortKey = 'totalRaceWins';
    let sortDir = 'desc';

    const inEra = (r) => {
      const era = eraSel.value;
      if (era === 'all') return true;
      if (!r.firstYear) return false;
      const overlap = (lo, hi) => r.firstYear <= hi && (r.lastYear || r.firstYear) >= lo;
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
      const hay = `${r.name} ${r.country || ''} ${r.firstYear || ''} ${r.lastYear || ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    };

    const sortFor = (key) => {
      const col = COLS.find(c => c.key === key);
      if (col?.sort) return col.sort;
      const numeric = (v) => v == null ? -Infinity : v;
      return (a, b) => numeric(b[key]) - numeric(a[key]);
    };

    const renderTable = () => {
      const q = searchInp.value.trim();
      const minStarts = parseInt(minSel.value, 10);
      let filtered = rows.filter(r =>
        (r.totalRaceStarts || 0) >= minStarts && inEra(r) && matches(r, q));
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
          'No teams match these filters.'));
      } else {
        tableWrap.appendChild(UI.el('div', { class: 'muted', style: 'padding:10px 14px;font-size:12px;' },
          `${filtered.length} teams.`));
      }
    };

    searchInp.addEventListener('input', renderTable);
    eraSel.addEventListener('change', renderTable);
    minSel.addEventListener('change', renderTable);

    root.replaceChildren(view);
    renderTable();
  },
};

window.ConstructorView = ConstructorView;
window.ConstructorsListView = ConstructorsListView;
