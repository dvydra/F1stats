# F1 Stats

A browsable Formula 1 stats site covering every season, race, driver and team
from 1950 to today — with a custom **Driver Performance Index (DPI)** that
attempts to isolate driver skill from car performance.

The whole thing is a static site: HTML, CSS, vanilla JS, and pre-baked JSON.
No build step, no server, no API key. Just open `index.html`.

## Features

- **Every season, race, driver, constructor** — full historical data baked in.
- **Race detail**: results, qualifying, position-change bar chart, DPI breakdown.
- **Driver profile**: career stats, season trajectory, **points-vs-DPI chart**.
- **Constructor profile**: season points history, all drivers ever fielded.
- **Head-to-head compare**: any two drivers, lifetime stats + season overlays
  for both points and DPI.
- **DPI leaderboard**: per-season ranking, plus an all-time leaderboard
  filtered to ≥50 races.
- **Global search** across drivers and teams.

## DPI — the custom metric

Hypothesis: F1 qualifying time is dominated by car performance, so a driver's
true qualifying skill is the delta to their teammate (identical machinery).
Race results, on the other hand, reflect the driver: position gained from grid
to finish.

```
Quali Rating  = clamp(50 - delta_pct * 25, 0, 100)
                delta_pct = (t_driver - t_teammate) / t_teammate * 100
                (deepest qualifying session both drivers reached)

Racecraft     = clamp(50 + net * 25, 0, 100)
                net = Σ(1/k for k in positions_gained)
                    - Σ(1/k for k in positions_lost)
                Front positions weighted more — gaining P3→P1 = 1.5
                vs P19→P18 = 0.056.

Overall       = 0.40 × Quali + 0.60 × Racecraft
```

Edge cases:
- **Mechanical DNF** → race excluded from racecraft (driver kept the quali credit).
- **Driver-fault DNF** (collision/accident) → racecraft = 0.
- **No teammate or no qualifying time** that weekend → quali excluded.
- **Pit-lane start (grid 0)** → treated as P20 for weighting.

Full explainer at `#/dpi` in the running site.

## Data

All data comes from [f1db](https://github.com/f1db/f1db) (CC BY 4.0), which
mirrors the Ergast/F1API records back to 1950. The release artefact
`f1db-json-splitted.zip` is downloaded once and preprocessed by
`scripts/build_data.py` into:

```
data/index.json              -- manifest (years, last race, dataset version)
data/drivers.json            -- slim driver lookup
data/constructors.json       -- slim constructor lookup
data/grands-prix.json
data/circuits.json
data/seasons/YYYY.json       -- per-season races + results + qualifying
data/dpi/YYYY.json           -- per-season DPI scores
data/dpi/all.json            -- all-time DPI summary across seasons
```

77 seasons, ~26 MB on disk — gzips to ~3 MB on the wire.

To rebuild:

```bash
mkdir -p data/raw && cd data/raw
curl -sSLO https://github.com/f1db/f1db/releases/download/v2026.3.0/f1db-json-splitted.zip
unzip -o f1db-json-splitted.zip && cd ../..
python3 scripts/build_data.py
```

(`data/raw/` is gitignored — only the slim per-season files are committed.)

## Run locally

```bash
python3 -m http.server 8000
open http://127.0.0.1:8000/
```

That's it. The site is just static files.

## Project layout

```
index.html                   -- app shell
assets/css/style.css         -- single stylesheet
assets/js/util.js            -- DOM helpers
assets/js/dpi.js             -- DPI display helpers
assets/js/api.js             -- data layer (reads /data/*.json)
assets/js/app.js             -- hash router + global search
assets/js/views/             -- one file per view
  home.js
  seasons.js                 -- seasons list + per-season detail
  race.js                    -- race detail with charts
  driver.js                  -- driver profile + drivers list
  constructor.js             -- constructor profile + list
  compare.js                 -- head-to-head two drivers
  dpi.js                     -- DPI explainer + per-season leaderboard
scripts/build_data.py        -- preprocesses f1db dump into baked JSON
data/                        -- baked output (committed)
```

## Routes

```
#/                                   Home
#/seasons                            Season grid
#/season/:year                       Season standings + schedule + DPI scatter
#/season/:year/race/:round           Race detail
#/drivers                            Driver list
#/driver/:id                         Driver profile (career + DPI chart)
#/constructors                       Team list
#/constructor/:id                    Team profile
#/compare                            Compare picker
#/compare/:driverA/:driverB          Head-to-head
#/dpi                                DPI explainer + all-time leaderboard
#/dpi/:year                          Per-season DPI
```
