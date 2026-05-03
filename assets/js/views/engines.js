// Engines view — per-engine wins by year.

const EnginesView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading engines…'));
    const [stats, manifest] = await Promise.all([
      F1Data.engineStats(), F1Data.manifest(),
    ]);

    const view = UI.div({});
    view.appendChild(UI.crumbs(
      { label: 'Home', href: '#/' }, { label: 'Records', href: '#/records' },
      { label: 'Engines' }));
    view.appendChild(UI.h1({}, 'Engine manufacturers'));
    view.appendChild(UI.p({ class: 'muted' },
      'Race wins by engine manufacturer per year. The era of each manufacturer is ' +
      'visible at a glance — Cosworth ruled the 60s/70s, Renault turbocharged the 80s, ' +
      'Honda dominated the late 80s, Ferrari clutched the early 2000s, ' +
      'Mercedes the 2010s hybrid era.'));

    const years = Object.keys(stats.byYear).map(y => parseInt(y)).sort();
    const labels = years.map(y =>
      UI.isPartialSeason(y, manifest) ? `${y}*` : String(y));

    // Cumulative all-time wins per engine to identify the top contenders.
    const allTime = {};
    for (const [y, byEngine] of Object.entries(stats.byYear)) {
      for (const [eid, wins] of Object.entries(byEngine)) {
        allTime[eid] = (allTime[eid] || 0) + wins;
      }
    }
    const topEngines = Object.entries(allTime)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([eid]) => eid);

    // Stacked-area chart of wins by engine per year for top 12.
    const palette = ['#e10600', '#1f8efa', '#7bd389', '#ffd166', '#a986ff',
                     '#ff7a45', '#13c2c2', '#eb2f96', '#52c41a', '#faad14',
                     '#2f54eb', '#fa541c'];
    const datasets = topEngines.map((eid, i) => ({
      label: eid,
      data: years.map(y => stats.byYear[String(y)]?.[eid] || 0),
      borderColor: palette[i],
      backgroundColor: palette[i] + 'cc',
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      borderWidth: 1,
    }));

    const chart = UI.el('section', { class: 'card' },
      UI.h2({}, 'Wins by engine per year (top 12 all-time)'));
    const canvas = UI.el('canvas');
    chart.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
    view.appendChild(chart);
    setTimeout(() => new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e6e9ee', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#9aa3af', maxTicksLimit: 18 }, grid: { color: '#2a313a' } },
          y: { stacked: true, ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
               title: { display: true, text: 'Race wins', color: '#9aa3af' } },
        },
      },
    }), 10);

    // All-time table.
    view.appendChild(UI.el('section', { class: 'card' },
      UI.h2({}, 'All-time engine wins'),
      UI.table(
        ['#', 'Engine', 'Wins'],
        Object.entries(allTime)
          .sort((a, b) => b[1] - a[1])
          .map(([eid, wins], i) => [
            { value: i + 1, class: 'pos' },
            { value: eid, class: 'mono' },
            { value: wins, class: 'pts' },
          ]),
      ),
    ));

    root.replaceChildren(view);
  },
};

window.EnginesView = EnginesView;
