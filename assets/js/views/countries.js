// All-time country ranking — flags, drivers, wins, home wins, titles.
// "Home win" = a victory on a circuit located in the driver's nationality.

const CountriesView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading countries…'));
    const rows = await F1Data.countries();

    const view = UI.div({});
    view.appendChild(UI.h1({}, 'Nationalistic ranking'));
    view.appendChild(UI.p({ class: 'muted' },
      `${rows.length} countries that have produced an F1 driver or constructor. ` +
      `Home wins = victories on a circuit located in the driver's home country.`));

    const tableWrap = UI.el('div', { class: 'card', style: 'padding:0;overflow-x:auto;' });
    view.appendChild(tableWrap);

    const fmtNum = (n) => n == null ? '—' : n.toLocaleString();
    const fmtPct = (n, d) => (n && d) ? `${(100 * n / d).toFixed(1)}%` : '—';

    const COLS = [
      { key: 'rank',         label: '#',      align: 'right', fmt: (_, i) => i + 1, sort: null },
      { key: 'name',         label: 'Country', align: 'left',
        fmt: (r) => UI.el('span', {},
          UI.el('span', { class: 'flag flag-lg' }, UI.flag(r.id) || ''),
          UI.countryName(r.id) || r.id),
        sort: (a, b) => (UI.countryName(a.id) || a.id).localeCompare(UI.countryName(b.id) || b.id) },
      { key: 'drivers',      label: 'Drivers', align: 'right', fmt: (r) => fmtNum(r.drivers) },
      { key: 'constructors', label: 'Teams',   align: 'right', fmt: (r) => fmtNum(r.constructors) },
      { key: 'raceHosts',    label: 'GPs hosted', align: 'right', fmt: (r) => fmtNum(r.raceHosts) },
      { key: 'starts',       label: 'Starts',  align: 'right', fmt: (r) => fmtNum(r.starts) },
      { key: 'wins',         label: 'Wins',    align: 'right', fmt: (r) => fmtNum(r.wins) },
      { key: 'homeWins',     label: 'Home wins', align: 'right',
        fmt: (r) => r.homeWins
          ? `${r.homeWins} (${(100 * r.homeWins / Math.max(1, r.wins)).toFixed(0)}% of wins)`
          : '0' },
      { key: 'podiums',      label: 'Podiums', align: 'right', fmt: (r) => fmtNum(r.podiums) },
      { key: 'poles',        label: 'Poles',   align: 'right', fmt: (r) => fmtNum(r.poles) },
      { key: 'driverTitles', label: 'WDC',     align: 'right' },
      { key: 'constructorTitles', label: 'WCC', align: 'right' },
    ];

    let sortKey = 'wins';
    let sortDir = 'desc';

    const sortFor = (key) => {
      const col = COLS.find(c => c.key === key);
      if (col?.sort) return col.sort;
      const numeric = (v) => v == null ? -Infinity : v;
      return (a, b) => numeric(b[key]) - numeric(a[key]);
    };

    const renderTable = () => {
      const sorted = rows.slice().sort(sortFor(sortKey));
      if (sortDir === 'asc') sorted.reverse();

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
      sorted.forEach((r, i) => {
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
    };

    root.replaceChildren(view);
    renderTable();
  },
};

window.CountriesView = CountriesView;
