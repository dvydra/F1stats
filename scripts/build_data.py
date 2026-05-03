#!/usr/bin/env python3
"""
F1stats data preprocessor — DPI v2.

Reads the f1db JSON-splitted release in data/raw/ and produces lean per-season
files plus a battery of advanced metrics:

  - Classic DPI (Quali + Racecraft)            ← v1
  - DNF-adjusted Racecraft                     ← v2 enrichment
  - Sprint-race contribution at 0.3 weight     ← v2 enrichment
  - Best-75% aggregate (drops worst quartile)  ← v2 enrichment
  - Bayesian shrinkage of season aggregates    ← v2 enrichment
  - Pit-stop counts per driver per race        ← v2 enrichment
  - Elo ratings (qualifying H2H, race H2H)     ← v2 enrichment
  - Bayesian/Ridge driver-skill decomposition  ← v2 enrichment

Outputs:
  data/index.json
  data/drivers.json
  data/constructors.json
  data/grands-prix.json
  data/circuits.json
  data/seasons/YYYY.json     (race results, qualifying, sprints, pit stops)
  data/dpi/YYYY.json         (per-driver per-race DPI breakdown)
  data/dpi/all.json          (career DPI, Elo, DSC — all in one file)
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix, lil_matrix

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
SEASONS_DIR = OUT / "seasons"
DPI_DIR = OUT / "dpi"

# ── DPI weights ────────────────────────────────────────────────────────────
# v3: re-balanced after the v2 leaderboard exposed a weighting flaw.
# Bearman (in a Haas) was scoring above championship-winning Norris because
# repeated P20→P10 grid recoveries summed to roughly the same weighted credit
# as P3→P1 wins. The fix: replace the 1/k position weighting with the F1
# points scale (so front gains dominate), and add an absolute Finish term so
# the metric is anchored to where you actually ended the race.
QUALI_WEIGHT = 0.30
RACECRAFT_WEIGHT = 0.40
FINISH_WEIGHT = 0.30
QUALI_SCALE = 25
RACECRAFT_SCALE = 2.5     # each F1-point of value gained moves score 2.5
SPRINT_WEIGHT = 0.30      # each sprint counts as 0.3 of a race in aggregates
SHRINK_K = 10             # Bayesian shrinkage strength toward prior 50

# F1 modern (2010+) points scale — used as the position-value function across
# all eras for consistency. v(p)=0 for p>10. Pit-lane / DNS treated as P20.
F1_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}


def points_value(p):
    """F1 points value for a finishing/grid position. 0 for outside top 10."""
    if not p or p < 1:
        return 0
    return F1_POINTS.get(int(p), 0)

# ── Elo parameters ─────────────────────────────────────────────────────────
ELO_INIT = 1500.0
ELO_K = 24

DRIVER_FAULT = {"collision", "accident", "spun off", "spin", "crash", "damage",
                "off track", "driver error"}


def load(name):
    with open(RAW / name) as f:
        return json.load(f)


def classify_status(reason):
    if not reason:
        return "finished"
    r = reason.lower()
    if "+" in r and "lap" in r:
        return "finished"
    for kw in DRIVER_FAULT:
        if kw in r:
            return "driver_fault"
    return "mechanical"


def is_finisher(reason):
    return classify_status(reason) == "finished"


def deepest_common_millis(a, b):
    """Returns (session_label, ms_a, ms_b) for deepest common quali session."""
    for key, mkey in [("q3", "q3Millis"), ("q2", "q2Millis"), ("q1", "q1Millis")]:
        if a.get(mkey) and b.get(mkey):
            return key.upper(), a[mkey], b[mkey]
    if a.get("timeMillis") and b.get("timeMillis"):
        return "Q", a["timeMillis"], b["timeMillis"]
    return None


def best_quali_millis(q):
    """Driver's best (lowest) quali time across sessions."""
    for k in ("q3Millis", "q2Millis", "q1Millis", "timeMillis"):
        v = q.get(k)
        if v:
            return v
    return None


def points_gain(grid, finish):
    """Net F1-points value gained from grid to finish. Negative = lost value.
    A points-based replacement for the v1/v2 1/k weighted gain. P3→P1 yields
    +10 (15→25), P20→P10 yields +1 (0→1). This stops back-of-grid grinding
    from out-scoring race winners."""
    if not grid or not finish:
        return 0.0
    return points_value(finish) - points_value(grid)


def finish_score(finish, kind):
    """Absolute-result anchor: how well you ended the race regardless of grid.
    Linear from P1=100 down to P20=5; mechanical DNF excluded (None);
    driver-fault DNF = 0."""
    if kind == "mechanical":
        return None
    if kind == "driver_fault":
        return 0.0
    if not finish:
        return None
    return clamp(100 * (21 - int(finish)) / 20, 0, 100)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def shrink(observed, n, k=SHRINK_K, prior=50.0):
    if observed is None or n <= 0:
        return None
    return (n * observed + k * prior) / (n + k)


def best_75_mean(values):
    """Mean after dropping the worst 25% of values."""
    if not values:
        return None
    s = sorted(values)
    cutoff = max(1, int(math.ceil(len(s) * 0.75)))
    keep = s[-cutoff:]  # keep the top 75% (best scores)
    return sum(keep) / len(keep)


# ── Elo machinery ─────────────────────────────────────────────────────────

class EloLedger:
    """Pairwise teammate-only Elo updated chronologically across all of F1."""

    def __init__(self):
        self.r = defaultdict(lambda: ELO_INIT)
        self.history = defaultdict(list)  # driverId -> [(date, rating)]

    def update_pair(self, a, b, a_won, k=ELO_K, date=None):
        ra, rb = self.r[a], self.r[b]
        ea = 1.0 / (1.0 + 10 ** ((rb - ra) / 400))
        sa = 1.0 if a_won else 0.0
        self.r[a] = ra + k * (sa - ea)
        self.r[b] = rb + k * ((1 - sa) - (1 - ea))
        if date:
            self.history[a].append((date, self.r[a]))
            self.history[b].append((date, self.r[b]))


# ── Bayesian / Ridge driver-skill decomposition (DSC) ─────────────────────

def decompose_season_quali(season_quali_by_race, lam=0.05):
    """
    Fit relative log-time = α_driver + β_team + ε per season, ridge-regularized.
    Returns {driver_id: alpha, team_id: beta, n: rows}. Negative alpha = faster.
    """
    obs = []  # (driverId, teamId, log(time/median))
    for race_id, qlist in season_quali_by_race.items():
        # Use deepest available session per driver, but normalise to within-race
        # median, so we control for track evolution within that race weekend.
        rec = []
        for q in qlist:
            t = best_quali_millis(q)
            if t and t > 0:
                rec.append((q["driverId"], q["constructorId"], t))
        if len(rec) < 4:
            continue
        med = float(np.median([r[2] for r in rec]))
        for d, tm, t in rec:
            obs.append((d, tm, math.log(t / med)))
    if not obs:
        return {"drivers": {}, "teams": {}, "n": 0}

    drivers = sorted({o[0] for o in obs})
    teams = sorted({o[1] for o in obs})
    di = {d: i for i, d in enumerate(drivers)}
    ti = {t: i + len(drivers) for i, t in enumerate(teams)}
    n_params = len(drivers) + len(teams)

    X = lil_matrix((len(obs), n_params))
    y = np.zeros(len(obs))
    for i, (d, tm, rt) in enumerate(obs):
        X[i, di[d]] = 1.0
        X[i, ti[tm]] = 1.0
        y[i] = rt
    X = csr_matrix(X)
    XtX = (X.T @ X).toarray() + lam * np.eye(n_params)
    Xty = X.T @ y
    try:
        beta = np.linalg.solve(XtX, Xty)
    except np.linalg.LinAlgError:
        beta = np.linalg.lstsq(XtX, Xty, rcond=None)[0]

    return {
        "drivers": {d: float(beta[di[d]]) for d in drivers},
        "teams":   {t: float(beta[ti[t]]) for t in teams},
        "n": len(obs),
    }


def dsc_to_score(alpha):
    """Convert log-time driver effect to a 0-100 score. Negative α = faster."""
    if alpha is None:
        return None
    # 1% faster (α ≈ -0.01) ≈ +25; 1% slower ≈ -25; centred at 50.
    return clamp(50 - alpha * 2500, 0, 100)


# ── Per-race DPI computation (v2) ─────────────────────────────────────────

def compute_race_dpi(race_results, race_quali, race_pit_counts, *,
                     sprint=False):
    """
    Returns list of per-driver entries with v2 fields:
      qualiDelta, qualiSession, qualiRating
      grid, finish, status, statusKind, points, pitStops
      netGain (raw), netGainAdj (DNF-adjusted)
      racecraft (raw), racecraftAdj
      overall (raw), overallAdj
    Also returns the list of finisher driverIds for upstream use.
    """
    by_team = defaultdict(list)
    for r in race_results:
        by_team[r["constructorId"]].append(r)
    quali_by_driver = {q["driverId"]: q for q in race_quali}

    finishers = {r["driverId"] for r in race_results if is_finisher(r.get("reasonRetired"))}

    # Adjusted grid — rank among finishers from grid order. Non-finishers get None.
    finishers_grid_sorted = sorted(
        [r for r in race_results if r["driverId"] in finishers
         and r.get("gridPositionNumber")],
        key=lambda r: r["gridPositionNumber"])
    adj_grid_of = {}
    for i, r in enumerate(finishers_grid_sorted, 1):
        adj_grid_of[r["driverId"]] = i

    entries = []
    for r in race_results:
        did = r["driverId"]
        team = r["constructorId"]
        grid = r.get("gridPositionNumber")
        finish = r.get("positionNumber")
        status = r.get("reasonRetired") or "Finished"
        kind = classify_status(r.get("reasonRetired"))
        points = r.get("points") or 0
        pit_stops = race_pit_counts.get(did, 0)

        # Quali sub-score
        quali_rating = quali_delta = quali_session = None
        mate = [t for t in by_team[team] if t["driverId"] != did]
        my_q = quali_by_driver.get(did)
        if my_q and len(mate) == 1 and mate[0]["driverId"] in quali_by_driver:
            tm_q = quali_by_driver[mate[0]["driverId"]]
            sess = deepest_common_millis(my_q, tm_q)
            if sess:
                sname, ta, tb = sess
                quali_delta = (ta - tb) / tb * 100
                quali_session = sname
                quali_rating = clamp(50 - quali_delta * QUALI_SCALE, 0, 100)

        # Racecraft (raw and DNF-adjusted) — points-weighted
        racecraft = racecraft_adj = None
        net_gain = net_gain_adj = None
        if kind == "mechanical":
            pass  # excluded
        elif kind == "driver_fault":
            racecraft = racecraft_adj = 0.0
        elif grid and finish:
            eg = 20 if grid == 0 else grid
            net_gain = points_gain(eg, finish)
            racecraft = clamp(50 + net_gain * RACECRAFT_SCALE, 0, 100)
            adj_g = adj_grid_of.get(did)
            adj_f = None
            if did in finishers:
                fin_sorted = sorted(
                    [x for x in race_results if x["driverId"] in finishers
                     and x.get("positionNumber")],
                    key=lambda x: x["positionNumber"])
                for j, x in enumerate(fin_sorted, 1):
                    if x["driverId"] == did:
                        adj_f = j
                        break
            if adj_g and adj_f:
                net_gain_adj = points_gain(adj_g, adj_f)
                racecraft_adj = clamp(50 + net_gain_adj * RACECRAFT_SCALE, 0, 100)
            else:
                net_gain_adj = net_gain
                racecraft_adj = racecraft

        # Absolute Finish anchor (new in v3)
        finish_rating = finish_score(finish, kind)

        def combine(q, r, fin):
            parts, weights = [], []
            if q is not None: parts.append(q); weights.append(QUALI_WEIGHT)
            if r is not None: parts.append(r); weights.append(RACECRAFT_WEIGHT)
            if fin is not None: parts.append(fin); weights.append(FINISH_WEIGHT)
            if not parts: return None
            wsum = sum(weights)
            return sum(p * w for p, w in zip(parts, weights)) / wsum

        overall = combine(quali_rating, racecraft, finish_rating)
        overall_adj = combine(quali_rating, racecraft_adj, finish_rating)

        entries.append({
            "driverId": did,
            "team": team,
            "grid": grid,
            "finish": finish,
            "status": status,
            "statusKind": kind,
            "points": points,
            "pitStops": pit_stops,
            "qualiDelta": round(quali_delta, 4) if quali_delta is not None else None,
            "qualiSession": quali_session,
            "qualiRating": round(quali_rating, 2) if quali_rating is not None else None,
            "netGain": round(net_gain, 4) if net_gain is not None else None,
            "netGainAdj": round(net_gain_adj, 4) if net_gain_adj is not None else None,
            "racecraft": round(racecraft, 2) if racecraft is not None else None,
            "racecraftAdj": round(racecraft_adj, 2) if racecraft_adj is not None else None,
            "finishRating": round(finish_rating, 2) if finish_rating is not None else None,
            "overall": round(overall, 2) if overall is not None else None,
            "overallAdj": round(overall_adj, 2) if overall_adj is not None else None,
            "isSprint": sprint,
            "weight": SPRINT_WEIGHT if sprint else 1.0,
        })
    return entries


# ── Build pipeline ─────────────────────────────────────────────────────────

def main():
    SEASONS_DIR.mkdir(parents=True, exist_ok=True)
    DPI_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading f1db source files…")
    races = load("f1db-races.json")
    rr = load("f1db-races-race-results.json")
    qr = load("f1db-races-qualifying-results.json")
    sr = load("f1db-races-sprint-race-results.json")
    sq = load("f1db-races-sprint-qualifying-results.json")
    sg = load("f1db-races-sprint-starting-grid-positions.json")
    pit = load("f1db-races-pit-stops.json")
    fl = load("f1db-races-fastest-laps.json")
    drivers = load("f1db-drivers.json")
    constructors = load("f1db-constructors.json")
    gps = load("f1db-grands-prix.json")
    circuits = load("f1db-circuits.json")
    drv_st = load("f1db-races-driver-standings.json")
    cst_st = load("f1db-races-constructor-standings.json")
    season_drv_st = load("f1db-seasons-driver-standings.json")
    season_cst_st = load("f1db-seasons-constructor-standings.json")

    # Indexes
    race_by_id = {r["id"]: r for r in races}
    results_by_race = defaultdict(list)
    quali_by_race = defaultdict(list)
    sprint_results_by_race = defaultdict(list)
    sprint_quali_by_race = defaultdict(list)
    sprint_grid_by_race = defaultdict(list)
    pit_count_by_race_driver = defaultdict(lambda: defaultdict(int))
    drv_st_by_race = defaultdict(list)
    cst_st_by_race = defaultdict(list)
    season_drv_by_year = defaultdict(list)
    season_cst_by_year = defaultdict(list)
    fl_by_race = defaultdict(list)

    for r in rr: results_by_race[r["raceId"]].append(r)
    for q in qr: quali_by_race[q["raceId"]].append(q)
    for r in sr: sprint_results_by_race[r["raceId"]].append(r)
    for q in sq: sprint_quali_by_race[q["raceId"]].append(q)
    for g in sg: sprint_grid_by_race[g["raceId"]].append(g)
    for p in pit: pit_count_by_race_driver[p["raceId"]][p["driverId"]] += 1
    for s in drv_st: drv_st_by_race[s["raceId"]].append(s)
    for s in cst_st: cst_st_by_race[s["raceId"]].append(s)
    for s in season_drv_st: season_drv_by_year[s["year"]].append(s)
    for s in season_cst_st: season_cst_by_year[s["year"]].append(s)
    for f in fl: fl_by_race[f["raceId"]].append(f)

    # Slim driver / constructor / GP / circuit lookups
    print("Writing slim lookups…")
    slim_drivers = [{
        "id": d["id"], "name": d.get("name") or d.get("fullName"),
        "fullName": d.get("fullName"), "firstName": d.get("firstName"),
        "lastName": d.get("lastName"), "abbreviation": d.get("abbreviation"),
        "nationality": d.get("nationalityCountryId"),
        "permanentNumber": d.get("permanentNumber"),
        "dateOfBirth": d.get("dateOfBirth"),
        "totalPoints": d.get("totalPoints"),
        "totalRaceWins": d.get("totalRaceWins"),
        "totalPodiums": d.get("totalPodiums"),
        "totalPolePositions": d.get("totalPolePositions"),
        "totalRaceStarts": d.get("totalRaceStarts"),
        "totalChampionshipWins": d.get("totalChampionshipWins"),
        "bestChampionshipPosition": d.get("bestChampionshipPosition"),
    } for d in drivers]
    with open(OUT / "drivers.json", "w") as f:
        json.dump(slim_drivers, f, separators=(",", ":"))

    slim_constructors = [{
        "id": c["id"], "name": c.get("name"), "fullName": c.get("fullName"),
        "country": c.get("countryId"), "totalPoints": c.get("totalPoints"),
        "totalRaceWins": c.get("totalRaceWins"), "totalPodiums": c.get("totalPodiums"),
        "totalPolePositions": c.get("totalPolePositions"),
        "totalChampionshipWins": c.get("totalChampionshipWins"),
        "totalRaceEntries": c.get("totalRaceEntries"),
        "totalRaceStarts": c.get("totalRaceStarts"),
        "bestChampionshipPosition": c.get("bestChampionshipPosition"),
    } for c in constructors]
    with open(OUT / "constructors.json", "w") as f:
        json.dump(slim_constructors, f, separators=(",", ":"))

    # Search index — name + team + year tokens for compare-picker autocomplete.
    # Also includes career mean championship position for the all-time table.
    race_year_by_id = {r["id"]: r["year"] for r in races}
    driver_years = defaultdict(set)
    driver_team_ids = defaultdict(set)
    for entries in (rr, sr):
        for e in entries:
            did = e.get("driverId")
            y = race_year_by_id.get(e.get("raceId"))
            if not did or not y: continue
            driver_years[did].add(y)
            cid = e.get("constructorId")
            if cid: driver_team_ids[did].add(cid)
    driver_champ_positions = defaultdict(list)
    for s in season_drv_st:
        did = s.get("driverId")
        pos = s.get("positionNumber")
        if did and pos is not None:
            driver_champ_positions[did].append(pos)
    # DNF tally: any race entry whose reasonRetired is set counts as a DNF.
    driver_dnf = defaultdict(lambda: {"starts": 0, "dnf": 0})
    for r in rr:
        did = r.get("driverId")
        if not did: continue
        driver_dnf[did]["starts"] += 1
        if r.get("reasonRetired"):
            driver_dnf[did]["dnf"] += 1
    cname = {c["id"]: c.get("name") for c in slim_constructors}
    search_index = []
    for d in slim_drivers:
        cps = driver_champ_positions.get(d["id"], [])
        avg_champ = round(sum(cps) / len(cps), 2) if cps else None
        dn = driver_dnf.get(d["id"], {"starts": 0, "dnf": 0})
        dpct = (100 * dn["dnf"] / dn["starts"]) if dn["starts"] else None
        search_index.append({
            "id": d["id"],
            "name": d.get("fullName") or d.get("name"),
            "abbr": d.get("abbreviation"),
            "nat": d.get("nationality"),
            "starts": d.get("totalRaceStarts") or 0,
            "wins": d.get("totalRaceWins") or 0,
            "years": sorted(driver_years.get(d["id"], [])),
            "teamIds": sorted(driver_team_ids.get(d["id"], [])),
            "teams": [cname.get(t, t) for t in sorted(driver_team_ids.get(d["id"], []))],
            "avgChampPos": avg_champ,
            "champSeasons": len(cps),
            "dnf": dn["dnf"],
            "dnfPct": round(dpct, 2) if dpct is not None else None,
        })
    with open(OUT / "driver-search.json", "w") as f:
        json.dump(search_index, f, separators=(",", ":"), ensure_ascii=False)

    # Constructor search index — drives the all-time teams leaderboard.
    team_years = defaultdict(set)
    for entries in (rr, sr):
        for e in entries:
            cid = e.get("constructorId")
            y = race_year_by_id.get(e.get("raceId"))
            if cid and y: team_years[cid].add(y)
    team_champ_pos = defaultdict(list)
    for s in season_cst_st:
        cid = s.get("constructorId")
        pos = s.get("positionNumber")
        if cid and pos is not None:
            team_champ_pos[cid].append(pos)
    cstr_search = []
    for c in slim_constructors:
        yrs = sorted(team_years.get(c["id"], []))
        cps = team_champ_pos.get(c["id"], [])
        avg = round(sum(cps) / len(cps), 2) if cps else None
        cstr_search.append({
            "id": c["id"],
            "name": c.get("name") or c.get("fullName"),
            "country": c.get("country"),
            "firstYear": yrs[0] if yrs else None,
            "lastYear": yrs[-1] if yrs else None,
            "seasons": len(yrs),
            "totalRaceStarts": c.get("totalRaceStarts") or 0,
            "totalRaceEntries": c.get("totalRaceEntries") or 0,
            "totalRaceWins": c.get("totalRaceWins") or 0,
            "totalPodiums": c.get("totalPodiums") or 0,
            "totalPolePositions": c.get("totalPolePositions") or 0,
            "totalChampionshipWins": c.get("totalChampionshipWins") or 0,
            "bestChampionshipPosition": c.get("bestChampionshipPosition"),
            "totalPoints": c.get("totalPoints") or 0,
            "avgChampPos": avg,
            "champSeasons": len(cps),
        })
    with open(OUT / "constructor-search.json", "w") as f:
        json.dump(cstr_search, f, separators=(",", ":"), ensure_ascii=False)

    # Country leaderboard — wins, podiums, home wins (driver nationality
    # matches the circuit's country), driver/constructor titles.
    drv_nat = {d["id"]: d.get("nationality") for d in slim_drivers}
    cons_nat = {c["id"]: c.get("country") for c in slim_constructors}
    circ_country = {c["id"]: c.get("countryId") for c in circuits}
    race_circuit = {r["id"]: r.get("circuitId") for r in races}
    race_gp = {r["id"]: r.get("grandPrixId") for r in races}

    cagg = defaultdict(lambda: {
        "drivers": set(), "constructors": set(),
        "starts": 0, "wins": 0, "podiums": 0, "poles": 0, "fastestLaps": 0,
        "homeWins": 0, "homePodiums": 0,
        "driverTitles": 0, "constructorTitles": 0,
        "raceHosts": set(),
    })
    for d in slim_drivers:
        nat = d.get("nationality")
        if nat and (d.get("totalRaceStarts") or 0) > 0:
            cagg[nat]["drivers"].add(d["id"])
            cagg[nat]["driverTitles"] += d.get("totalChampionshipWins") or 0
    for c in slim_constructors:
        cn = c.get("country")
        if cn and (c.get("totalRaceStarts") or 0) > 0:
            cagg[cn]["constructors"].add(c["id"])
            cagg[cn]["constructorTitles"] += c.get("totalChampionshipWins") or 0
    for race in races:
        rid = race["id"]
        cc = circ_country.get(race.get("circuitId"))
        if cc: cagg[cc]["raceHosts"].add(race.get("grandPrixId") or rid)
        for r in results_by_race.get(rid, []):
            nat = drv_nat.get(r.get("driverId"))
            if not nat: continue
            cagg[nat]["starts"] += 1
            pos = r.get("positionNumber")
            if pos == 1: cagg[nat]["wins"] += 1
            if pos and pos <= 3: cagg[nat]["podiums"] += 1
            if r.get("polePosition"): cagg[nat]["poles"] += 1
            if r.get("fastestLap"): cagg[nat]["fastestLaps"] += 1
            if cc == nat:
                if pos == 1: cagg[nat]["homeWins"] += 1
                if pos and pos <= 3: cagg[nat]["homePodiums"] += 1
        for r in sprint_results_by_race.get(rid, []):
            nat = drv_nat.get(r.get("driverId"))
            if not nat: continue
            pos = r.get("positionNumber")
            if pos == 1: cagg[nat]["wins"] += 1
            if pos and pos <= 3: cagg[nat]["podiums"] += 1
            if cc == nat:
                if pos == 1: cagg[nat]["homeWins"] += 1
                if pos and pos <= 3: cagg[nat]["homePodiums"] += 1

    countries_out = []
    for slug, a in cagg.items():
        if not a["drivers"] and not a["constructors"]: continue
        countries_out.append({
            "id": slug,
            "drivers": len(a["drivers"]), "constructors": len(a["constructors"]),
            "starts": a["starts"], "wins": a["wins"], "podiums": a["podiums"],
            "poles": a["poles"], "fastestLaps": a["fastestLaps"],
            "homeWins": a["homeWins"], "homePodiums": a["homePodiums"],
            "driverTitles": a["driverTitles"],
            "constructorTitles": a["constructorTitles"],
            "raceHosts": len(a["raceHosts"]),
        })
    countries_out.sort(key=lambda x: -x["wins"])
    with open(OUT / "countries.json", "w") as f:
        json.dump(countries_out, f, separators=(",", ":"), ensure_ascii=False)

    with open(OUT / "grands-prix.json", "w") as f:
        json.dump([{"id": g["id"], "name": g.get("name"),
                    "fullName": g.get("fullName"), "country": g.get("countryId")}
                   for g in gps], f, separators=(",", ":"))
    with open(OUT / "circuits.json", "w") as f:
        json.dump([{"id": c["id"], "name": c.get("name"),
                    "fullName": c.get("fullName"), "country": c.get("countryId"),
                    "type": c.get("type"), "lat": c.get("latitude"),
                    "lng": c.get("longitude")} for c in circuits],
                  f, separators=(",", ":"))

    # ── Pass 1: Elo across all of history ──
    print("Computing Elo timeline (chronological)…")
    quali_elo = EloLedger()
    race_elo = EloLedger()
    races_chrono = sorted(races, key=lambda r: (r.get("date") or "0000-00-00", r["round"]))

    def elo_pairwise_quali(q_list, date_str):
        by_team = defaultdict(list)
        for q in q_list: by_team[q["constructorId"]].append(q)
        for t, mates in by_team.items():
            if len(mates) != 2: continue
            a, b = mates
            ta = best_quali_millis(a); tb = best_quali_millis(b)
            if not ta or not tb: continue
            quali_elo.update_pair(a["driverId"], b["driverId"], ta < tb, date=date_str)

    def elo_pairwise_race(r_list, date_str):
        by_team = defaultdict(list)
        for r in r_list: by_team[r["constructorId"]].append(r)
        for t, mates in by_team.items():
            if len(mates) != 2: continue
            a, b = mates
            af = is_finisher(a.get("reasonRetired"))
            bf = is_finisher(b.get("reasonRetired"))
            if not (af and bf): continue
            pa = a.get("positionNumber"); pb = b.get("positionNumber")
            if not pa or not pb: continue
            race_elo.update_pair(a["driverId"], b["driverId"], pa < pb, date=date_str)

    for race in races_chrono:
        rid = race["id"]; date = race.get("date") or ""
        if quali_by_race.get(rid):
            elo_pairwise_quali(quali_by_race[rid], date)
        if sprint_quali_by_race.get(rid):
            elo_pairwise_quali(sprint_quali_by_race[rid], date)
        if results_by_race.get(rid):
            elo_pairwise_race(results_by_race[rid], date)
        if sprint_results_by_race.get(rid):
            elo_pairwise_race(sprint_results_by_race[rid], date)

    print(f"  Final qualiElo entries: {len(quali_elo.r)}; raceElo: {len(race_elo.r)}")

    # ── Pass 2: per-season slim files + DPI v2 + DSC ──
    by_year = defaultdict(list)
    for r in races: by_year[r["year"]].append(r)
    years = sorted(by_year.keys())
    last_year = years[-1]

    season_dsc_drivers = {}  # year -> {driverId: alpha}
    season_dsc_teams = {}    # year -> {teamId: beta}
    season_aggregates = {}   # year -> [aggregate dicts]
    season_max_points_by_year = {}  # year -> int (era-aware ceiling)
    season_rounds_by_year = {}      # year -> {completed, scheduled}

    for year in years:
        season_races = sorted(by_year[year], key=lambda r: r["round"])

        # Slim season payload
        race_payload = []
        for race in season_races:
            results = sorted(results_by_race.get(race["id"], []),
                             key=lambda r: r.get("positionDisplayOrder", 9999))
            slim_results = [{
                "driverId": r["driverId"], "constructorId": r["constructorId"],
                "engineId": r.get("engineManufacturerId"),
                "number": r.get("driverNumber"),
                "position": r.get("positionNumber"),
                "positionText": r.get("positionText"),
                "grid": r.get("gridPositionNumber"),
                "qualiPos": r.get("qualificationPositionNumber"),
                "laps": r.get("laps"), "time": r.get("time"), "gap": r.get("gap"),
                "points": r.get("points"),
                "status": r.get("reasonRetired") or "Finished",
                "fastestLap": r.get("fastestLap"),
                "polePosition": r.get("polePosition"),
                "positionsGained": r.get("positionsGained"),
                "pitStops": pit_count_by_race_driver[race["id"]].get(r["driverId"], 0),
            } for r in results]

            quali = sorted(quali_by_race.get(race["id"], []),
                           key=lambda r: r.get("positionDisplayOrder", 9999))
            slim_quali = [{
                "driverId": q["driverId"], "constructorId": q["constructorId"],
                "position": q.get("positionNumber"),
                "positionText": q.get("positionText"),
                "q1": q.get("q1"), "q2": q.get("q2"), "q3": q.get("q3"),
                "q1Millis": q.get("q1Millis"), "q2Millis": q.get("q2Millis"),
                "q3Millis": q.get("q3Millis"),
                "time": q.get("time"), "timeMillis": q.get("timeMillis"),
            } for q in quali]

            sprint_results = sorted(sprint_results_by_race.get(race["id"], []),
                                    key=lambda r: r.get("positionDisplayOrder", 9999))
            slim_sprint_results = [{
                "driverId": r["driverId"], "constructorId": r["constructorId"],
                "position": r.get("positionNumber"),
                "positionText": r.get("positionText"),
                "grid": (next((g.get("gridPositionNumber") for g in sprint_grid_by_race.get(race["id"], [])
                              if g["driverId"] == r["driverId"]), None)),
                "points": r.get("points"),
                "status": r.get("reasonRetired") or "Finished",
                "time": r.get("time"), "gap": r.get("gap"),
            } for r in sprint_results] if sprint_results else []

            sprint_quali = sorted(sprint_quali_by_race.get(race["id"], []),
                                  key=lambda r: r.get("positionDisplayOrder", 9999))
            slim_sprint_quali = [{
                "driverId": q["driverId"], "constructorId": q["constructorId"],
                "position": q.get("positionNumber"),
                "q1": q.get("q1"), "q2": q.get("q2"), "q3": q.get("q3"),
                "q1Millis": q.get("q1Millis"), "q2Millis": q.get("q2Millis"),
                "q3Millis": q.get("q3Millis"),
                "time": q.get("time"), "timeMillis": q.get("timeMillis"),
            } for q in sprint_quali] if sprint_quali else []

            standings = sorted(drv_st_by_race.get(race["id"], []),
                               key=lambda s: s.get("positionDisplayOrder", 9999))
            slim_standings = [{"driverId": s["driverId"],
                               "position": s.get("positionNumber"),
                               "points": s.get("points")} for s in standings]
            cstandings = sorted(cst_st_by_race.get(race["id"], []),
                                key=lambda s: s.get("positionDisplayOrder", 9999))
            slim_cstandings = [{"constructorId": s["constructorId"],
                                "position": s.get("positionNumber"),
                                "points": s.get("points")} for s in cstandings]

            # Fastest lap winner
            fls = fl_by_race.get(race["id"], [])
            fl_winner = next((f for f in fls if f.get("positionNumber") == 1), None)

            race_payload.append({
                "id": race["id"], "round": race["round"], "date": race.get("date"),
                "name": race.get("officialName"),
                "grandPrixId": race.get("grandPrixId"),
                "circuitId": race.get("circuitId"),
                "laps": race.get("laps"), "courseLength": race.get("courseLength"),
                "distance": race.get("distance"),
                "qualifyingFormat": race.get("qualifyingFormat"),
                "sprintQualifyingFormat": race.get("sprintQualifyingFormat"),
                "results": slim_results,
                "qualifying": slim_quali,
                "sprintResults": slim_sprint_results,
                "sprintQualifying": slim_sprint_quali,
                "fastestLap": fl_winner and {"driverId": fl_winner["driverId"],
                                              "lap": fl_winner.get("lap"),
                                              "time": fl_winner.get("time")},
                "driverStandings": slim_standings,
                "constructorStandings": slim_cstandings,
            })

        # f1db season-standings rows don't carry a constructor; derive each
        # driver's primary team from race results (most starts wins ties).
        team_starts = defaultdict(lambda: defaultdict(int))
        for race in season_races:
            for r in results_by_race.get(race["id"], []):
                team_starts[r["driverId"]][r["constructorId"]] += 1
        # And per-driver season win count from race results
        wins_by_driver = defaultdict(int)
        for race in season_races:
            for r in results_by_race.get(race["id"], []):
                if r.get("positionNumber") == 1:
                    wins_by_driver[r["driverId"]] += 1

        def primary_team(did):
            counts = team_starts.get(did)
            if not counts:
                return None
            return max(counts.items(), key=lambda x: x[1])[0]

        # Season max points (era-aware): sum of per-race ceilings, where the
        # ceiling is the max points actually awarded to any driver in that
        # round. Auto-handles era changes (10pt → 25pt), fastest-lap bonus,
        # half-points races, and sprint scoring.
        season_max_points = 0
        for race in race_payload:
            r_max = max((r.get("points") or 0 for r in race.get("results") or []),
                        default=0)
            s_max = max((r.get("points") or 0 for r in race.get("sprintResults") or []),
                        default=0)
            season_max_points += r_max + s_max
        season_max_points_by_year[year] = season_max_points
        season_rounds_by_year[year] = {
            "completed": sum(1 for r in race_payload if r.get("results")),
            "scheduled": len(race_payload),
        }

        season_payload = {
            "year": year,
            "maxPoints": season_max_points,
            "races": race_payload,
            "finalDriverStandings": [{
                "position": s.get("positionNumber"), "driverId": s["driverId"],
                "constructorId": s.get("constructorId") or primary_team(s["driverId"]),
                "points": s.get("points"),
                "wins": s.get("totalRaceWins") or wins_by_driver.get(s["driverId"], 0),
            } for s in sorted(season_drv_by_year.get(year, []),
                              key=lambda s: s.get("positionDisplayOrder", 9999))],
            "finalConstructorStandings": [{
                "position": s.get("positionNumber"),
                "constructorId": s["constructorId"],
                "points": s.get("points"), "wins": s.get("totalRaceWins"),
            } for s in sorted(season_cst_by_year.get(year, []),
                              key=lambda s: s.get("positionDisplayOrder", 9999))],
        }
        with open(SEASONS_DIR / f"{year}.json", "w") as f:
            json.dump(season_payload, f, separators=(",", ":"))

        # ── DPI v2 for season ──
        per_race_out = []
        per_driver_entries = defaultdict(list)

        for race in season_races:
            rid = race["id"]
            entries = compute_race_dpi(
                results_by_race.get(rid, []),
                quali_by_race.get(rid, []),
                pit_count_by_race_driver[rid],
                sprint=False)
            for e in entries:
                e_full = {**e, "round": race["round"], "raceId": rid,
                          "raceName": race.get("officialName"),
                          "date": race.get("date"), "kind": "race"}
                per_race_out.append({"round": race["round"], "raceId": rid,
                                     "raceName": race.get("officialName"),
                                     "date": race.get("date"),
                                     "entries": entries, "kind": "race"} if False else None)
                per_driver_entries[e["driverId"]].append(e_full)

            # Sprint contribution
            if sprint_results_by_race.get(rid):
                sprint_grid_map = {g["driverId"]: g.get("gridPositionNumber")
                                   for g in sprint_grid_by_race.get(rid, [])}
                sr_with_grid = []
                for r in sprint_results_by_race[rid]:
                    rr2 = dict(r)
                    rr2["gridPositionNumber"] = sprint_grid_map.get(r["driverId"]) \
                        or r.get("gridPositionNumber")
                    sr_with_grid.append(rr2)
                sentries = compute_race_dpi(sr_with_grid,
                                            sprint_quali_by_race.get(rid, []),
                                            defaultdict(int),
                                            sprint=True)
                for e in sentries:
                    e_full = {**e, "round": race["round"], "raceId": rid,
                              "raceName": race.get("officialName"),
                              "date": race.get("date"), "kind": "sprint"}
                    per_driver_entries[e["driverId"]].append(e_full)

        # Reconstruct per_race_out cleanly
        per_race_out = []
        for race in season_races:
            rid = race["id"]
            race_entries = [e for d, ents in per_driver_entries.items()
                            for e in ents if e["raceId"] == rid and e["kind"] == "race"]
            sprint_entries = [e for d, ents in per_driver_entries.items()
                              for e in ents if e["raceId"] == rid and e["kind"] == "sprint"]
            per_race_out.append({
                "round": race["round"], "raceId": rid,
                "raceName": race.get("officialName"), "date": race.get("date"),
                "entries": race_entries,
                "sprintEntries": sprint_entries if sprint_entries else None,
            })

        # ── Bayesian/Ridge decomposition for the season ──
        season_q_by_race = {race["id"]: quali_by_race.get(race["id"], [])
                            for race in season_races}
        dsc = decompose_season_quali(season_q_by_race)
        season_dsc_drivers[year] = dsc["drivers"]
        season_dsc_teams[year] = dsc["teams"]

        # ── Aggregate per driver for the season ──
        aggregates = []
        for did, ents in per_driver_entries.items():
            race_only = [e for e in ents if e["kind"] == "race"]
            team = race_only[0]["team"] if race_only else (ents[0]["team"] if ents else None)
            qvals = [e["qualiRating"] for e in ents if e["qualiRating"] is not None]
            rvals_raw = [e["racecraft"] for e in ents if e["racecraft"] is not None]
            rvals_adj = [e["racecraftAdj"] for e in ents if e["racecraftAdj"] is not None]
            fvals = [e["finishRating"] for e in ents if e["finishRating"] is not None]
            ovals_raw = [e["overall"] for e in ents if e["overall"] is not None]
            ovals_adj = [e["overallAdj"] for e in ents if e["overallAdj"] is not None]

            # Sprint-weighted overall using overallAdj
            weighted_sum_o = 0.0; weighted_n_o = 0.0
            ovals_for_best75 = []
            for e in ents:
                if e["overallAdj"] is None: continue
                w = e["weight"]
                weighted_sum_o += e["overallAdj"] * w
                weighted_n_o += w
                ovals_for_best75.append(e["overallAdj"])
            mean_overall_w = (weighted_sum_o / weighted_n_o) if weighted_n_o else None
            best75 = best_75_mean(ovals_for_best75)

            deltas = [e["qualiDelta"] for e in ents if e["qualiDelta"] is not None]
            beats = sum(1 for x in deltas if x < 0)
            total_points = sum((e["points"] or 0) for e in race_only)

            mean_quali = (sum(qvals) / len(qvals)) if qvals else None
            mean_race_raw = (sum(rvals_raw) / len(rvals_raw)) if rvals_raw else None
            mean_race_adj = (sum(rvals_adj) / len(rvals_adj)) if rvals_adj else None
            mean_finish = (sum(fvals) / len(fvals)) if fvals else None
            mean_overall_raw = (sum(ovals_raw) / len(ovals_raw)) if ovals_raw else None

            # DSC season score for this driver
            alpha = dsc["drivers"].get(did)
            dsc_score = dsc_to_score(alpha) if alpha is not None else None

            aggregates.append({
                "driverId": did, "team": team,
                "races": len(race_only),
                "sprints": sum(1 for e in ents if e["kind"] == "sprint"),
                "qualiSamples": len(qvals),
                "raceSamples": len(rvals_adj),
                "meanQuali": round(mean_quali, 2) if mean_quali is not None else None,
                "meanRace": round(mean_race_raw, 2) if mean_race_raw is not None else None,
                "meanRaceAdj": round(mean_race_adj, 2) if mean_race_adj is not None else None,
                "meanFinish": round(mean_finish, 2) if mean_finish is not None else None,
                "finishSamples": len(fvals),
                "meanOverall": round(mean_overall_raw, 2) if mean_overall_raw is not None else None,
                "meanOverallAdj": round(weighted_sum_o / weighted_n_o, 2) if weighted_n_o else None,
                "best75Overall": round(best75, 2) if best75 is not None else None,
                "shrunkOverall": round(shrink(mean_overall_w, weighted_n_o), 2)
                                 if mean_overall_w is not None else None,
                "meanQualiDelta": round(sum(deltas) / len(deltas), 4) if deltas else None,
                "teammateBeats": beats, "teammateRaces": len(deltas),
                "totalPoints": total_points,
                "qualiElo": round(quali_elo.r.get(did, ELO_INIT), 1)
                            if did in quali_elo.r else None,
                "raceElo": round(race_elo.r.get(did, ELO_INIT), 1)
                           if did in race_elo.r else None,
                "dscAlpha": round(alpha, 5) if alpha is not None else None,
                "dscScore": round(dsc_score, 2) if dsc_score is not None else None,
            })
        aggregates.sort(key=lambda x: (x["meanOverallAdj"] is None,
                                       -(x["meanOverallAdj"] or 0)))
        season_aggregates[year] = aggregates

        with open(DPI_DIR / f"{year}.json", "w") as f:
            json.dump({
                "year": year,
                "weights": {"quali": QUALI_WEIGHT, "racecraft": RACECRAFT_WEIGHT,
                            "finish": FINISH_WEIGHT,
                            "sprint": SPRINT_WEIGHT, "shrinkK": SHRINK_K},
                "drivers": aggregates,
                "races": per_race_out,
                "dscTeams": dsc["teams"],
            }, f, separators=(",", ":"))
        print(f"  {year}: {len(season_races)} races, {len(aggregates)} drivers,"
              f" DSC obs={dsc['n']}")

    # ── All-time aggregation with shrinkage + Elo + DSC ──
    print("Aggregating career metrics…")
    career = defaultdict(lambda: {
        "qualiSum": 0, "qualiN": 0,
        "raceSum": 0, "raceN": 0,
        "finishSum": 0, "finishN": 0,
        "overallSum": 0, "overallN": 0,
        "best75Sum": 0, "best75N": 0,
        "totalRaces": 0, "totalSprints": 0,
        "seasons": [], "dscSum": 0, "dscN": 0,
    })

    for year, aggs in season_aggregates.items():
        for a in aggs:
            d = career[a["driverId"]]
            d["totalRaces"] += a["races"]
            d["totalSprints"] += a["sprints"]
            d["seasons"].append({"year": year,
                                 "team": a["team"],
                                 "races": a["races"],
                                 "meanOverall": a["meanOverallAdj"],
                                 "meanQuali": a["meanQuali"],
                                 "meanRace": a["meanRaceAdj"],
                                 "meanFinish": a["meanFinish"],
                                 "best75Overall": a["best75Overall"],
                                 "shrunkOverall": a["shrunkOverall"],
                                 "qualiElo": a["qualiElo"],
                                 "raceElo": a["raceElo"],
                                 "dscScore": a["dscScore"]})
            if a["meanQuali"] is not None:
                d["qualiSum"] += a["meanQuali"] * a["qualiSamples"]
                d["qualiN"] += a["qualiSamples"]
            if a["meanRaceAdj"] is not None:
                d["raceSum"] += a["meanRaceAdj"] * a["raceSamples"]
                d["raceN"] += a["raceSamples"]
            if a["meanFinish"] is not None:
                d["finishSum"] += a["meanFinish"] * a["finishSamples"]
                d["finishN"] += a["finishSamples"]
            if a["meanOverallAdj"] is not None:
                d["overallSum"] += a["meanOverallAdj"] * a["races"]
                d["overallN"] += a["races"]
            if a["best75Overall"] is not None:
                d["best75Sum"] += a["best75Overall"] * a["races"]
                d["best75N"] += a["races"]
            if a["dscScore"] is not None:
                d["dscSum"] += a["dscScore"] * a["qualiSamples"]
                d["dscN"] += a["qualiSamples"]

    all_dpi = []
    for did, d in career.items():
        meanQ = d["qualiSum"] / d["qualiN"] if d["qualiN"] else None
        meanR = d["raceSum"] / d["raceN"] if d["raceN"] else None
        meanF = d["finishSum"] / d["finishN"] if d["finishN"] else None
        meanO = d["overallSum"] / d["overallN"] if d["overallN"] else None
        best75 = d["best75Sum"] / d["best75N"] if d["best75N"] else None
        meanDsc = d["dscSum"] / d["dscN"] if d["dscN"] else None
        all_dpi.append({
            "driverId": did,
            "totalRaces": d["totalRaces"],
            "totalSprints": d["totalSprints"],
            "meanQuali": round(meanQ, 2) if meanQ is not None else None,
            "meanRace": round(meanR, 2) if meanR is not None else None,
            "meanFinish": round(meanF, 2) if meanF is not None else None,
            "meanOverall": round(meanO, 2) if meanO is not None else None,
            "shrunkOverall": round(shrink(meanO, d["overallN"]), 2) if meanO is not None else None,
            "best75Overall": round(best75, 2) if best75 is not None else None,
            "qualiElo": round(quali_elo.r.get(did, ELO_INIT), 1) if did in quali_elo.r else None,
            "raceElo": round(race_elo.r.get(did, ELO_INIT), 1) if did in race_elo.r else None,
            "meanDsc": round(meanDsc, 2) if meanDsc is not None else None,
            "seasons": sorted(d["seasons"], key=lambda s: s["year"]),
        })
    all_dpi.sort(key=lambda x: (x["shrunkOverall"] is None, -(x["shrunkOverall"] or 0)))
    with open(DPI_DIR / "all.json", "w") as f:
        json.dump(all_dpi, f, separators=(",", ":"))

    # Per-team DSC alpha by year — drives the constructor-page car-evolution
    # chart. season_dsc_teams was populated by the per-year DPI loop above.
    constructor_dsc_out = {}
    for year, teams in season_dsc_teams.items():
        for tid, alpha in (teams or {}).items():
            constructor_dsc_out.setdefault(tid, {})[str(year)] = round(alpha, 6)
    with open(OUT / "constructor-dsc.json", "w") as f:
        json.dump(constructor_dsc_out, f, separators=(",", ":"))

    # ─── Records & curiosities bakes ──────────────────────────────────────────
    # All sourced from the per-race results we already have in scope.

    # Comebacks: top 300 grid → finish climbs, with DNF-aware adjusted Δ.
    print("Baking comebacks…")
    comebacks_out = []
    for race in races:
        rid = race["id"]; rs = results_by_race.get(rid, [])
        if not rs: continue
        finishers = {r["driverId"] for r in rs
                     if r.get("positionNumber") is not None
                     and (r.get("reasonRetired") is None or r.get("positionNumber") <= 30)}
        sorted_grids = sorted({r.get("gridPositionNumber") for r in rs
                               if r["driverId"] in finishers and r.get("gridPositionNumber")})
        grid_rank = {g: i + 1 for i, g in enumerate(sorted_grids)}
        for r in rs:
            grid = r.get("gridPositionNumber"); finish = r.get("positionNumber")
            if grid is None or finish is None: continue
            if r.get("reasonRetired"): continue
            delta = grid - finish
            if delta < 5: continue
            adj_grid = grid_rank.get(grid, grid) if r["driverId"] in finishers else grid
            comebacks_out.append({
                "year": race["year"], "round": race["round"], "raceId": race["id"],
                "raceName": race.get("officialName"), "circuitId": race.get("circuitId"),
                "driverId": r["driverId"], "constructorId": r["constructorId"],
                "grid": grid, "finish": finish,
                "delta": delta, "deltaAdj": adj_grid - finish,
            })
    comebacks_out.sort(key=lambda x: -x["delta"])
    with open(OUT / "comebacks.json", "w") as f:
        json.dump(comebacks_out[:300], f, separators=(",", ":"), ensure_ascii=False)

    # Circuit stats: per-circuit, per-driver aggregates (top 80 by wins).
    print("Baking circuit-stats…")
    circ_drv = defaultdict(lambda: defaultdict(lambda: {
        "starts": 0, "wins": 0, "podiums": 0, "poles": 0, "fl": 0, "dnf": 0,
        "finishSum": 0, "finishN": 0, "years": set(),
    }))
    circ_race_count = defaultdict(int)
    for race in races:
        cid = race.get("circuitId")
        rs = results_by_race.get(race["id"], [])
        if not cid or not rs: continue
        circ_race_count[cid] += 1
        for r in rs:
            agg = circ_drv[cid][r["driverId"]]
            agg["starts"] += 1
            agg["years"].add(race["year"])
            pos = r.get("positionNumber")
            if pos == 1: agg["wins"] += 1
            if pos and pos <= 3: agg["podiums"] += 1
            if r.get("polePosition"): agg["poles"] += 1
            if r.get("fastestLap"): agg["fl"] += 1
            if r.get("reasonRetired"):
                agg["dnf"] += 1
            elif pos is not None:
                agg["finishSum"] += pos; agg["finishN"] += 1
    circuit_stats_out = {}
    circ_meta = {c["id"]: c for c in circuits}
    for cid, drvs in circ_drv.items():
        if circ_race_count[cid] < 3: continue
        meta = circ_meta.get(cid, {})
        rows = []
        for did, a in drvs.items():
            if a["starts"] < 2: continue
            rows.append({
                "driverId": did, "starts": a["starts"], "wins": a["wins"],
                "podiums": a["podiums"], "poles": a["poles"], "fl": a["fl"],
                "dnf": a["dnf"],
                "meanFinish": round(a["finishSum"] / a["finishN"], 2) if a["finishN"] else None,
                "yearsActive": sorted(a["years"]),
            })
        rows.sort(key=lambda x: (-x["wins"], -x["podiums"], -x["starts"]))
        circuit_stats_out[cid] = {
            "name": meta.get("name", cid),
            "fullName": meta.get("fullName", meta.get("name", cid)),
            "country": meta.get("countryId"),
            "type": meta.get("type"),
            "lat": meta.get("latitude"), "lng": meta.get("longitude"),
            "totalRaces": circ_race_count[cid],
            "drivers": rows[:80],
        }
    with open(OUT / "circuit-stats.json", "w") as f:
        json.dump(circuit_stats_out, f, separators=(",", ":"), ensure_ascii=False)

    # Pole → win conversion (drivers with ≥5 poles).
    print("Baking pole-to-win…")
    ptw_acc = defaultdict(lambda: {"poles": 0, "winsFromPole": 0})
    for r in rr:
        if r.get("polePosition"):
            ptw_acc[r["driverId"]]["poles"] += 1
            if r.get("positionNumber") == 1:
                ptw_acc[r["driverId"]]["winsFromPole"] += 1
    ptw_out = {}
    for did, v in ptw_acc.items():
        if v["poles"] < 5: continue
        ptw_out[did] = {**v, "rate": round(v["winsFromPole"] / v["poles"], 4)}
    with open(OUT / "pole-to-win.json", "w") as f:
        json.dump(ptw_out, f, separators=(",", ":"))

    # Per-year engine wins (uses engineManufacturerId from raw race results).
    print("Baking engine-stats…")
    eng_year_wins = defaultdict(lambda: defaultdict(int))
    eng_year_starts = defaultdict(lambda: defaultdict(int))
    for r in rr:
        eid = r.get("engineManufacturerId")
        y = race_year_by_id.get(r.get("raceId"))
        if not eid or not y: continue
        eng_year_starts[str(y)][eid] += 1
        if r.get("positionNumber") == 1:
            eng_year_wins[str(y)][eid] += 1
    with open(OUT / "engine-stats.json", "w") as f:
        json.dump({
            "byYear": {y: dict(d) for y, d in eng_year_wins.items()},
            "startsByYear": {y: dict(d) for y, d in eng_year_starts.items()},
        }, f, separators=(",", ":"))

    # Season drama: lead changes + clinch round.
    print("Baking season-drama…")
    drama_out = {}
    for year_ in years:
        season_races_chrono = sorted(by_year[year_], key=lambda r: r.get("round"))
        if not season_races_chrono: continue
        leader_seq = []
        for race in season_races_chrono:
            sts = sorted(drv_st_by_race.get(race["id"], []),
                         key=lambda s: s.get("positionDisplayOrder", 9999))
            if sts: leader_seq.append(sts[0]["driverId"])
        lead_changes = sum(1 for i in range(1, len(leader_seq))
                           if leader_seq[i] != leader_seq[i - 1])
        final_st = sorted(season_drv_by_year.get(year_, []),
                          key=lambda s: s.get("positionDisplayOrder", 9999))
        final_champ = final_st[0]["driverId"] if final_st else None
        clinch_round = None
        if final_champ and season_races_chrono:
            total_rounds = len(season_races_chrono)
            for race in season_races_chrono:
                sts = sorted(drv_st_by_race.get(race["id"], []),
                             key=lambda s: s.get("positionDisplayOrder", 9999))
                if not sts: continue
                champ_pts = next((x["points"] for x in sts if x["driverId"] == final_champ), None)
                second = next((x["points"] for x in sts if x["driverId"] != final_champ), None)
                if champ_pts is None or second is None: continue
                rounds_left = total_rounds - race["round"]
                if champ_pts - second > rounds_left * 26:
                    clinch_round = race["round"]; break
        drama_out[str(year_)] = {
            "leadChanges": lead_changes,
            "clinchRound": clinch_round,
            "totalRounds": len(season_races_chrono),
            "completedRounds": len(leader_seq),
        }
    with open(OUT / "season-drama.json", "w") as f:
        json.dump(drama_out, f, separators=(",", ":"))

    # Dynasties — curated list, filtered to drivers actually present in our data.
    print("Baking dynasties…")
    DYNASTIES = [
        ("andretti", "Andretti", ["mario-andretti","michael-andretti","marco-andretti","jeff-andretti"]),
        ("hill", "Hill", ["graham-hill","damon-hill"]),
        ("rosberg", "Rosberg", ["keke-rosberg","nico-rosberg"]),
        ("verstappen", "Verstappen", ["jos-verstappen","max-verstappen"]),
        ("schumacher", "Schumacher", ["michael-schumacher","ralf-schumacher","mick-schumacher"]),
        ("fittipaldi", "Fittipaldi", ["emerson-fittipaldi","wilson-fittipaldi","christian-fittipaldi","pietro-fittipaldi"]),
        ("stewart", "Stewart", ["jackie-stewart","jimmy-stewart","paul-stewart"]),
        ("brabham", "Brabham", ["jack-brabham","geoff-brabham","david-brabham","gary-brabham"]),
        ("magnussen", "Magnussen", ["jan-magnussen","kevin-magnussen"]),
        ("villeneuve", "Villeneuve", ["gilles-villeneuve","jacques-villeneuve","jacques-villeneuve-sr"]),
        ("piquet", "Piquet", ["nelson-piquet","nelson-piquet-jr"]),
        ("lauda", "Lauda", ["niki-lauda","mathias-lauda"]),
        ("senna", "Senna", ["ayrton-senna","bruno-senna"]),
        ("bianchi", "Bianchi", ["jules-bianchi","lucien-bianchi","mauro-bianchi"]),
        ("prost", "Prost", ["alain-prost","nicolas-prost"]),
    ]
    drv_ids = {d["id"] for d in slim_drivers}
    dynasties_out = []
    for did_, name, members in DYNASTIES:
        valid = [m for m in members if m in drv_ids]
        if len(valid) >= 2:
            dynasties_out.append({"id": did_, "name": name, "members": valid})
    with open(OUT / "dynasties.json", "w") as f:
        json.dump(dynasties_out, f, separators=(",", ":"))

    # DNF reason categorisation per driver.
    print("Baking dnf-reasons…")
    def categorize_status(s):
        if not s: return None
        s = s.lower()
        if any(k in s for k in ["accident","collision","spun","crash","off track","stalled","puncture"]):
            return "driver"
        if any(k in s for k in ["disqualif","excluded"]):
            return "penalty"
        if "retired" in s: return "retired"
        return "mechanical"
    dnf_acc = defaultdict(lambda: {"driver": 0, "mechanical": 0, "penalty": 0,
                                   "retired": 0, "total": 0})
    for r in rr:
        cat = categorize_status(r.get("reasonRetired"))
        if not cat: continue
        dnf_acc[r["driverId"]][cat] += 1
        dnf_acc[r["driverId"]]["total"] += 1
    dnf_out = {did: dict(v) for did, v in dnf_acc.items() if v["total"] >= 5}
    with open(OUT / "dnf-reasons.json", "w") as f:
        json.dump(dnf_out, f, separators=(",", ":"))

    # Pole-time history per circuit per year.
    print("Baking circuit-pole-history…")
    poleHist = defaultdict(dict)
    for race in races:
        cid = race.get("circuitId")
        if not cid: continue
        qs = sorted(quali_by_race.get(race["id"], []),
                    key=lambda q: q.get("positionDisplayOrder", 9999))
        if not qs: continue
        pole = qs[0]
        t = (pole.get("q3Millis") or pole.get("q2Millis")
             or pole.get("q1Millis") or pole.get("timeMillis"))
        if t and isinstance(t, int):
            poleHist[cid][str(race["year"])] = t
    with open(OUT / "circuit-pole-history.json", "w") as f:
        json.dump(dict(poleHist), f, separators=(",", ":"))

    # Manifest
    last_season_races = by_year[last_year]
    last_race = max(last_season_races, key=lambda r: (r.get("date") or ""))
    with open(OUT / "index.json", "w") as f:
        json.dump({
            "version": "f1db-v2026.3.0",
            "dpiVersion": "v3",
            "weights": {"quali": QUALI_WEIGHT, "racecraft": RACECRAFT_WEIGHT,
                        "finish": FINISH_WEIGHT,
                        "sprint": SPRINT_WEIGHT, "shrinkK": SHRINK_K, "eloK": ELO_K},
            "years": years, "lastYear": last_year,
            "lastRace": {"id": last_race["id"], "year": last_race["year"],
                         "round": last_race["round"], "name": last_race.get("officialName"),
                         "date": last_race.get("date")},
            "totalDrivers": len(slim_drivers),
            "totalConstructors": len(slim_constructors),
            "seasonMaxPoints": {str(y): n for y, n in season_max_points_by_year.items()},
            "seasonRounds": {str(y): r for y, r in season_rounds_by_year.items()},
        }, f, separators=(",", ":"))

    print(f"\nDone. {len(years)} seasons baked. DPI v2 metrics: shrunkOverall, "
          f"best75Overall, qualiElo, raceElo, meanDsc, racecraftAdj.")


if __name__ == "__main__":
    main()
