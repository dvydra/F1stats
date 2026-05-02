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
      const career = await F1Data.constructorCareer(constructorId);

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'Teams', href: '#/constructors' },
        { label: c.name },
      ));

      view.appendChild(UI.el('section', { class: 'hero' },
        UI.h1({}, c.fullName || c.name),
        UI.p({}, [c.country?.toUpperCase(),
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
                UI.el('a', { href: `#/season/${yr.year}` }, String(yr.year)),
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
        const labels = data.map(d => String(d.year));
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

const ConstructorsListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading teams…'));
    const list = await F1Data.constructors();
    const view = UI.div({});
    view.appendChild(UI.h1({}, 'Constructors'));
    view.appendChild(UI.p({ class: 'muted' }, `${list.length} teams in F1 history.`));

    const filterRow = UI.el('div', { class: 'selector-row' });
    const search = UI.el('input', { type: 'search', placeholder: 'Search team…', style: 'flex:1;' });
    const sort = UI.el('select');
    for (const [k, l] of [
      ['name', 'A → Z'],
      ['totalPoints', 'Most career points'],
      ['totalRaceWins', 'Most wins'],
      ['totalChampionshipWins', 'Most titles'],
    ]) sort.appendChild(UI.el('option', { value: k }, l));
    filterRow.appendChild(search);
    filterRow.appendChild(sort);
    view.appendChild(filterRow);

    const grid = UI.el('div', { class: 'grid grid-auto' });
    view.appendChild(grid);
    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      let filtered = list.filter(c => !q || (c.fullName || c.name || '').toLowerCase().includes(q));
      const k = sort.value;
      filtered.sort((a, b) => {
        if (k === 'name') return (a.name || '').localeCompare(b.name || '');
        return (b[k] || 0) - (a[k] || 0);
      });
      UI.clearChildren(grid);
      for (const c of filtered.slice(0, 200)) {
        grid.appendChild(UI.el('a', { class: 'card', href: `#/constructor/${c.id}`,
          style: 'padding:14px;cursor:pointer;' },
          UI.el('div', { style: 'font-weight:600;font-size:15px;' }, c.fullName || c.name),
          UI.el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' },
            [c.country?.toUpperCase(),
             c.totalRaceWins ? `${c.totalRaceWins} wins` : null,
             c.totalChampionshipWins ? `${c.totalChampionshipWins}× champion` : null,
            ].filter(Boolean).join(' · ')),
        ));
      }
    };
    search.addEventListener('input', renderList);
    sort.addEventListener('change', renderList);
    renderList();
    root.replaceChildren(view);
  },
};

window.ConstructorView = ConstructorView;
window.ConstructorsListView = ConstructorsListView;
