#!/usr/bin/env python3
"""
Preprocess the f1db JSON-splitted dataset into lean per-season files used
by the F1stats web app.

Inputs (in data/raw/, downloaded from https://github.com/f1db/f1db/releases):
  f1db-races.json
  f1db-races-race-results.json
  f1db-races-qualifying-results.json
  f1db-races-driver-standings.json
  f1db-races-constructor-standings.json
  f1db-seasons-driver-standings.json
  f1db-seasons-constructor-standings.json
  f1db-drivers.json
  f1db-constructors.json
  f1db-grands-prix.json
  f1db-circuits.json

Outputs:
  data/index.json               - manifest: years, last race, dataset version
  data/drivers.json             - slim driver lookup
  data/constructors.json        - slim constructor lookup
  data/grands-prix.json         - GP id -> name mapping
  data/circuits.json            - circuit metadata
  data/seasons/YYYY.json        - per-season races + results + qualifying
  data/dpi/YYYY.json            - per-season DPI scores
  data/dpi/all.json             - combined DPI summary across all seasons
"""

import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
SEASONS_DIR = OUT / "seasons"
DPI_DIR = OUT / "dpi"

# DPI weights
QUALI_WEIGHT = 0.40
RACECRAFT_WEIGHT = 0.60
QUALI_SCALE = 25
RACECRAFT_SCALE = 25

DRIVER_FAULT = {"collision", "accident", "spun off", "spin", "crash", "damage",
                "off track", "driver error"}


def load(name):
    with open(RAW / name) as f:
        return json.load(f)


def classify_status(reason):
    """Bucket reasonRetired into finished/mechanical/driver_fault."""
    if not reason:
        return "finished"
    r = reason.lower()
    if "+" in r and "lap" in r:
        return "finished"
    for kw in DRIVER_FAULT:
        if kw in r:
            return "driver_fault"
    # treat anything else as mechanical / car-side
    return "mechanical"


def deepest_common_session(a, b):
    """Pick deepest Q session both drivers set a time in. Falls back to legacy
    single-session time for pre-2003 races."""
    for key, mkey in [("q3", "q3Millis"), ("q2", "q2Millis"), ("q1", "q1Millis")]:
        if a.get(mkey) and b.get(mkey):
            return key.upper(), a[mkey], b[mkey]
    if a.get("timeMillis") and b.get("timeMillis"):
        return "Q", a["timeMillis"], b["timeMillis"]
    return None


def weighted_gain(grid, finish):
    """Weighted positions gained (or lost). Front positions weighted via 1/k."""
    if not grid or not finish or grid == finish:
        return 0.0
    if finish < grid:
        return sum(1 / k for k in range(finish + 1, grid + 1))
    return -sum(1 / k for k in range(grid + 1, finish + 1))


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def compute_dpi_for_season(year, season_races, results_by_race, quali_by_race):
    """Compute per-driver DPI entries + aggregate for one season."""
    by_driver = defaultdict(lambda: {"perRace": [], "driverId": None, "team": None})

    per_race_out = []

    for race in season_races:
        rid = race["id"]
        rnd = race["round"]
        results = results_by_race.get(rid, [])
        quali = {q["driverId"]: q for q in quali_by_race.get(rid, [])}

        # Group race entrants by team for teammate lookup
        by_team = defaultdict(list)
        for r in results:
            by_team[r["constructorId"]].append(r)

        race_entries = []
        for r in results:
            did = r["driverId"]
            team = r["constructorId"]
            grid = r.get("gridPositionNumber")
            finish = r.get("positionNumber")
            status = r.get("reasonRetired") or "Finished"
            kind = classify_status(r.get("reasonRetired"))
            points = r.get("points") or 0

            # Quali sub-score
            quali_rating = None
            quali_delta = None
            quali_session = None
            mate = [t for t in by_team[team] if t["driverId"] != did]
            if did in quali and len(mate) == 1:
                tm = mate[0]
                if tm["driverId"] in quali:
                    sess = deepest_common_session(quali[did], quali[tm["driverId"]])
                    if sess:
                        sname, ta, tb = sess
                        quali_delta = (ta - tb) / tb * 100
                        quali_session = sname
                        quali_rating = clamp(50 - quali_delta * QUALI_SCALE, 0, 100)

            # Racecraft sub-score
            racecraft = None
            net_gain = None
            if kind == "mechanical":
                racecraft = None  # excluded
            elif kind == "driver_fault":
                racecraft = 0.0
            elif grid and finish:
                eg = 20 if grid == 0 else grid
                net_gain = weighted_gain(eg, finish)
                racecraft = clamp(50 + net_gain * RACECRAFT_SCALE, 0, 100)

            overall = None
            if quali_rating is not None and racecraft is not None:
                overall = quali_rating * QUALI_WEIGHT + racecraft * RACECRAFT_WEIGHT
            elif racecraft is not None:
                overall = racecraft
            elif quali_rating is not None:
                overall = quali_rating

            entry = {
                "round": rnd,
                "raceId": rid,
                "raceName": race.get("officialName"),
                "date": race.get("date"),
                "driverId": did,
                "team": team,
                "grid": grid,
                "finish": finish,
                "status": status,
                "statusKind": kind,
                "points": points,
                "qualiDelta": round(quali_delta, 4) if quali_delta is not None else None,
                "qualiSession": quali_session,
                "qualiRating": round(quali_rating, 2) if quali_rating is not None else None,
                "netGain": round(net_gain, 4) if net_gain is not None else None,
                "racecraft": round(racecraft, 2) if racecraft is not None else None,
                "overall": round(overall, 2) if overall is not None else None,
            }
            race_entries.append(entry)

            d = by_driver[did]
            d["driverId"] = did
            d["team"] = team
            d["perRace"].append(entry)

        per_race_out.append({
            "round": rnd, "raceId": rid, "raceName": race.get("officialName"),
            "date": race.get("date"), "entries": race_entries,
        })

    # Aggregates per driver
    aggregates = []
    for did, d in by_driver.items():
        races = d["perRace"]
        q = [r["qualiRating"] for r in races if r["qualiRating"] is not None]
        rc = [r["racecraft"] for r in races if r["racecraft"] is not None]
        ov = [r["overall"] for r in races if r["overall"] is not None]
        deltas = [r["qualiDelta"] for r in races if r["qualiDelta"] is not None]
        beats = sum(1 for x in deltas if x < 0)
        total_points = sum(r["points"] or 0 for r in races)
        aggregates.append({
            "driverId": did,
            "team": d["team"],
            "races": len(races),
            "qualiSamples": len(q),
            "raceSamples": len(rc),
            "meanQuali": round(sum(q) / len(q), 2) if q else None,
            "meanRace": round(sum(rc) / len(rc), 2) if rc else None,
            "meanOverall": round(sum(ov) / len(ov), 2) if ov else None,
            "meanQualiDelta": round(sum(deltas) / len(deltas), 4) if deltas else None,
            "teammateBeats": beats,
            "teammateRaces": len(deltas),
            "totalPoints": total_points,
        })

    aggregates.sort(key=lambda x: (x["meanOverall"] is None, -(x["meanOverall"] or 0)))
    return aggregates, per_race_out


def main():
    SEASONS_DIR.mkdir(parents=True, exist_ok=True)
    DPI_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading f1db source files...")
    races = load("f1db-races.json")
    rr = load("f1db-races-race-results.json")
    qr = load("f1db-races-qualifying-results.json")
    drivers = load("f1db-drivers.json")
    constructors = load("f1db-constructors.json")
    gps = load("f1db-grands-prix.json")
    circuits = load("f1db-circuits.json")
    drv_st = load("f1db-races-driver-standings.json")
    cst_st = load("f1db-races-constructor-standings.json")
    season_drv_st = load("f1db-seasons-driver-standings.json")
    season_cst_st = load("f1db-seasons-constructor-standings.json")

    # Index races by id
    race_by_id = {r["id"]: r for r in races}

    # Group results & qualifying by raceId
    results_by_race = defaultdict(list)
    for r in rr:
        results_by_race[r["raceId"]].append(r)
    quali_by_race = defaultdict(list)
    for q in qr:
        quali_by_race[q["raceId"]].append(q)

    drv_st_by_race = defaultdict(list)
    for s in drv_st:
        drv_st_by_race[s["raceId"]].append(s)
    cst_st_by_race = defaultdict(list)
    for s in cst_st:
        cst_st_by_race[s["raceId"]].append(s)

    season_drv_by_year = defaultdict(list)
    for s in season_drv_st:
        season_drv_by_year[s["year"]].append(s)
    season_cst_by_year = defaultdict(list)
    for s in season_cst_st:
        season_cst_by_year[s["year"]].append(s)

    # Slim driver and constructor lookups
    slim_drivers = []
    for d in drivers:
        slim_drivers.append({
            "id": d["id"],
            "name": d.get("name") or d.get("fullName"),
            "fullName": d.get("fullName"),
            "firstName": d.get("firstName"),
            "lastName": d.get("lastName"),
            "abbreviation": d.get("abbreviation"),
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
        })
    with open(OUT / "drivers.json", "w") as f:
        json.dump(slim_drivers, f, separators=(",", ":"))

    slim_constructors = []
    for c in constructors:
        slim_constructors.append({
            "id": c["id"],
            "name": c.get("name"),
            "fullName": c.get("fullName"),
            "country": c.get("countryId"),
            "totalPoints": c.get("totalPoints"),
            "totalRaceWins": c.get("totalRaceWins"),
            "totalPodiums": c.get("totalPodiums"),
            "totalPolePositions": c.get("totalPolePositions"),
            "totalChampionshipWins": c.get("totalChampionshipWins"),
            "totalRaceEntries": c.get("totalRaceEntries"),
            "totalRaceStarts": c.get("totalRaceStarts"),
            "bestChampionshipPosition": c.get("bestChampionshipPosition"),
        })
    with open(OUT / "constructors.json", "w") as f:
        json.dump(slim_constructors, f, separators=(",", ":"))

    with open(OUT / "grands-prix.json", "w") as f:
        json.dump([{"id": g["id"], "name": g.get("name"),
                    "fullName": g.get("fullName"),
                    "country": g.get("countryId")} for g in gps],
                  f, separators=(",", ":"))

    with open(OUT / "circuits.json", "w") as f:
        json.dump([{"id": c["id"], "name": c.get("name"),
                    "fullName": c.get("fullName"),
                    "country": c.get("countryId"),
                    "type": c.get("type"),
                    "lat": c.get("latitude"),
                    "lng": c.get("longitude")} for c in circuits],
                  f, separators=(",", ":"))

    # Group races by year
    by_year = defaultdict(list)
    for r in races:
        by_year[r["year"]].append(r)

    years = sorted(by_year.keys())
    last_year = years[-1]

    summary_dpi = {}

    for year in years:
        season_races = sorted(by_year[year], key=lambda r: r["round"])

        # ---- Season file ----
        race_payload = []
        for race in season_races:
            results = sorted(results_by_race.get(race["id"], []),
                             key=lambda r: r.get("positionDisplayOrder", 9999))
            slim_results = [{
                "driverId": r["driverId"],
                "constructorId": r["constructorId"],
                "engineId": r.get("engineManufacturerId"),
                "number": r.get("driverNumber"),
                "position": r.get("positionNumber"),
                "positionText": r.get("positionText"),
                "grid": r.get("gridPositionNumber"),
                "qualiPos": r.get("qualificationPositionNumber"),
                "laps": r.get("laps"),
                "time": r.get("time"),
                "gap": r.get("gap"),
                "points": r.get("points"),
                "status": r.get("reasonRetired") or "Finished",
                "fastestLap": r.get("fastestLap"),
                "polePosition": r.get("polePosition"),
                "positionsGained": r.get("positionsGained"),
            } for r in results]

            quali = sorted(quali_by_race.get(race["id"], []),
                           key=lambda r: r.get("positionDisplayOrder", 9999))
            slim_quali = [{
                "driverId": q["driverId"],
                "constructorId": q["constructorId"],
                "position": q.get("positionNumber"),
                "positionText": q.get("positionText"),
                "q1": q.get("q1") or (q.get("time") if q.get("q1") is None and q.get("time") else None),
                "q2": q.get("q2"),
                "q3": q.get("q3"),
                "q1Millis": q.get("q1Millis"),
                "q2Millis": q.get("q2Millis"),
                "q3Millis": q.get("q3Millis"),
                "time": q.get("time"),
                "timeMillis": q.get("timeMillis"),
            } for q in quali]

            standings = sorted(drv_st_by_race.get(race["id"], []),
                               key=lambda s: s.get("positionDisplayOrder", 9999))
            slim_standings = [{
                "driverId": s["driverId"],
                "position": s.get("positionNumber"),
                "points": s.get("points"),
                "wins": s.get("positionsGained"),  # f1db doesn't track wins per race directly
            } for s in standings]

            cstandings = sorted(cst_st_by_race.get(race["id"], []),
                                key=lambda s: s.get("positionDisplayOrder", 9999))
            slim_cstandings = [{
                "constructorId": s["constructorId"],
                "position": s.get("positionNumber"),
                "points": s.get("points"),
            } for s in cstandings]

            race_payload.append({
                "id": race["id"],
                "round": race["round"],
                "date": race.get("date"),
                "name": race.get("officialName"),
                "grandPrixId": race.get("grandPrixId"),
                "circuitId": race.get("circuitId"),
                "laps": race.get("laps"),
                "courseLength": race.get("courseLength"),
                "distance": race.get("distance"),
                "qualifyingFormat": race.get("qualifyingFormat"),
                "results": slim_results,
                "qualifying": slim_quali,
                "driverStandings": slim_standings,
                "constructorStandings": slim_cstandings,
            })

        season_payload = {
            "year": year,
            "races": race_payload,
            "finalDriverStandings": [{
                "position": s.get("positionNumber"),
                "driverId": s["driverId"],
                "constructorId": s.get("constructorId"),
                "points": s.get("points"),
                "wins": s.get("totalRaceWins"),
            } for s in sorted(season_drv_by_year.get(year, []),
                              key=lambda s: s.get("positionDisplayOrder", 9999))],
            "finalConstructorStandings": [{
                "position": s.get("positionNumber"),
                "constructorId": s["constructorId"],
                "points": s.get("points"),
                "wins": s.get("totalRaceWins"),
            } for s in sorted(season_cst_by_year.get(year, []),
                              key=lambda s: s.get("positionDisplayOrder", 9999))],
        }
        with open(SEASONS_DIR / f"{year}.json", "w") as f:
            json.dump(season_payload, f, separators=(",", ":"))

        # ---- DPI file ----
        aggregates, per_race = compute_dpi_for_season(year, season_races,
                                                     results_by_race, quali_by_race)
        with open(DPI_DIR / f"{year}.json", "w") as f:
            json.dump({
                "year": year,
                "weights": {"quali": QUALI_WEIGHT, "racecraft": RACECRAFT_WEIGHT},
                "drivers": aggregates,
                "races": per_race,
            }, f, separators=(",", ":"))

        # Cross-season summary (just top mean overall etc.)
        summary_dpi[year] = aggregates[:30]
        print(f"  {year}: {len(season_races)} races, {len(aggregates)} drivers")

    # Combined DPI summary used by leaderboard view (all-time average across seasons).
    all_drivers_dpi = defaultdict(lambda: {"seasons": [], "totalRaces": 0,
                                            "qualiSum": 0, "qualiN": 0,
                                            "raceSum": 0, "raceN": 0,
                                            "overallSum": 0, "overallN": 0})
    for year, aggs in summary_dpi.items():
        for a in aggs:
            d = all_drivers_dpi[a["driverId"]]
            d["driverId"] = a["driverId"]
            d["seasons"].append({"year": year, "meanOverall": a["meanOverall"],
                                 "meanQuali": a["meanQuali"],
                                 "meanRace": a["meanRace"],
                                 "races": a["races"],
                                 "team": a["team"]})
            d["totalRaces"] += a["races"]
            if a["meanQuali"] is not None:
                d["qualiSum"] += a["meanQuali"] * a["qualiSamples"]
                d["qualiN"] += a["qualiSamples"]
            if a["meanRace"] is not None:
                d["raceSum"] += a["meanRace"] * a["raceSamples"]
                d["raceN"] += a["raceSamples"]
            if a["meanOverall"] is not None:
                d["overallSum"] += a["meanOverall"] * a["races"]
                d["overallN"] += a["races"]

    all_dpi = []
    for did, d in all_drivers_dpi.items():
        all_dpi.append({
            "driverId": did,
            "totalRaces": d["totalRaces"],
            "meanQuali": round(d["qualiSum"] / d["qualiN"], 2) if d["qualiN"] else None,
            "meanRace": round(d["raceSum"] / d["raceN"], 2) if d["raceN"] else None,
            "meanOverall": round(d["overallSum"] / d["overallN"], 2) if d["overallN"] else None,
            "seasons": sorted(d["seasons"], key=lambda s: s["year"]),
        })
    all_dpi.sort(key=lambda x: (x["meanOverall"] is None, -(x["meanOverall"] or 0)))
    with open(DPI_DIR / "all.json", "w") as f:
        json.dump(all_dpi, f, separators=(",", ":"))

    # Manifest
    last_season_races = by_year[last_year]
    last_race = max(last_season_races, key=lambda r: (r.get("date") or ""))
    manifest = {
        "version": "f1db-v2026.3.0",
        "years": years,
        "lastYear": last_year,
        "lastRace": {
            "id": last_race["id"], "year": last_race["year"], "round": last_race["round"],
            "name": last_race.get("officialName"), "date": last_race.get("date"),
        },
        "totalDrivers": len(slim_drivers),
        "totalConstructors": len(slim_constructors),
    }
    with open(OUT / "index.json", "w") as f:
        json.dump(manifest, f, separators=(",", ":"))

    print(f"\nDone. {len(years)} seasons baked.")


if __name__ == "__main__":
    main()
