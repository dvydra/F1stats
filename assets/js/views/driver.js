// Driver profile: career stats, season-by-season trajectory, points vs DPI chart.

const DriverView = {
  async render(root, driverId, tab) {
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
      const [career, dpiAll, manifest] = await Promise.all([
        F1Data.driverCareer(driverId), F1Data.dpiAll(), F1Data.manifest(),
      ]);

      const flagLg = UI.flagSpan(d.nationality);
      const country = UI.countryName(d.nationality);

      // Career mean championship position across all seasons raced.
      const seasonPositions = career.map(yr => yr.finalStanding?.position)
                                    .filter(p => p != null);
      const avgChampPos = seasonPositions.length
        ? seasonPositions.reduce((a, b) => a + b, 0) / seasonPositions.length
        : null;

      view.appendChild(UI.el('section', { class: 'hero' },
        UI.h1({},
          flagLg ? UI.el('span', { class: 'flag flag-lg' }, UI.flag(d.nationality)) : null,
          d.fullName || d.name),
        UI.p({}, [d.abbreviation, country,
                  d.dateOfBirth ? `b. ${d.dateOfBirth}` : null,
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

      // DPI is now a tab (the default). Seasons, Points-vs-DPI chart, and
      // All races are also tabs. Selected tab is persisted in the URL hash:
      //   #/driver/:id            → DPI tab (default)
      //   #/driver/:id/seasons    → Season history
      //   #/driver/:id/chart      → Points vs DPI chart
      //   #/driver/:id/races      → All races
      const myDpi = dpiAll.find(x => x.driverId === driverId);
      const hasDpi = myDpi && (myDpi.meanOverall != null || myDpi.qualiElo != null);

      const defs = [];
      if (hasDpi) defs.push({ id: 'dpi', label: 'DPI' });
      defs.push({ id: 'seasons', label: 'Season history' });
      defs.push({ id: 'races', label: 'All races' });

      const validTabs = new Set(defs.map(d => d.id));
      let cur = validTabs.has(tab) ? tab : defs[0].id;

      const tabs = UI.el('div', { class: 'tabs' });
      const content = UI.div({});

      const renderTab = () => {
        UI.clearChildren(content);
        $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === cur));
        if (cur === 'dpi') content.appendChild(dpiTab());
        else if (cur === 'seasons') content.appendChild(seasonsTab());
        else if (cur === 'races') content.appendChild(racesTab());
      };
      for (const dd of defs) {
        tabs.appendChild(UI.el('button', { 'data-tab': dd.id,
          onclick: () => {
            cur = dd.id;
            // Update hash without re-triggering full route render. Default
            // tab gets the bare URL so it shareably resolves to the same view.
            const next = (dd.id === defs[0].id)
              ? `#/driver/${driverId}`
              : `#/driver/${driverId}/${dd.id}`;
            if (location.hash !== next) {
              history.replaceState(null, '', next);
            }
            renderTab();
          } }, dd.label));
      }
      view.appendChild(tabs);
      view.appendChild(content);
      root.replaceChildren(view);
      renderTab();

      function dpiTab() {
        return UI.el('section', { class: 'card' },
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
        );
      }

      function seasonsTab() {
        const dpiByYear = new Map((myDpi?.seasons || []).map(s => [s.year, s]));
        const seasonMax = manifest.seasonMaxPoints || {};

        // Year axis = years the driver actually raced.
        const years = career.map(y => y.year);
        const labels = years.map(y =>
          UI.isPartialSeason(y, manifest) ? `${y}*` : String(y));

        // Per-year derived series.
        const ptsPct = years.map(y => {
          const fs = career.find(c => c.year === y).finalStanding;
          const max = seasonMax[String(y)];
          return (fs?.points != null && max) ? (100 * fs.points / max) : null;
        });
        const dpiVals     = years.map(y => dpiByYear.get(y)?.shrunkOverall ?? null);
        const quali       = years.map(y => dpiByYear.get(y)?.meanQuali ?? null);
        const racecraft   = years.map(y => dpiByYear.get(y)?.meanRaceAdj ?? null);
        const finish      = years.map(y => dpiByYear.get(y)?.meanFinish ?? null);
        const champPos    = years.map(y => career.find(c => c.year === y).finalStanding?.position ?? null);
        const qualiDelta  = years.map(y => {
          const d = dpiByYear.get(y)?.meanQualiDelta;
          return d != null ? -d : null;  // flip so positive = beat teammate
        });
        const tmRate      = years.map(y => {
          const s = dpiByYear.get(y);
          if (!s || !s.teammateRaces) return null;
          return 100 * s.teammateBeats / s.teammateRaces;
        });
        const qElo        = years.map(y => dpiByYear.get(y)?.qualiElo ?? null);
        const rElo        = years.map(y => dpiByYear.get(y)?.raceElo ?? null);
        const champPosMax = Math.max(...champPos.filter(p => p != null), 5);

        // Shared chart axis defaults.
        const xCfg = { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } };
        const baseOpts = (extra = {}) => ({
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#e6e9ee' } },
            ...(extra.plugins || {}),
          },
          scales: { x: xCfg, ...(extra.scales || {}) },
        });

        const card = (title, blurb, canvas) =>
          UI.el('section', { class: 'card' },
            UI.h2({}, title),
            blurb ? UI.p({ class: 'muted' }, blurb) : null,
            UI.el('div', { class: 'chart-wrap tall' }, canvas));

        // Defer chart construction so the canvases are in the DOM first.
        const charts = [];
        const make = (build) => {
          const canvas = UI.el('canvas');
          charts.push(() => build(canvas));
          return canvas;
        };
        setTimeout(() => charts.forEach(fn => fn()), 10);

        const wrap = UI.div({});

        // 1) Share of season's available points + Shrunk DPI on dual axes.
        //    Points share spans 0–80%+; DPI clusters tightly around 50
        //    (shrinkage + field-centering). Forcing them onto one scale
        //    squashes the DPI line, so each gets its own auto-fit axis
        //    with reference markers (50 for DPI, 0 for points).
        const dpiObs = dpiVals.filter(v => v != null);
        const dpiMin = dpiObs.length ? Math.min(40, Math.floor(Math.min(...dpiObs) - 2)) : 40;
        const dpiMax = dpiObs.length ? Math.max(70, Math.ceil(Math.max(...dpiObs) + 2)) : 70;

        wrap.appendChild(card(
          'Points share vs driver skill',
          'Red (left axis) = championship points as a % of the season\'s available points — ' +
          'how much you actually scored, era-normalised. ' +
          'Blue (right axis) = Shrunk DPI (50 = field-average); the dashed line marks 50. ' +
          'Read the trajectories independently: a season where red soars while blue stays around 50 = ' +
          'a strong machine carrying you; blue moving up while red stays flat = ' +
          'driver outperforming the car.',
          make((canvas) => new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [
                { label: '% of season points', data: ptsPct,
                  borderColor: '#e10600', backgroundColor: '#e10600',
                  tension: 0.2, spanGaps: true, pointRadius: 4,
                  yAxisID: 'y' },
                { label: 'Shrunk DPI', data: dpiVals,
                  borderColor: '#1f8efa', backgroundColor: '#1f8efa',
                  tension: 0.2, spanGaps: true, pointRadius: 4,
                  yAxisID: 'y1' },
              ],
            },
            options: baseOpts({
              scales: {
                y: { type: 'linear', position: 'left',
                  min: 0, suggestedMax: 100,
                  ticks: { color: '#e10600', callback: v => v + '%' },
                  grid: { color: '#2a313a' },
                  title: { display: true, text: '% of season points', color: '#e10600' } },
                y1: { type: 'linear', position: 'right',
                  min: dpiMin, max: dpiMax,
                  ticks: { color: '#1f8efa' },
                  grid: { display: false },
                  title: { display: true, text: 'Shrunk DPI (50 = field avg)', color: '#1f8efa' } },
              },
            }),
            // Dashed reference line at DPI=50 (field average).
            plugins: [{
              id: 'dpiAvgLine',
              beforeDatasetsDraw(chart) {
                const y1 = chart.scales.y1;
                if (!y1) return;
                const { ctx, chartArea } = chart;
                const yPx = y1.getPixelForValue(50);
                if (yPx < chartArea.top || yPx > chartArea.bottom) return;
                ctx.save();
                ctx.strokeStyle = 'rgba(31,142,250,0.35)';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(chartArea.left, yPx);
                ctx.lineTo(chartArea.right, yPx);
                ctx.stroke();
                ctx.restore();
              },
            }],
          })),
        ));

        // 2) DPI components per season — stacked bar with weighted contributions.
        wrap.appendChild(card(
          'DPI components by season',
          'How the overall DPI breaks down each year: 30% Quali + 40% Racecraft + 30% Finish. ' +
          'Tall stacks = strong overall; top-heavy = anchored by finishes; bottom-heavy = quali-led.',
          make((canvas) => new Chart(canvas, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'Quali (×0.30)',
                  data: quali.map(v => v == null ? null : v * 0.30),
                  backgroundColor: '#1f8efa', stack: 'dpi' },
                { label: 'Racecraft (×0.40)',
                  data: racecraft.map(v => v == null ? null : v * 0.40),
                  backgroundColor: '#7bd389', stack: 'dpi' },
                { label: 'Finish (×0.30)',
                  data: finish.map(v => v == null ? null : v * 0.30),
                  backgroundColor: '#ffd166', stack: 'dpi' },
              ],
            },
            options: baseOpts({
              scales: {
                y: { stacked: true, min: 0, max: 100,
                  ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                  title: { display: true, text: 'DPI (weighted)', color: '#9aa3af' } },
                x: { ...xCfg, stacked: true },
              },
            }),
          })),
        ));

        // 3) Championship position by season — inverted y, P1 on top.
        wrap.appendChild(card(
          'Championship position by season',
          'End-of-season standings rank. Lower is better — P1 sits on top.',
          make((canvas) => new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: 'Championship pos',
                data: champPos,
                borderColor: '#e10600', backgroundColor: '#e10600',
                tension: 0.2, spanGaps: true, pointRadius: 5,
              }],
            },
            options: baseOpts({
              plugins: { legend: { display: false } },
              scales: {
                y: { reverse: true, min: 1, max: champPosMax,
                  ticks: { color: '#9aa3af', stepSize: 1, precision: 0,
                           callback: v => 'P' + v },
                  grid: { color: '#2a313a' },
                  title: { display: true, text: 'Championship position', color: '#9aa3af' } },
              },
            }),
          })),
        ));

        // 4) Teammate quali pace + H2H rate.
        wrap.appendChild(card(
          'Teammate qualifying head-to-head',
          'Yellow bar = mean qualifying lap-time advantage over teammate (positive = faster). ' +
          'Green dot = % of teammate quali sessions won.',
          make((canvas) => new Chart(canvas, {
            data: {
              labels,
              datasets: [
                { type: 'bar', label: 'Quali Δ% vs teammate',
                  data: qualiDelta,
                  backgroundColor: qualiDelta.map(v =>
                    v == null ? '#666' : v >= 0 ? '#ffd166' : '#cc4d4d'),
                  yAxisID: 'y' },
                { type: 'line', label: 'Quali H2H win rate',
                  data: tmRate,
                  borderColor: '#7bd389', backgroundColor: '#7bd389',
                  tension: 0.2, spanGaps: true, pointRadius: 4,
                  yAxisID: 'y1' },
              ],
            },
            options: baseOpts({
              scales: {
                y: { position: 'left',
                  ticks: { color: '#ffd166', callback: v => v.toFixed(2) + '%' },
                  grid: { color: '#2a313a' },
                  title: { display: true, text: 'Δ% vs teammate (faster →)', color: '#ffd166' } },
                y1: { position: 'right', min: 0, max: 100,
                  ticks: { color: '#7bd389', callback: v => v + '%' },
                  grid: { display: false },
                  title: { display: true, text: 'H2H win rate', color: '#7bd389' } },
              },
            }),
          })),
        ));

        // 5) Quali Elo + Race Elo trajectory.
        wrap.appendChild(card(
          'Teammate Elo trajectory',
          'Cumulative Elo from teammate head-to-heads, K=24 starting from 1500. ' +
          'Persists across team changes — solves the "beating Hamilton vs beating a rookie" problem.',
          make((canvas) => new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [
                { label: 'Quali Elo', data: qElo,
                  borderColor: '#1f8efa', backgroundColor: '#1f8efa',
                  tension: 0.2, spanGaps: true, pointRadius: 4 },
                { label: 'Race Elo',  data: rElo,
                  borderColor: '#e10600', backgroundColor: '#e10600',
                  tension: 0.2, spanGaps: true, pointRadius: 4 },
              ],
            },
            options: baseOpts({
              scales: {
                y: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                  title: { display: true, text: 'Elo', color: '#9aa3af' } },
              },
            }),
          })),
        ));

        // 6) Season-by-season table — keeps the tabular drill-down.
        // Annotate team-change rows with a chevron and the YoY DPI delta.
        let prevTeam = null, prevDpi = null;
        wrap.appendChild(UI.el('section', { class: 'card' },
          UI.h2({}, 'Season-by-season'),
          UI.p({ class: 'muted' },
            'Rows where the team changed are marked with → and a YoY DPI delta — '+
            'so you can see whether the move helped or hurt.'),
          UI.table(
            ['Year', 'Team', 'Δ', 'Pos', 'Points', 'Pts %', 'Wins', 'Shrunk DPI', 'Best 75%', 'qElo', 'DSC'],
            career.map(yr => {
              const team = yr.races[0]?.result.constructorId;
              const c = constructors.get(team);
              const fs = yr.finalStanding;
              const dr = dpiByYear.get(yr.year);
              const dpiVal = dr?.shrunkOverall ?? dr?.meanOverall;
              const max = seasonMax[String(yr.year)];
              const pct = (fs?.points != null && max) ? (100 * fs.points / max) : null;
              const teamChanged = prevTeam != null && team && team !== prevTeam;
              const dpiDelta = (teamChanged && prevDpi != null && dpiVal != null)
                ? (dpiVal - prevDpi) : null;
              const cell = teamChanged
                ? UI.el('span', {
                    style: 'color:' + (dpiDelta == null ? '#9aa3af'
                                         : dpiDelta >= 0 ? '#7bd389' : '#cc4d4d'),
                    title: dpiDelta != null
                      ? `DPI ${dpiDelta >= 0 ? '+' : ''}${dpiDelta.toFixed(1)} after move`
                      : 'Team change' },
                    dpiDelta != null
                      ? `→ ${dpiDelta >= 0 ? '+' : ''}${dpiDelta.toFixed(1)}`
                      : '→')
                : '';
              prevTeam = team;
              if (dpiVal != null) prevDpi = dpiVal;
              return [
                UI.yearLabel(yr.year, manifest, { href: `#/season/${yr.year}` }),
                UI.constructorLink(c),
                cell,
                { value: fs?.position ?? '—', class: 'mono' },
                { value: fs?.points ?? '—', class: 'pts' },
                { value: pct != null ? pct.toFixed(1) + '%' : '—', class: 'pts' },
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
        ));

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
        dnf: s?.dnf ?? null,
        dnfPct: s?.dnfPct ?? null,
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
        fmt: (r) => r.nat
          ? UI.el('span', { title: UI.countryName(r.nat) || r.nat },
                  UI.flag(r.nat) || (UI.countryISO(r.nat) || '—'))
          : '—',
        sort: (a, b) => (UI.countryName(a.nat) || '').localeCompare(UI.countryName(b.nat) || '') },
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
      { key: 'dnf',       label: 'DNF',     align: 'right' },
      { key: 'dnfPct',    label: 'DNF%',    align: 'right',
        fmt: (r) => r.dnfPct != null ? r.dnfPct.toFixed(1) + '%' : '—',
        sort: (a, b) => (b.dnfPct ?? -Infinity) - (a.dnfPct ?? -Infinity) },
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
