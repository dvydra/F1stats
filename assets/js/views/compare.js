// Compare view: head-to-head two drivers across career.

// Tiny autocomplete: matches name, abbreviation, team name, or year raced.
// Returns a record with { el, getValue }. `current` preselects an id.
function makeDriverPicker(searchIndex, current, labelFor) {
  const wrap = UI.el('div', { class: 'driver-picker' });
  const input = UI.el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Search name, team, year…', class: 'driver-picker-input' });
  const list = UI.el('div', { class: 'driver-picker-list' });
  let value = current || '';
  let activeIdx = -1;

  if (current) input.value = labelFor(current);

  function tokenize(q) {
    return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }
  function score(d, tokens) {
    if (!tokens.length) return d.starts || 0;  // popularity sort when empty
    let s = 0;
    const hay = `${d.name} ${d.abbr || ''} ${(d.teams || []).join(' ')} ${(d.years || []).join(' ')}`.toLowerCase();
    for (const t of tokens) {
      if (!hay.includes(t)) return -1;
      // Boost matches on name vs deep-fields
      if (d.name.toLowerCase().startsWith(t)) s += 100;
      else if (d.name.toLowerCase().includes(t)) s += 30;
      if ((d.abbr || '').toLowerCase() === t) s += 80;
      if ((d.teams || []).some(tm => tm.toLowerCase().includes(t))) s += 10;
      if ((d.years || []).some(y => String(y) === t)) s += 20;
    }
    return s + Math.log1p(d.starts || 0);
  }
  function results(q) {
    const tokens = tokenize(q);
    const out = [];
    for (const d of searchIndex) {
      if (!d.starts) continue;
      const s = score(d, tokens);
      if (s < 0) continue;
      out.push([s, d]);
    }
    out.sort((x, y) => y[0] - x[0]);
    return out.slice(0, 12).map(x => x[1]);
  }
  function render() {
    const items = results(input.value === labelFor(value) ? '' : input.value);
    list.replaceChildren();
    if (!items.length) { list.style.display = 'none'; return; }
    list.style.display = 'block';
    items.forEach((d, i) => {
      const yrs = d.years.length ? `${d.years[0]}–${d.years[d.years.length-1]}` : '—';
      const teams = (d.teams || []).slice(0, 3).join(', ') + (d.teams.length > 3 ? '…' : '');
      const row = UI.el('div', { class: 'driver-picker-item' + (i === activeIdx ? ' active' : ''),
        onmousedown: (e) => { e.preventDefault(); pick(d); } },
        UI.el('div', { class: 'name' },
          UI.flagSpan(d.nat),
          d.name,
          d.abbr ? UI.el('span', { class: 'muted', style: 'margin-left:6px' }, d.abbr) : null),
        UI.el('div', { class: 'sub muted' }, `${yrs} · ${d.starts} starts${teams ? ' · ' + teams : ''}`),
      );
      list.appendChild(row);
    });
  }
  function pick(d) {
    value = d.id;
    input.value = labelFor(d.id);
    list.style.display = 'none';
    activeIdx = -1;
  }

  input.addEventListener('focus', () => { activeIdx = -1; render(); });
  input.addEventListener('input', () => { value = ''; activeIdx = -1; render(); });
  input.addEventListener('blur', () => { setTimeout(() => { list.style.display = 'none'; }, 120); });
  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.driver-picker-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); render(); }
    else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const matches = results(input.value === labelFor(value) ? '' : input.value);
      if (matches[activeIdx]) pick(matches[activeIdx]);
    } else if (e.key === 'Escape') { list.style.display = 'none'; }
  });

  wrap.appendChild(input);
  wrap.appendChild(list);
  return { el: wrap, getValue: () => value };
}

const CompareView = {
  async render(root, params = {}) {
    const a = params.a;
    const b = params.b;

    root.replaceChildren(UI.loading('Loading drivers…'));
    const [drivers, searchIndex] = await Promise.all([
      F1Data.drivers(), F1Data.driverSearch(),
    ]);
    const driverMap = new Map(drivers.map(d => [d.id, d]));
    const searchMap = new Map(searchIndex.map(s => [s.id, s]));

    const view = UI.div({});
    view.appendChild(UI.crumbs({ label: 'Home', href: '#/' }, { label: 'Compare' }));
    view.appendChild(UI.h1({}, 'Compare drivers head-to-head'));

    // Two autocomplete pickers — search on name, team, year, or abbr.
    const labelFor = (id) => {
      const s = searchMap.get(id);
      if (!s) return id;
      const yrs = s.years.length ? `${s.years[0]}–${s.years[s.years.length-1]}` : '—';
      return `${s.name} · ${yrs}`;
    };
    const aPicker = makeDriverPicker(searchIndex, a, labelFor);
    const bPicker = makeDriverPicker(searchIndex, b, labelFor);
    const goBtn = UI.el('button', { class: 'btn',
      onclick: () => {
        const av = aPicker.getValue(), bv = bPicker.getValue();
        if (av && bv) location.hash = `#/compare/${av}/${bv}`;
      } }, 'Compare →');
    const row = UI.el('div', { class: 'compare-pickers' },
      aPicker.el,
      UI.el('span', { class: 'vs' }, 'vs'),
      bPicker.el,
      goBtn,
    );
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

    const [careerA, careerB, dpiAll, manifest] = await Promise.all([
      F1Data.driverCareer(a), F1Data.driverCareer(b), F1Data.dpiAll(), F1Data.manifest(),
    ]);
    const seasonMax = manifest.seasonMaxPoints || {};
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
    const statRow = (label, va, vb, higherWins = true, ca = va, cb = vb) => {
      // ca, cb = numeric compare values (default to va, vb for back-compat)
      const wa = ca != null && (cb == null || (higherWins ? ca > cb : ca < cb));
      const wb = cb != null && (ca == null || (higherWins ? cb > ca : cb < ca));
      return UI.el('div', { class: 'compare-stat' },
        UI.el('div', { class: 'a' + (wa ? ' winner' : '') }, va == null ? '—' : String(va)),
        UI.el('div', { class: 'label' }, label),
        UI.el('div', { class: 'b' + (wb ? ' winner' : '') }, vb == null ? '—' : String(vb))
      );
    };
    // Career-points "% of available" (sums season-max for years driver actually raced).
    const careerPctA = (() => {
      let pts = 0, max = 0;
      for (const y of careerA) {
        const sp = y.finalStanding?.points;
        const sm = seasonMax[String(y.year)];
        if (sp == null || !sm) continue;
        pts += sp; max += sm;
      }
      return max ? (100 * pts / max) : null;
    })();
    const careerPctB = (() => {
      let pts = 0, max = 0;
      for (const y of careerB) {
        const sp = y.finalStanding?.points;
        const sm = seasonMax[String(y.year)];
        if (sp == null || !sm) continue;
        pts += sp; max += sm;
      }
      return max ? (100 * pts / max) : null;
    })();

    compareCard.appendChild(statRow('Race starts', da.totalRaceStarts, db.totalRaceStarts));
    compareCard.appendChild(statRow('Sprint races',
      dpiA?.totalSprints ?? 0, dpiB?.totalSprints ?? 0));
    compareCard.appendChild(statRow('Wins', da.totalRaceWins, db.totalRaceWins));
    compareCard.appendChild(statRow('Podiums', da.totalPodiums, db.totalPodiums));
    compareCard.appendChild(statRow('Poles', da.totalPolePositions, db.totalPolePositions));
    compareCard.appendChild(statRow('Career points', da.totalPoints, db.totalPoints));
    compareCard.appendChild(statRow('% of available',
      careerPctA != null ? careerPctA.toFixed(1) + '%' : null,
      careerPctB != null ? careerPctB.toFixed(1) + '%' : null,
      true,
      // numeric compare
      careerPctA, careerPctB));
    compareCard.appendChild(statRow('Championships', da.totalChampionshipWins, db.totalChampionshipWins));
    compareCard.appendChild(statRow('Best championship', da.bestChampionshipPosition, db.bestChampionshipPosition, false));

    // Career-mean championship position (lower is better).
    const avgPosFor = (career) => {
      const ps = career.map(yr => yr.finalStanding?.position).filter(p => p != null);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
    };
    const avgPosA = avgPosFor(careerA);
    const avgPosB = avgPosFor(careerB);
    compareCard.appendChild(statRow('Avg championship pos',
      avgPosA != null ? avgPosA.toFixed(1) : null,
      avgPosB != null ? avgPosB.toFixed(1) : null,
      false,  // lower is better
      avgPosA, avgPosB));
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

    // Per-season points chart — normalised to "% of season's available points"
    // so 1950s seasons (~60 max) compare meaningfully with 2024 (~650 max).
    const yearsA = new Map(careerA.map(y => [y.year, y]));
    const yearsB = new Map(careerB.map(y => [y.year, y]));
    const allYears = [...new Set([...yearsA.keys(), ...yearsB.keys()])].sort();
    const pctOf = (pts, year) => {
      const max = seasonMax[String(year)];
      if (pts == null || !max) return null;
      return 100 * pts / max;
    };
    const pctA = allYears.map(y => pctOf(yearsA.get(y)?.finalStanding?.points, y));
    const pctB = allYears.map(y => pctOf(yearsB.get(y)?.finalStanding?.points, y));
    const ptsA = allYears.map(y => yearsA.get(y)?.finalStanding?.points ?? null);
    const ptsB = allYears.map(y => yearsB.get(y)?.finalStanding?.points ?? null);

    const chartCard = UI.el('section', { class: 'card' });
    chartCard.appendChild(UI.h2({}, 'Share of season’s available points'));
    chartCard.appendChild(UI.p({ class: 'muted' },
      'Each driver’s championship points as a percentage of the maximum a driver could have scored that year. Strips out the era inflation: 1990 awarded 144 points season-max, 2024 awarded 652. Includes sprint points.'));
    const canvas = UI.el('canvas');
    chartCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
    view.appendChild(chartCard);

    // Championship position by season — y-axis reversed so P1 is at the top.
    const posA = allYears.map(y => yearsA.get(y)?.finalStanding?.position ?? null);
    const posB = allYears.map(y => yearsB.get(y)?.finalStanding?.position ?? null);
    const posMax = Math.max(
      ...posA.filter(p => p != null), ...posB.filter(p => p != null), 10);

    const posCard = UI.el('section', { class: 'card' });
    posCard.appendChild(UI.h2({}, 'Championship position by season'));
    posCard.appendChild(UI.p({ class: 'muted' },
      'End-of-season championship rank. Lower = better; P1 on top.'));
    const posCanvas = UI.el('canvas');
    posCard.appendChild(UI.el('div', { class: 'chart-wrap tall' }, posCanvas));
    view.appendChild(posCard);

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
            { label: da.lastName || da.name, data: pctA, borderColor: '#e10600',
              backgroundColor: '#e10600', tension: 0.2, spanGaps: true,
              raw: ptsA },
            { label: db.lastName || db.name, data: pctB, borderColor: '#1f8efa',
              backgroundColor: '#1f8efa', tension: 0.2, spanGaps: true,
              raw: ptsB },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#e6e9ee' } },
            tooltip: { callbacks: {
              label: (ctx) => {
                const pct = ctx.parsed.y;
                const raw = ctx.dataset.raw?.[ctx.dataIndex];
                const max = seasonMax[allYears[ctx.dataIndex]];
                return `${ctx.dataset.label}: ${pct == null ? '—' : pct.toFixed(1) + '%'} (${raw ?? '—'} of ${max ?? '—'} pts)`;
              },
            } },
          },
          scales: { x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                    y: { min: 0, max: 100, ticks: { color: '#9aa3af', callback: v => v + '%' },
                         grid: { color: '#2a313a' },
                         title: { display: true, text: '% of season max', color: '#9aa3af' } } } },
      });
      new Chart(posCanvas, {
        type: 'line',
        data: {
          labels: allYears.map(String),
          datasets: [
            { label: da.lastName || da.name, data: posA, borderColor: '#e10600',
              backgroundColor: '#e10600', tension: 0.2, spanGaps: true, pointRadius: 4 },
            { label: db.lastName || db.name, data: posB, borderColor: '#1f8efa',
              backgroundColor: '#1f8efa', tension: 0.2, spanGaps: true, pointRadius: 4 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#e6e9ee' } },
            tooltip: { callbacks: {
              label: (ctx) => `${ctx.dataset.label}: P${ctx.parsed.y}`,
            } },
          },
          scales: { x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
                    y: { reverse: true, min: 1, max: posMax,
                         ticks: { color: '#9aa3af', stepSize: 1, precision: 0,
                                  callback: v => 'P' + v },
                         grid: { color: '#2a313a' },
                         title: { display: true, text: 'Championship position', color: '#9aa3af' } } } },
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
