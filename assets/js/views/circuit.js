// Circuit specialist view — per-circuit driver leaderboard.

const CircuitView = {
  async render(root, circuitId) {
    root.replaceChildren(UI.loading('Loading circuit…'));
    const [stats, drivers, constructors, manifest, poleHist] = await Promise.all([
      F1Data.circuitStats(), F1Data.driverMap(), F1Data.constructorMap(),
      F1Data.manifest(), F1Data.circuitPoleHistory(),
    ]);
    const c = stats[circuitId];
    if (!c) {
      root.replaceChildren(UI.errorBox(`Unknown circuit: ${circuitId}`));
      return;
    }

    const view = UI.div({});
    view.appendChild(UI.crumbs(
      { label: 'Home', href: '#/' },
      { label: 'Records', href: '#/records' },
      { label: c.fullName || c.name },
    ));
    view.appendChild(UI.el('section', { class: 'hero' },
      UI.h1({},
        UI.flag(c.country)
          ? UI.el('span', { class: 'flag flag-lg' }, UI.flag(c.country))
          : null,
        c.fullName || c.name),
      UI.p({}, [c.type, c.country ? UI.countryName(c.country) : null,
                 `${c.totalRaces} F1 races held`].filter(Boolean).join(' · ')),
    ));

    // Pole-time evolution if we have historical quali times for this circuit.
    const poleByYear = poleHist[circuitId] || {};
    const poleYears = Object.keys(poleByYear).map(y => parseInt(y)).sort();
    if (poleYears.length >= 4) {
      const poleCard = UI.el('section', { class: 'card' },
        UI.h2({}, 'Pole-lap evolution'),
        UI.p({ class: 'muted' },
          'Fastest qualifying lap each year this circuit hosted F1. ' +
          'Drops = car/tyre/regulation jumps; spikes = wet sessions or layout changes.'));
      const canvas = UI.el('canvas');
      poleCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
      view.appendChild(poleCard);
      const labels = poleYears.map(y =>
        UI.isPartialSeason(y, manifest) ? `${y}*` : String(y));
      const fmtMs = (ms) => {
        const m = Math.floor(ms / 60000);
        const s = ((ms % 60000) / 1000).toFixed(3);
        return `${m}:${s.padStart(6, '0')}`;
      };
      setTimeout(() => new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Pole time',
            data: poleYears.map(y => poleByYear[String(y)]),
            borderColor: '#1f8efa', backgroundColor: 'rgba(31,142,250,0.15)',
            fill: true, tension: 0.3, pointRadius: 4,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => fmtMs(ctx.parsed.y) } },
          },
          scales: {
            x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
            y: { ticks: { color: '#9aa3af', callback: v => fmtMs(v) },
                 grid: { color: '#2a313a' },
                 title: { display: true, text: 'Pole-lap time', color: '#9aa3af' } },
          },
        },
      }), 10);
    }

    view.appendChild(UI.el('section', { class: 'card' },
      UI.h2({}, 'All-time driver leaderboard at this circuit'),
      UI.p({ class: 'muted' },
        'Click any column header to sort. Drivers with ≥2 starts shown.'),
      UI.table(
        ['#', 'Driver', 'Starts', 'Wins', 'Pod', 'Pole', 'FL', 'DNF', 'Avg fin', 'First', 'Last'],
        c.drivers.map((d, i) => {
          const drv = drivers.get(d.driverId);
          return [
            { value: i + 1, class: 'pos' },
            UI.driverLink(drv),
            { value: d.starts, class: 'mono' },
            { value: d.wins, class: 'pts' },
            { value: d.podiums, class: 'pts' },
            { value: d.poles, class: 'mono' },
            { value: d.fl, class: 'mono' },
            { value: d.dnf, class: 'mono' },
            { value: d.meanFinish ?? '—', class: 'pts' },
            { value: d.yearsActive[0] ?? '—', class: 'mono' },
            { value: d.yearsActive[d.yearsActive.length - 1] ?? '—', class: 'mono' },
          ];
        }),
      ),
    ));

    root.replaceChildren(view);
  },
};

const CircuitsListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading circuits…'));
    const stats = await F1Data.circuitStats();
    const view = UI.div({});
    view.appendChild(UI.crumbs(
      { label: 'Home', href: '#/' }, { label: 'Records', href: '#/records' },
      { label: 'Circuits' }));
    view.appendChild(UI.h1({}, 'F1 circuits'));
    view.appendChild(UI.p({ class: 'muted' },
      `${Object.keys(stats).length} circuits that have hosted Formula 1. ` +
      `Click any to see the all-time driver leaderboard at that track.`));

    const rows = Object.entries(stats)
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => b.totalRaces - a.totalRaces);
    view.appendChild(UI.table(
      ['#', 'Circuit', 'Country', 'Type', 'Races', 'Top winner'],
      rows.map((r, i) => {
        const top = r.drivers[0];
        return [
          { value: i + 1, class: 'pos' },
          UI.el('a', { href: `#/circuit/${r.id}` },
            UI.flagSpan(r.country),
            r.fullName || r.name),
          { value: r.country ? (UI.countryName(r.country) || r.country) : '—', class: 'mono' },
          { value: r.type ?? '—', class: 'mono' },
          { value: r.totalRaces, class: 'pts' },
          top ? UI.el('span', {},
            `${top.wins} × `,
            top.driverId
              ? UI.el('a', { href: `#/driver/${top.driverId}` }, top.driverId.replace(/-/g,' '))
              : '—') : '—',
        ];
      }),
    ));

    root.replaceChildren(view);
  },
};

window.CircuitView = CircuitView;
window.CircuitsListView = CircuitsListView;
