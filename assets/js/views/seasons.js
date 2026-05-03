// All-seasons index view + Season detail view.

const SeasonsListView = {
  async render(root) {
    root.replaceChildren(UI.loading('Loading seasons…'));
    const idx = await F1Data.manifest();
    const view = UI.div({});
    view.appendChild(UI.h1({}, 'All seasons'));
    view.appendChild(UI.p({ class: 'muted' },
      `Formula 1 World Championship · ${idx.years[0]}–${idx.years[idx.years.length - 1]}`));

    const grid = UI.el('div', { class: 'grid grid-auto', style: 'margin-top:16px;' });
    for (const y of [...idx.years].reverse()) {
      const partial = UI.isPartialSeason(y, idx);
      const r = idx.seasonRounds?.[String(y)];
      grid.appendChild(UI.el('a', { href: `#/season/${y}`, class: 'card',
        style: 'text-align:center;padding:18px;cursor:pointer;' },
        UI.el('div', { style: 'font-size:24px;font-weight:700;font-family:var(--mono);' },
          String(y),
          partial ? UI.el('span', { class: 'partial-star',
            title: r ? `In progress — ${r.completed} of ${r.scheduled} rounds` : 'In progress' }, '*') : null),
        UI.el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' },
          partial ? `${r.completed}/${r.scheduled} rounds` : 'View season')
      ));
    }
    view.appendChild(grid);
    root.replaceChildren(view);
  },
};

const SeasonView = {
  async render(root, year) {
    year = parseInt(year, 10);
    root.replaceChildren(UI.loading(`Loading ${year} season…`));
    try {
      const [season, dpi, drivers, constructors, gpMap] = await Promise.all([
        F1Data.season(year),
        F1Data.dpi(year),
        F1Data.driverMap(),
        F1Data.constructorMap(),
        F1Data.grandPrixMap(),
      ]);

      const view = UI.div({});
      view.appendChild(UI.crumbs(
        { label: 'Home', href: '#/' },
        { label: 'Seasons', href: '#/seasons' },
        { label: String(year) },
      ));

      // Season selector
      const idx = await F1Data.manifest();
      const partial = UI.isPartialSeason(year, idx);
      const r = idx.seasonRounds?.[String(year)];
      const sel = UI.el('select', { onchange: (e) => location.hash = `#/season/${e.target.value}` });
      for (const y of [...idx.years].reverse()) {
        const o = UI.el('option', { value: y },
          UI.isPartialSeason(y, idx) ? `${y} (in progress)` : String(y));
        if (y === year) o.selected = true;
        sel.appendChild(o);
      }

      view.appendChild(UI.el('div', { class: 'selector-row' },
        UI.h1({}, `${year}${partial ? '*' : ''} season`),
        sel,
        UI.el('a', { class: 'btn ghost', href: `#/dpi/${year}` }, 'DPI ranking'),
      ));

      // Tabs: standings | constructors | schedule | DPI vs Points chart
      const tabs = UI.el('div', { class: 'tabs' });
      const content = UI.div({});

      const tabDefs = [
        { id: 'drivers', label: 'Drivers' },
        { id: 'constructors', label: 'Constructors' },
        { id: 'trajectory', label: 'Trajectory' },
        { id: 'schedule', label: 'Schedule' },
        { id: 'dpi-vs-points', label: 'DPI vs Points' },
      ];

      let currentTab = 'drivers';
      const renderTab = () => {
        UI.clearChildren(content);
        $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
        if (currentTab === 'drivers') content.appendChild(driversTab(season, drivers, constructors, dpi));
        else if (currentTab === 'constructors') content.appendChild(constructorsTab(season, constructors));
        else if (currentTab === 'trajectory') content.appendChild(trajectoryTab(season, drivers, constructors));
        else if (currentTab === 'schedule') content.appendChild(scheduleTab(season, drivers, gpMap, year));
        else if (currentTab === 'dpi-vs-points') content.appendChild(dpiVsPointsTab(dpi, season, drivers, constructors));
      };
      for (const tdef of tabDefs) {
        const b = UI.el('button', { 'data-tab': tdef.id,
          onclick: () => { currentTab = tdef.id; renderTab(); } }, tdef.label);
        tabs.appendChild(b);
      }
      view.appendChild(tabs);
      view.appendChild(content);
      root.replaceChildren(view);
      renderTab();
    } catch (e) {
      root.replaceChildren(UI.errorBox('Failed to load season: ' + e.message));
      console.error(e);
    }

    function driversTab(season, drivers, constructors, dpi) {
      const dpiByDriver = new Map(dpi.drivers.map(d => [d.driverId, d]));
      return UI.el('section', { class: 'card' },
        UI.h2({}, 'Final driver standings'),
        UI.table(
          ['#', 'Driver', 'Nat', 'Team', 'Points', 'Wins', 'DPI', 'qElo'],
          season.finalDriverStandings.map(s => {
            const d = drivers.get(s.driverId);
            const c = constructors.get(s.constructorId);
            const dr = dpiByDriver.get(s.driverId);
            const dpiVal = dr?.shrunkOverall ?? dr?.meanOverallAdj;
            return [
              { value: s.position, class: `pos ${UI.posClass(s.position)}` },
              UI.driverLink(d),
              { value: d?.nationality?.toUpperCase().slice(0, 3) || '—', class: 'mono' },
              UI.constructorLink(c),
              { value: s.points, class: 'pts' },
              { value: s.wins ?? '—', class: 'pts' },
              UI.el('span', { class: 'pts',
                style: dpiVal != null ? `color:${DPI.scoreColor(dpiVal)};font-weight:700` : '' },
                DPI.fmtScore(dpiVal)),
              { value: dr?.qualiElo != null ? Math.round(dr.qualiElo) : '—', class: 'mono' },
            ];
          })
        )
      );
    }

    function constructorsTab(season, constructors) {
      return UI.el('section', { class: 'card' },
        UI.h2({}, 'Final constructor standings'),
        UI.table(
          ['#', 'Constructor', 'Country', 'Points', 'Wins'],
          season.finalConstructorStandings.map(s => {
            const c = constructors.get(s.constructorId);
            return [
              { value: s.position, class: `pos ${UI.posClass(s.position)}` },
              UI.constructorLink(c),
              { value: c?.country?.toUpperCase().slice(0, 3) || '—', class: 'mono' },
              { value: s.points, class: 'pts' },
              { value: s.wins ?? '—', class: 'pts' },
            ];
          })
        )
      );
    }

    function trajectoryTab(season, drivers, constructors) {
      const completedRaces = season.races.filter(r => r.results && r.results.length);
      if (!completedRaces.length) {
        return UI.el('section', { class: 'card' },
          UI.h2({}, 'Trajectory'),
          UI.p({ class: 'muted' }, 'No races completed yet — come back after round 1.'));
      }
      const labels = completedRaces.map(r => `R${r.round}`);

      // Per-driver series, indexed by completed-race index.
      // Discover all drivers with ANY appearance in this season.
      const allDriverIds = new Set();
      for (const race of completedRaces) {
        for (const r of race.results) allDriverIds.add(r.driverId);
      }
      const driverIds = [...allDriverIds];

      // Pull team for each driver from their first race result this season.
      const teamFor = new Map();
      for (const did of driverIds) {
        for (const race of completedRaces) {
          const r = race.results.find(x => x.driverId === did);
          if (r) { teamFor.set(did, r.constructorId); break; }
        }
      }

      // Stable team palette so teammates share a colour.
      const palette = ['#e10600', '#1f8efa', '#7bd389', '#ffd166', '#a986ff',
                       '#ff7a45', '#13c2c2', '#eb2f96', '#52c41a', '#faad14',
                       '#2f54eb', '#fa541c', '#9e1068', '#36cfc9', '#fadb14',
                       '#722ed1'];
      const teamColor = new Map();
      let cIdx = 0;
      const colourFor = (teamId) => {
        if (!teamId) return '#888';
        if (!teamColor.has(teamId)) teamColor.set(teamId, palette[cIdx++ % palette.length]);
        return teamColor.get(teamId);
      };
      // Solid for the teammate who's currently leading the championship; dashed
      // for the second teammate — gives a visible H2H without extra colours.
      const dashByTeam = new Map();
      const driverDashes = new Map();
      for (const did of driverIds) {
        const team = teamFor.get(did);
        if (!team) continue;
        if (!dashByTeam.has(team)) { dashByTeam.set(team, [false]); driverDashes.set(did, false); }
        else                       { driverDashes.set(did, true); }
      }

      // Build series per driver:
      //   cumPts[i] - cumulative points after race i  (from official standings)
      //   champPos[i] - championship position after race i
      //   finishPos[i] - finishing position in race i (null if didn't appear)
      //   gridPos[i] - grid position in race i
      const series = new Map();
      for (const did of driverIds) {
        series.set(did, { cum: [], champ: [], finish: [], grid: [] });
      }
      let prevCum = new Map();
      for (let i = 0; i < completedRaces.length; i++) {
        const race = completedRaces[i];
        const stMap = new Map((race.driverStandings || []).map(s => [s.driverId, s]));
        const resMap = new Map((race.results || []).map(r => [r.driverId, r]));
        for (const did of driverIds) {
          const ser = series.get(did);
          const st = stMap.get(did);
          // Cumulative points: prefer standings if present, otherwise carry the
          // previous value forward (driver scored 0 at this round).
          const cum = st?.points ?? prevCum.get(did) ?? null;
          ser.cum.push(cum);
          if (cum != null) prevCum.set(did, cum);
          ser.champ.push(st?.position ?? null);
          const r = resMap.get(did);
          ser.finish.push(r?.position ?? null);
          ser.grid.push(r?.grid ?? null);
        }
      }

      // Sort drivers by final standings (so legend is intuitive).
      const finalRank = new Map(season.finalDriverStandings.map((s, i) => [s.driverId, i]));
      driverIds.sort((a, b) =>
        (finalRank.get(a) ?? 999) - (finalRank.get(b) ?? 999));

      const datasetFor = (key, opts = {}) => driverIds.map(did => {
        const drv = drivers.get(did);
        const teamId = teamFor.get(did);
        const data = series.get(did)[key];
        return {
          label: drv?.lastName || drv?.name || did,
          data,
          borderColor: colourFor(teamId),
          backgroundColor: colourFor(teamId),
          borderDash: driverDashes.get(did) ? [6, 4] : [],
          tension: 0.2,
          spanGaps: true,
          pointRadius: opts.pointRadius ?? 2,
          borderWidth: 2,
          driverId: did,
        };
      });

      // Compute axis bounds for inverted-y position charts.
      const allChamp = [].concat(...driverIds.map(d => series.get(d).champ)).filter(v => v != null);
      const allFinish = [].concat(...driverIds.map(d => series.get(d).finish)).filter(v => v != null);
      const champMax = Math.max(10, ...allChamp);
      const finishMax = Math.max(10, ...allFinish);

      const wrap = UI.div({});

      const baseOpts = (extra = {}) => ({
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#e6e9ee', boxWidth: 12,
            font: { size: 10 } } },
          tooltip: { callbacks: {
            title: (items) => items[0]?.label ? `Round ${items[0].label.replace('R','')}` : '',
            ...(extra.tooltipCallbacks || {}),
          } },
          ...(extra.plugins || {}),
        },
        scales: {
          x: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
          ...(extra.scales || {}),
        },
      });

      const card = (title, blurb, build) => {
        const c = UI.el('section', { class: 'card' },
          UI.h2({}, title),
          blurb ? UI.p({ class: 'muted' }, blurb) : null);
        const canvas = UI.el('canvas');
        c.appendChild(UI.el('div', { class: 'chart-wrap tall' }, canvas));
        wrap.appendChild(c);
        setTimeout(() => build(canvas), 10);
      };

      // 1) Cumulative points hill chart.
      card('Cumulative points by round',
        'The "hill chart" — every driver\'s running points total. Lines that climb fast = a hot run; ' +
        'flat lines = a cold streak. Solid vs dashed within a team distinguishes teammates.',
        (canvas) => new Chart(canvas, {
          type: 'line',
          data: { labels, datasets: datasetFor('cum') },
          options: baseOpts({
            scales: {
              y: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                title: { display: true, text: 'Championship points', color: '#9aa3af' } },
            },
            tooltipCallbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y ?? '—'} pts`,
            },
          }),
        }));

      // 2) Championship position by round.
      card('Championship position by round',
        'Where each driver sits in the standings after every round. Flipped y-axis: P1 is at the top.',
        (canvas) => new Chart(canvas, {
          type: 'line',
          data: { labels, datasets: datasetFor('champ', { pointRadius: 3 }) },
          options: baseOpts({
            scales: {
              y: { reverse: true, min: 1, max: champMax,
                ticks: { color: '#9aa3af', stepSize: 1, precision: 0,
                         callback: v => 'P' + v },
                grid: { color: '#2a313a' },
                title: { display: true, text: 'Championship position', color: '#9aa3af' } },
            },
            tooltipCallbacks: {
              label: (ctx) => `${ctx.dataset.label}: P${ctx.parsed.y ?? '—'}`,
            },
          }),
        }));

      // 3) Race finishing position by round.
      card('Race finishing position by round',
        'Per-race finish, not cumulative. Spikes show breakout drives or DNFs.',
        (canvas) => new Chart(canvas, {
          type: 'line',
          data: { labels, datasets: datasetFor('finish', { pointRadius: 3 }) },
          options: baseOpts({
            scales: {
              y: { reverse: true, min: 1, max: finishMax,
                ticks: { color: '#9aa3af', stepSize: 1, precision: 0,
                         callback: v => 'P' + v },
                grid: { color: '#2a313a' },
                title: { display: true, text: 'Finish', color: '#9aa3af' } },
            },
            tooltipCallbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'DNS/DNF' : 'P'+ctx.parsed.y}`,
            },
          }),
        }));

      // 4) Gap to championship leader.
      card('Gap to leader (points)',
        'Distance to the top of the standings after each round — flatlines around 0 are co-leaders, ' +
        'rising lines are slipping behind.',
        (canvas) => {
          // Compute gap = leaderPts - driverPts at each round.
          const leaderCum = labels.map((_, i) => {
            return Math.max(0, ...driverIds.map(d => series.get(d).cum[i] ?? 0));
          });
          const datasets = driverIds.map(did => {
            const teamId = teamFor.get(did);
            const drv = drivers.get(did);
            const data = series.get(did).cum.map((v, i) =>
              v == null ? null : leaderCum[i] - v);
            return {
              label: drv?.lastName || drv?.name || did,
              data,
              borderColor: colourFor(teamId),
              backgroundColor: colourFor(teamId),
              borderDash: driverDashes.get(did) ? [6, 4] : [],
              tension: 0.2,
              spanGaps: true,
              pointRadius: 2,
              borderWidth: 2,
            };
          });
          new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: baseOpts({
              scales: {
                y: { reverse: true,
                  ticks: { color: '#9aa3af',
                           callback: v => v === 0 ? 'leader' : `−${v}` },
                  grid: { color: '#2a313a' },
                  title: { display: true, text: 'Pts behind leader',
                           color: '#9aa3af' } },
              },
              tooltipCallbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '—' : (ctx.parsed.y === 0 ? 'leader' : '−' + ctx.parsed.y + ' pts')}`,
              },
            }),
          });
        });

      // 5) Per-race points scored (small bars per round, top 6 only).
      card('Points scored per race (top 6)',
        'Per-race points (not cumulative) for the top 6 drivers in the standings. ' +
        'Big single-race spikes = race wins; consecutive small bars = consistent points-finishing.',
        (canvas) => {
          const top6 = driverIds.slice(0, 6);
          const datasets = top6.map(did => {
            const drv = drivers.get(did);
            const data = labels.map((_, i) => {
              const race = completedRaces[i];
              const r = race.results.find(x => x.driverId === did);
              const sprint = (race.sprintResults || []).find(x => x.driverId === did);
              return (r?.points || 0) + (sprint?.points || 0);
            });
            return {
              label: drv?.lastName || drv?.name || did,
              data,
              backgroundColor: colourFor(teamFor.get(did)),
              borderWidth: 0,
            };
          });
          new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets },
            options: baseOpts({
              scales: {
                y: { ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                  title: { display: true, text: 'Points (race + sprint)',
                           color: '#9aa3af' } },
              },
              tooltipCallbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} pts`,
              },
            }),
          });
        });

      return wrap;
    }

    function scheduleTab(season, drivers, gpMap, year) {
      const wrap = UI.el('section', { class: 'card' }, UI.h2({}, `${season.races.length} races`));
      for (const race of season.races) {
        const winner = race.results[0];
        const wd = winner ? drivers.get(winner.driverId) : null;
        const gp = gpMap.get(race.grandPrixId);
        wrap.appendChild(UI.el('a', { class: 'race-card', href: `#/season/${year}/race/${race.round}` },
          UI.el('div', {},
            UI.el('div', { class: 'round' }, `Round ${race.round} · ${UI.fmtDate(race.date)}`),
            UI.el('div', { class: 'name' }, gp?.name || race.name),
          ),
          UI.el('div', { class: 'winner' },
            wd ? `🏆 ${wd.name || wd.fullName}` : (race.results.length ? '—' : 'Upcoming')),
        ));
      }
      return wrap;
    }

    function dpiVsPointsTab(dpi, season, drivers, constructors) {
      const wrap = UI.el('section', { class: 'card' });
      wrap.appendChild(UI.h2({}, 'Points vs DPI'));
      wrap.appendChild(UI.p({ class: 'muted' },
        'Each dot is a driver. The horizontal axis is championship points (car-influenced). The vertical axis is DPI (car-controlled performance metric). Drivers above the trend line are outperforming their car; drivers below are being carried by it.'));

      const standings = new Map(season.finalDriverStandings.map(s => [s.driverId, s]));
      const points = [];
      for (const d of dpi.drivers) {
        const s = standings.get(d.driverId);
        const y = d.shrunkOverall ?? d.meanOverallAdj;
        if (y == null) continue;
        const drv = drivers.get(d.driverId);
        const tm = constructors.get(d.team);
        points.push({
          driverId: d.driverId,
          driverName: drv?.name || drv?.fullName || d.driverId,
          team: tm?.name || d.team,
          x: s?.points || 0,
          y,
          label: drv?.abbreviation || drv?.lastName || d.driverId,
        });
      }

      const canvas = UI.el('canvas');
      const cWrap = UI.el('div', { class: 'chart-wrap tall' }, canvas);
      wrap.appendChild(cWrap);

      // Defer chart creation until canvas is in DOM.
      setTimeout(() => {
        new Chart(canvas, {
          type: 'scatter',
          data: {
            datasets: [{
              label: 'Drivers',
              data: points,
              parsing: false,
              pointRadius: 7,
              pointHoverRadius: 10,
              backgroundColor: points.map(p => DPI.scoreColor(p.y)),
              borderColor: '#0b0d10',
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const p = ctx.raw;
                    return `${p.driverName} (${p.team}): ${p.x} pts · DPI ${p.y.toFixed(1)}`;
                  },
                },
              },
            },
            scales: {
              x: { title: { display: true, text: 'Championship points', color: '#9aa3af' },
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' } },
              y: { title: { display: true, text: 'DPI (mean overall)', color: '#9aa3af' },
                   ticks: { color: '#9aa3af' }, grid: { color: '#2a313a' },
                   suggestedMin: 0, suggestedMax: 100 },
            },
          },
          plugins: [{
            id: 'driverLabels',
            afterDatasetsDraw(chart) {
              const { ctx } = chart;
              const meta = chart.getDatasetMeta(0);
              ctx.save();
              ctx.fillStyle = '#e6e9ee';
              ctx.font = '11px ui-monospace, monospace';
              for (let i = 0; i < meta.data.length; i++) {
                const pt = meta.data[i];
                const p = points[i];
                ctx.fillText(p.label, pt.x + 9, pt.y + 4);
              }
              ctx.restore();
            },
          }],
        });
      }, 10);

      return wrap;
    }
  },
};

window.SeasonsListView = SeasonsListView;
window.SeasonView = SeasonView;
