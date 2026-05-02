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

## DPI — the custom metric (v2)

**Hypothesis**: F1 qualifying time is dominated by car performance, so a
driver's true qualifying skill is the delta to their teammate (identical
machinery). Race results reflect the driver: position gained from grid to
finish, weighted because front-of-grid gains are exponentially harder.

**Base formulas (v1):**
```
QualiRating  = clamp(50 − Δ% × 25, 0, 100)
               Δ% = (t_driver − t_teammate) / t_teammate × 100
               (deepest qualifying session both drivers reached)

Racecraft    = clamp(50 + net × 25, 0, 100)
               net = Σ(1/k positions gained) − Σ(1/k positions lost)

Overall      = 0.40 × Quali + 0.60 × Racecraft
```

**v2 enrichments** (after critically reviewing v1 against mainstream F1
analytics — Elo, Bayesian decomposition, FastF1 community work):

1. **DNF-adjusted Racecraft** — re-ranks each driver's grid position among
   finishers only, so "free" gains from retirements ahead don't count.
2. **Sprint integration** — sprint races and sprint-quali count at 0.3 weight.
3. **Bayesian shrinkage** (`shrunkOverall`) — pulls aggregates toward 50
   with `k=10` so one-race wonders can't dominate.
4. **Best-75%** (`best75Overall`) — drops worst quartile of races, mutes
   unlucky weekends.
5. **Pit-stop counts** — exposed per driver per race for context.
6. **Teammate Elo** — qualifying H2H and race-finish H2H Elo (K=24, init
   1500), updated chronologically across all of F1 history. Solves the
   "beating Hamilton ≠ beating a rookie" problem.
7. **Ridge driver/car decomposition** (`DSC`) — per-season fit of
   `log(t / median) = α_driver + β_team + ε` with L2 regularisation.
   Driver coefficient α isolates skill from car effect; mapped to a 0–100
   score.

Full explainer with formulas at `#/dpi` in the running site.

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
pip install numpy scipy           # needed for ridge decomposition
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
