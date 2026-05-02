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
QUALI_WEIGHT = 0.40
RACECRAFT_WEIGHT = 0.60
QUALI_SCALE = 25
RACECRAFT_SCALE = 25
SPRINT_WEIGHT = 0.30      # each sprint counts as 0.3 of a race
SHRINK_K = 10             # Bayesian shrinkage strength toward prior 50

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


def weighted_gain(grid, finish):
    """Σ ±1/k weighted positions gained (or lost). 0 if no movement."""
    if not grid or not finish or grid == finish:
        return 0.0
    if finish < grid:
        return sum(1 / k for k in range(finish + 1, grid + 1))
    return -sum(1 / k for k in range(grid + 1, finish + 1))


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

        # Racecraft (raw and DNF-adjusted)
        racecraft = racecraft_adj = None
        net_gain = net_gain_adj = None
        if kind == "mechanical":
            pass  # excluded
        elif kind == "driver_fault":
            racecraft = racecraft_adj = 0.0
        elif grid and finish:
            eg = 20 if grid == 0 else grid
            net_gain = weighted_gain(eg, finish)
            racecraft = clamp(50 + net_gain * RACECRAFT_SCALE, 0, 100)
            adj_g = adj_grid_of.get(did)
            adj_f = None
            if did in finishers:
                # finish position among finishers — list sorted by classification
                fin_sorted = sorted(
                    [x for x in race_results if x["driverId"] in finishers
                     and x.get("positionNumber")],
                    key=lambda x: x["positionNumber"])
                for j, x in enumerate(fin_sorted, 1):
                    if x["driverId"] == did:
                        adj_f = j
                        break
            if adj_g and adj_f:
                net_gain_adj = weighted_gain(adj_g, adj_f)
                racecraft_adj = clamp(50 + net_gain_adj * RACECRAFT_SCALE, 0, 100)
            else:
                # fall back to raw if we can't compute adjusted
                net_gain_adj = net_gain
                racecraft_adj = racecraft

        def combine(q, r):
            if q is not None and r is not None:
                return q * QUALI_WEIGHT + r * RACECRAFT_WEIGHT
            return q if q is not None else r

        overall = combine(quali_rating, racecraft)
        overall_adj = combine(quali_rating, racecraft_adj)

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

        season_payload = {
            "year": year,
            "races": race_payload,
            "finalDriverStandings": [{
                "position": s.get("positionNumber"), "driverId": s["driverId"],
                "constructorId": s.get("constructorId"),
                "points": s.get("points"), "wins": s.get("totalRaceWins"),
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
        meanO = d["overallSum"] / d["overallN"] if d["overallN"] else None
        best75 = d["best75Sum"] / d["best75N"] if d["best75N"] else None
        meanDsc = d["dscSum"] / d["dscN"] if d["dscN"] else None
        all_dpi.append({
            "driverId": did,
            "totalRaces": d["totalRaces"],
            "totalSprints": d["totalSprints"],
            "meanQuali": round(meanQ, 2) if meanQ is not None else None,
            "meanRace": round(meanR, 2) if meanR is not None else None,
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

    # Manifest
    last_season_races = by_year[last_year]
    last_race = max(last_season_races, key=lambda r: (r.get("date") or ""))
    with open(OUT / "index.json", "w") as f:
        json.dump({
            "version": "f1db-v2026.3.0",
            "dpiVersion": "v2",
            "weights": {"quali": QUALI_WEIGHT, "racecraft": RACECRAFT_WEIGHT,
                        "sprint": SPRINT_WEIGHT, "shrinkK": SHRINK_K, "eloK": ELO_K},
            "years": years, "lastYear": last_year,
            "lastRace": {"id": last_race["id"], "year": last_race["year"],
                         "round": last_race["round"], "name": last_race.get("officialName"),
                         "date": last_race.get("date")},
            "totalDrivers": len(slim_drivers),
            "totalConstructors": len(slim_constructors),
        }, f, separators=(",", ":"))

    print(f"\nDone. {len(years)} seasons baked. DPI v2 metrics: shrunkOverall, "
          f"best75Overall, qualiElo, raceElo, meanDsc, racecraftAdj.")


if __name__ == "__main__":
    main()
