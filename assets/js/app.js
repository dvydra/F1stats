// Hash router + global search.
//
// Routes:
//   #/                                   -> Home
//   #/seasons                            -> Seasons list
//   #/season/:year                       -> Season detail
//   #/season/:year/race/:round           -> Race detail
//   #/drivers                            -> Drivers list
//   #/driver/:id                         -> Driver profile
//   #/constructors                       -> Constructors list
//   #/constructor/:id                    -> Constructor profile
//   #/compare                            -> Compare picker
//   #/compare/:a/:b                      -> Compare two drivers
//   #/dpi                                -> DPI explainer + seasons grid
//   #/dpi/:year                          -> DPI per-season leaderboard

const root = document.getElementById('app');

const routes = [
  { re: /^\/?$/, handler: () => HomeView.render(root) },
  { re: /^\/seasons\/?$/, handler: () => SeasonsListView.render(root) },
  { re: /^\/season\/(\d+)\/race\/(\d+)\/?$/, handler: (m) => RaceView.render(root, m[1], m[2]) },
  { re: /^\/season\/(\d+)\/?$/, handler: (m) => SeasonView.render(root, m[1]) },
  { re: /^\/drivers\/?$/, handler: () => DriversListView.render(root) },
  { re: /^\/driver\/([^\/]+)\/?$/, handler: (m) => DriverView.render(root, m[1]) },
  { re: /^\/constructors\/?$/, handler: () => ConstructorsListView.render(root) },
  { re: /^\/constructor\/([^\/]+)\/?$/, handler: (m) => ConstructorView.render(root, m[1]) },
  { re: /^\/compare\/([^\/]+)\/([^\/]+)\/?$/, handler: (m) => CompareView.render(root, { a: m[1], b: m[2] }) },
  { re: /^\/compare\/?$/, handler: () => CompareView.render(root) },
  { re: /^\/dpi\/(\d+)\/?$/, handler: (m) => DPISeasonView.render(root, m[1]) },
  { re: /^\/dpi\/?$/, handler: () => DPIExplainView.render(root) },
];

function dispatch() {
  const hash = location.hash.replace(/^#/, '') || '/';
  for (const r of routes) {
    const m = r.re.exec(hash);
    if (m) {
      window.scrollTo(0, 0);
      r.handler(m);
      highlightNav(hash);
      return;
    }
  }
  root.replaceChildren(UI.errorBox(`No route matched ${hash}`));
}

function highlightNav(hash) {
  const links = document.querySelectorAll('.primary-nav a');
  links.forEach(a => {
    const route = a.dataset.route;
    let active = false;
    if (route === 'home') active = hash === '/' || hash === '';
    else if (route === 'seasons') active = hash.startsWith('/seasons') || hash.startsWith('/season/');
    else if (route === 'drivers') active = hash.startsWith('/drivers') || hash.startsWith('/driver/');
    else if (route === 'constructors') active = hash.startsWith('/constructors') || hash.startsWith('/constructor/');
    else if (route === 'compare') active = hash.startsWith('/compare');
    a.classList.toggle('active', active);
  });
}

window.addEventListener('hashchange', dispatch);
window.addEventListener('DOMContentLoaded', initSearch);
window.addEventListener('DOMContentLoaded', dispatch);

// ---- Global search ----

let searchIndex = null;
async function buildSearchIndex() {
  if (searchIndex) return searchIndex;
  const [drivers, constructors] = await Promise.all([
    F1Data.drivers(), F1Data.constructors(),
  ]);
  searchIndex = {
    drivers: drivers.map(d => ({
      id: d.id,
      name: d.fullName || d.name,
      starts: d.totalRaceStarts || 0,
      hay: ((d.fullName || '') + ' ' + (d.name || '') + ' ' + (d.firstName || '') + ' ' + (d.lastName || '') + ' ' + (d.abbreviation || '')).toLowerCase(),
    })),
    constructors: constructors.map(c => ({
      id: c.id,
      name: c.fullName || c.name,
      wins: c.totalRaceWins || 0,
      hay: ((c.fullName || '') + ' ' + (c.name || '')).toLowerCase(),
    })),
  };
  return searchIndex;
}

function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (!form || !input || !results) return;

  let blurT;
  input.addEventListener('focus', () => {
    clearTimeout(blurT);
    if (input.value.trim()) results.hidden = false;
    buildSearchIndex();
  });
  input.addEventListener('blur', () => {
    blurT = setTimeout(() => { results.hidden = true; }, 150);
  });
  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.hidden = true; UI.clearChildren(results); return; }
    const idx = await buildSearchIndex();
    const dr = idx.drivers
      .filter(d => d.hay.includes(q))
      .sort((a, b) => b.starts - a.starts)
      .slice(0, 8);
    const cs = idx.constructors
      .filter(c => c.hay.includes(q))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 5);
    UI.clearChildren(results);
    if (dr.length) {
      results.appendChild(UI.el('div', { class: 'group-label' }, 'Drivers'));
      for (const d of dr) {
        results.appendChild(UI.el('a', { href: `#/driver/${d.id}`,
          onclick: () => { results.hidden = true; input.value = ''; } },
          d.name + (d.starts ? ` · ${d.starts} starts` : '')));
      }
    }
    if (cs.length) {
      results.appendChild(UI.el('div', { class: 'group-label' }, 'Teams'));
      for (const c of cs) {
        results.appendChild(UI.el('a', { href: `#/constructor/${c.id}`,
          onclick: () => { results.hidden = true; input.value = ''; } }, c.name));
      }
    }
    if (!dr.length && !cs.length) {
      results.appendChild(UI.el('div', { style: 'padding:10px 12px;color:var(--text-dim);' }, 'No matches.'));
    }
    results.hidden = false;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const first = results.querySelector('a');
    if (first) { location.hash = first.getAttribute('href'); results.hidden = true; input.value = ''; }
  });
}
