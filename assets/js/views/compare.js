// Compare view: head-to-head two drivers across career.

const CompareView = {
  async render(root, params = {}) {
    const a = params.a;
    const b = params.b;

    root.replaceChildren(UI.loading('Loading drivers…'));
    const drivers = await F1Data.drivers();
    const driverMap = new Map(drivers.map(d => [d.id, d]));

    const view = UI.div({});
    view.appendChild(UI.crumbs({ label: 'Home', href: '#/' }, { label: 'Compare' }));
    view.appendChild(UI.h1({}, 'Compare drivers head-to-head'));

    // Selector
    const row = UI.el('div', { class: 'selector-row' });
    const mkSelect = (val) => {
      const sel = UI.el('select');
      sel.appendChild(UI.el('option', { value: '' }, '— pick driver —'));
      const sorted = [...drivers]
        .filter(d => d.totalRaceStarts > 0)
        .sort((x, y) => (y.totalRaceStarts || 0) - (x.totalRaceStarts || 0));
      for (const d of sorted) {
        const o = UI.el('option', { value: d.id },
          `${d.fullName || d.name} (${d.totalRaceStarts || 0} starts)`);
        if (d.id === val) o.selected = true;
        sel.appendChild(o);
      }
      return sel;
    };
    const aSel = mkSelect(a);
    const bSel = mkSelect(b);
    const goBtn = UI.el('button', { class: 'btn',
      onclick: () => {
        if (aSel.value && bSel.value) location.hash = `#/compare/${aSel.value}/${bSel.value}`;
      } }, 'Compare →');
    row.appendChild(aSel); row.appendChild(UI.el('span', {}, 'vs')); row.appendChild(bSel); row.appendChild(goBtn);
    view.appendChild(row);

    if (!a || !b) {
      view.appendChild(UI.el('div', { class: 'muted' }, 'Pick two drivers to compare.'));
      root.replaceChildren(view);
      return;
    }

    const da = driverMap.get(a), db = driverMap.get(b);
    if (!da || !db) {
      view.appendChild(UI.errorBox('Unknown driver(s).'));
      root.replaceChildren(view);
      return;
    }

    const [careerA, careerB, dpiAll] = await Promise.all([
      F1Data.driverCareer(a), F1Data.driverCareer(b), F1Data.dpiAll(),
    ]);
    const dpiA = dpiAll.find(x => x.driverId === a);
    const dpiB = dpiAll.find(x => x.driverId === b);

    // Header
    view.appendChild(UI.el('section', { class: 'card' },
      UI.el('div', { style: 'display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;' },
        UI.el('div', { style: 'text-align:right' },
          UI.el('div', { style: 'font-size:22px;font-weight:700;' }, da.fullName || da.name),
          UI.el('div', { class: 'muted' }, da.nationality?.toUpperCase().slice(0, 3))),
        UI.el('div', { style: 'font-family:var(--mono);color:var(--text-dim);' }, 'vs'),
        UI.el('div', { style: 'text-align:left' },
          UI.el('div', { style: 'font-size:22px;font-weight:700;' }, db.fullName || db.name),
          UI.el('div', { class: 'muted' }, db.nationality?.toUpperCase().slice(0, 3))),
      ),
    ));

    // Stat rows
    const compareCard = UI.el('section', { class: 'card' });
    compareCard.appendChild(UI.h2({}, 'Career stats'));
    const statRow = (label, va, vb, higherWins = true) => {
      const wa = va != null && (vb == null || (higherWins ? va > vb : va < vb));
      const wb = vb != null && (va == null || (higherWins ? vb > va : vb < va));
      return UI.el('div', { class: 'compare-stat' },
        UI.el('div', { class: 'a' + (wa ? ' winner' : '') }, va == null ? '—' : String(va)),
        UI.el('div', { class: 'label' }, label),
        UI.el('div', { class: 'b' + (wb ? ' winner' : '') }, vb == null ? '—' : String(vb))
      );
    };
    compareCard.appendChild(statRow('Race starts', da.totalRaceStarts, db.totalRaceStarts));
    compareCard.appendChild(statRow('Wins', da.totalRaceWins, db.totalRaceWins));
    compareCard.appendChild(statRow('Podiums', da.totalPodiums, db.totalPodiums));
    compareCard.appendChild(statRow('Poles', da.totalPolePositions, db.totalPolePositions));
    compareCard.appendChild(statRow('Career points', da.totalPoints, db.totalPoints));
    compareCard.appendChild(statRow('Championships', da.totalChampionshipWins, db.totalChampionshipWins));
    compareCard.appendChild(statRow('Best championship', da.bestChampionshipPosition, db.bestChampionshipPosition, false));
    compareCard.appendChild(statRow('Shrunk DPI',
      dpiA?.shrunkOverall != null ? dpiA.shrunkOverall.toFixed(1) : null,
      dpiB?.shrunkOverall != null ? dpiB.shrunkOverall.toFixed(1) : null));
    compareCard.appendChild(statRow('Best-75% DPI',
      dpiA?.best75Overall != null ? dpiA.best75Overall.toFixed(1) : null,
      dpiB?.best75Overall != null ? dpiB.best75Overall.toFixed(1) : null));
    compareCard.appendChild(statRow('Mean Quali',
      dpiA?.meanQuali != null ? dpiA.meanQuali.toFixed(1) : null,
      dpiB?.meanQuali != null ? dpiB.meanQuali.toFixed(1) : null));
    compareCard.appendChild(statRow('Mean Race (DNF-adj)',
      dpiA?.meanRace != null ? dpiA.meanRace.toFixed(1) : null,
      dpiB?.meanRace != null ? dpiB.meanRace.toFixed(1) : null));
    compareCard.appendChild(statRow('Quali Elo',
      dpiA?.qualiElo != null ? Math.round(dpiA.qualiElo) : null,
      dpiB?.qualiElo != null ? Math.round(dpiB.qualiElo) : null));
    compareCard.appendChild(statRow('Race Elo',
      dpiA?.raceElo != null ? Math.round(dpiA.raceElo) : null,
      dpiB?.raceElo != null ? Math.round(dpiB.raceElo) : null));
    compareCard.appendChild(statRow('DSC (ridge-decomposed)',
      dpiA?.meanDsc != null ? dpiA.meanDsc.toFixed(1) : null,
      dpiB?.meanDsc != null ? dpiB.meanDsc.toFixed(1) : null));
    view.appendChild(compareCard);

    // Per-season points chart
    const yearsA = new Map(careerA.map(y => [y.year, y]));
    const yearsB = new Map(careerB.map(y => [y.year, y]));
    const allYears = [...new Set([...yearsA.keys(), ...yearsB.keys()])].sort();
    const ptsA = allYears.map(y => yearsA.get(y)?.finalStanding?.points ?? null);
    const ptsB = allYears.map(y => yearsB.get(y)?.finalStanding?.points ?? null);

    const chartCard = UI.el('section', { class: 'card' });
    chartCard.appendChild(UI.h2({}, 'Points by season'));
    const canvas = UI.el('canvas');
    chartCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
    view.appendChild(chartCard);

    // DPI by season chart (shrunk overall — v2)
    const dpiByYearA = new Map((dpiA?.seasons || []).map(s => [s.year, s.shrunkOverall ?? s.meanOverall]));
    const dpiByYearB = new Map((dpiB?.seasons || []).map(s => [s.year, s.shrunkOverall ?? s.meanOverall]));
    const dpiCard = UI.el('section', { class: 'card' });
    dpiCard.appendChild(UI.h2({}, 'DPI by season'));
    dpiCard.appendChild(UI.p({ class: 'muted' },
      'Higher DPI means stronger performance relative to the car. Comparing DPI rather than points strips out machinery differences.'));
    const dpiCanvas = UI.el('canvas');
    dpiCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, dpiCanvas));
    view.appendChild(dpiCard);

    root.replaceChildren(view);

    setTimeout(() => {
      new Chart(canvas, {
        type: 'line',
        data: {
          labels: allYears.map(String),
          datasets: [
            { label: da.lastName || da.name, data: ptsA, borderColor: '#e10600',
              backgroundColor: '#e10600', tension: 0.2, spanGaps: true },
            { label: db.lastName || db.name, data: ptsB, borderColor: '#1f8efa',
              backgroundColor: '#1f8efa', tension: 0.2, spanGaps: true },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#e6e9ee' } } },
          scales: { x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                    y: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                         title: { display: true, text: 'Points', color: '#9aa3af' } } } },
      });
      new Chart(dpiCanvas, {
        type: 'line',
        data: {
          labels: allYears.map(String),
          datasets: [
            { label: da.lastName || da.name, data: allYears.map(y => dpiByYearA.get(y) ?? null),
              borderColor: '#e10600', backgroundColor: '#e10600', tension: 0.2, spanGaps: true },
            { label: db.lastName || db.name, data: allYears.map(y => dpiByYearB.get(y) ?? null),
              borderColor: '#1f8efa', backgroundColor: '#1f8efa', tension: 0.2, spanGaps: true },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#e6e9ee' } } },
          scales: { x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                    y: { min: 0, max: 100, ticks: { color: '#9aa3af' },
                         grid: { color: '#2a313a' },
                         title: { display: true, text: 'DPI overall', color: '#9aa3af' } } } },
      });
    }, 10);
  },
};

window.CompareView = CompareView;
