// Data layer for F1stats. Reads pre-baked JSON files under /data/.
//
// All historical F1 data (1950-2026) is preprocessed by scripts/build_data.py
// from the f1db open dataset. The web app reads these static files directly,
// so it works offline once cached and never needs an API key.

const DATA_BASE = 'data';

const cache = new Map();

async function loadJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(`${DATA_BASE}/${path}`).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  try { return await p; }
  catch (e) { cache.delete(path); throw e; }
}

const F1Data = {
  manifest: () => loadJSON('index.json'),
  drivers: () => loadJSON('drivers.json'),
  driverSearch: () => loadJSON('driver-search.json'),
  constructors: () => loadJSON('constructors.json'),
  grandsPrix: () => loadJSON('grands-prix.json'),
  circuits: () => loadJSON('circuits.json'),
  season: (year) => loadJSON(`seasons/${year}.json`),
  dpi: (year) => loadJSON(`dpi/${year}.json`),
  dpiAll: () => loadJSON('dpi/all.json'),

  // Build a driver lookup map (id -> driver record), cached.
  async driverMap() {
    if (cache.has('_driverMap')) return cache.get('_driverMap');
    const list = await this.drivers();
    const m = new Map(list.map(d => [d.id, d]));
    cache.set('_driverMap', m);
    return m;
  },

  async constructorMap() {
    if (cache.has('_constructorMap')) return cache.get('_constructorMap');
    const list = await this.constructors();
    const m = new Map(list.map(c => [c.id, c]));
    cache.set('_constructorMap', m);
    return m;
  },

  async grandPrixMap() {
    if (cache.has('_gpMap')) return cache.get('_gpMap');
    const list = await this.grandsPrix();
    const m = new Map(list.map(g => [g.id, g]));
    cache.set('_gpMap', m);
    return m;
  },

  async circuitMap() {
    if (cache.has('_circuitMap')) return cache.get('_circuitMap');
    const list = await this.circuits();
    const m = new Map(list.map(c => [c.id, c]));
    cache.set('_circuitMap', m);
    return m;
  },

  // Career results across seasons for a driver. Pulls each season file.
  async driverCareer(driverId) {
    const idx = await this.manifest();
    const all = [];
    // Filter by driver-seasons heuristic: load seasons where driver appears.
    // We scan all seasons (cached) and pull this driver's rows.
    for (const year of idx.years) {
      const s = await this.season(year);
      const races = [];
      for (const race of s.races) {
        const r = race.results.find(r => r.driverId === driverId);
        if (r) {
          races.push({ year, round: race.round, raceName: race.name,
                       date: race.date, grandPrixId: race.grandPrixId,
                       result: r,
                       quali: race.qualifying.find(q => q.driverId === driverId) || null });
        }
      }
      if (races.length) {
        all.push({ year,
                   races,
                   finalStanding: s.finalDriverStandings.find(d => d.driverId === driverId) || null });
      }
    }
    return all;
  },

  async constructorCareer(constructorId) {
    const idx = await this.manifest();
    const all = [];
    for (const year of idx.years) {
      const s = await this.season(year);
      const races = [];
      for (const race of s.races) {
        const teamResults = race.results.filter(r => r.constructorId === constructorId);
        if (teamResults.length) {
          races.push({ year, round: race.round, raceName: race.name, date: race.date,
                       grandPrixId: race.grandPrixId,
                       results: teamResults });
        }
      }
      if (races.length) {
        all.push({ year, races,
                   finalStanding: s.finalConstructorStandings.find(c => c.constructorId === constructorId) || null });
      }
    }
    return all;
  },
};

window.F1Data = F1Data;
