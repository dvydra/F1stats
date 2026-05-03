#!/usr/bin/env python3
"""
f1 — a pretty colored CLI for the F1stats database.

Reads the same baked JSON files as the web app (data/index.json, data/seasons/,
data/dpi/, etc.). No external deps. ANSI colors and box-drawing chars only.

Usage:
  f1                         shortcut for `f1 home`
  f1 home                    latest season dashboard
  f1 seasons                 list all seasons
  f1 schedule [YEAR]         race schedule
  f1 season YEAR             season standings + DPI top
  f1 race YEAR ROUND         race results + qualifying + DPI breakdown
  f1 driver QUERY            driver profile (name or id)
  f1 team QUERY              constructor profile
  f1 dpi YEAR                DPI leaderboard for season
  f1 dpi all                 all-time DPI leaderboard
  f1 elo                     all-time qualifying-Elo top 30
  f1 compare A B             head-to-head two drivers (names or ids)
  f1 search QUERY            search drivers + teams
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# ── ANSI / colors ─────────────────────────────────────────────────────────

_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _ansi(seq):
    return f"\x1b[{seq}m" if _USE_COLOR else ""


RESET = _ansi("0")
BOLD = _ansi("1")
DIM = _ansi("2")
ITALIC = _ansi("3")
UNDER = _ansi("4")

# 256-color palette used throughout
RED = _ansi("38;5;196")
ORANGE = _ansi("38;5;208")
YELLOW = _ansi("38;5;220")
GOLD = _ansi("38;5;220")
GREEN = _ansi("38;5;46")
LIME = _ansi("38;5;118")
CYAN = _ansi("38;5;51")
BLUE = _ansi("38;5;39")
MAGENTA = _ansi("38;5;201")
GREY = _ansi("38;5;245")
DARK = _ansi("38;5;240")
WHITE = _ansi("38;5;255")
SILVER = _ansi("38;5;253")
BRONZE = _ansi("38;5;130")

BG_RED = _ansi("48;5;196")
BG_DARK = _ansi("48;5;234")


def color(s, c):
    return f"{c}{s}{RESET}" if _USE_COLOR else s


def bold(s): return color(s, BOLD)
def dim(s): return color(s, DIM)
def muted(s): return color(s, GREY)


def score_color(s):
    """Red→yellow→green for a 0-100 DPI score."""
    if s is None:
        return GREY
    if s < 35: return RED
    if s < 45: return ORANGE
    if s < 55: return YELLOW
    if s < 65: return LIME
    return GREEN


def fmt_score(s, width=5):
    if s is None:
        return color(f"{'—':>{width}}", GREY)
    return color(f"{s:>{width}.1f}", score_color(s))


def pos_color(p):
    if p == 1: return GOLD
    if p == 2: return SILVER
    if p == 3: return BRONZE
    return WHITE


def fmt_pos(p, width=3):
    if p is None:
        return f"{'—':>{width}}"
    s = f"{p:>{width}}"
    if _USE_COLOR and p in (1, 2, 3):
        return f"{BOLD}{pos_color(p)}{s}{RESET}"
    return s


def visible_len(s):
    """Length of a string ignoring ANSI escape sequences."""
    out = []
    skip = False
    for ch in s:
        if ch == "\x1b":
            skip = True
            continue
        if skip:
            if ch == "m":
                skip = False
            continue
        out.append(ch)
    return len(out)


def pad(s, w, align="<"):
    """Pad a string to width w accounting for ANSI escape codes."""
    n = visible_len(s)
    if n >= w:
        return s
    space = " " * (w - n)
    if align == ">":
        return space + s
    if align == "^":
        l = (w - n) // 2
        r = w - n - l
        return " " * l + s + " " * r
    return s + space


# ── Pretty boxes / banners ────────────────────────────────────────────────

BOX = {
    "tl": "╔", "tr": "╗", "bl": "╚", "br": "╝",
    "h": "═", "v": "║", "tj": "╦", "bj": "╩", "lj": "╠", "rj": "╣", "x": "╬",
}
LINE = {"tl": "┌", "tr": "┐", "bl": "└", "br": "┘",
        "h": "─", "v": "│", "tj": "┬", "bj": "┴", "lj": "├", "rj": "┤", "x": "┼"}


def banner(title, sub=None):
    """Bold red banner for major section headers."""
    title = title.upper()
    line = title if not sub else f"{title}  {DIM}{sub}{RESET}"
    width = max(visible_len(line) + 4, 30)
    inner = pad(line, width - 2, "^")
    top = color(BOX["tl"] + BOX["h"] * (width - 2) + BOX["tr"], RED)
    mid = color(BOX["v"], RED) + " " + inner + " " + color(BOX["v"], RED)
    bot = color(BOX["bl"] + BOX["h"] * (width - 2) + BOX["br"], RED)
    print(f"{BOLD}{top}{RESET}")
    print(f"{BOLD}{mid}{RESET}")
    print(f"{BOLD}{bot}{RESET}")


def section(title):
    bar = color("▌", RED)
    print(f"\n{bar} {BOLD}{title.upper()}{RESET}")


def kv(label, value, label_w=18):
    print(f"  {muted(pad(label, label_w))} {value}")


def hr(n=78):
    print(color(LINE["h"] * n, DARK))


def table(headers, rows, aligns=None):
    """Render a colored table with box-drawing.
    headers: list[str]
    rows: list[list[str]]   (entries may contain ANSI codes)
    aligns: list[str]   "<" / ">" / "^" per column. Defaults to "<".
    """
    if aligns is None:
        aligns = ["<"] * len(headers)
    widths = [visible_len(h) for h in headers]
    for r in rows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], visible_len(str(c)))

    def render_row(cells, sep_color=DARK):
        sep = color(LINE["v"], sep_color)
        parts = []
        for c, w, a in zip(cells, widths, aligns):
            parts.append(" " + pad(str(c), w, a) + " ")
        return sep + sep.join(parts) + sep

    # Top border
    sep_h = color(LINE["h"], DARK)
    top = color(LINE["tl"], DARK)
    for i, w in enumerate(widths):
        top += sep_h * (w + 2)
        top += color(LINE["tj"] if i < len(widths) - 1 else LINE["tr"], DARK)
    print(top)
    # Header row
    print(render_row([f"{BOLD}{CYAN}{h}{RESET}" for h in headers]))
    # Separator
    sep = color(LINE["lj"], DARK)
    for i, w in enumerate(widths):
        sep += sep_h * (w + 2)
        sep += color(LINE["x"] if i < len(widths) - 1 else LINE["rj"], DARK)
    print(sep)
    # Body
    for r in rows:
        print(render_row(r))
    # Bottom
    bot = color(LINE["bl"], DARK)
    for i, w in enumerate(widths):
        bot += sep_h * (w + 2)
        bot += color(LINE["bj"] if i < len(widths) - 1 else LINE["br"], DARK)
    print(bot)


# ── Data loading ──────────────────────────────────────────────────────────

def load(name):
    p = DATA / name
    if not p.exists():
        die(f"Data file not found: {p}. Run scripts/build_data.py.")
    with open(p) as f:
        return json.load(f)


def load_season(year): return load(f"seasons/{year}.json")
def load_dpi(year): return load(f"dpi/{year}.json")


_caches = {}


def drivers():
    if "d" not in _caches:
        _caches["d"] = {x["id"]: x for x in load("drivers.json")}
    return _caches["d"]


def constructors():
    if "c" not in _caches:
        _caches["c"] = {x["id"]: x for x in load("constructors.json")}
    return _caches["c"]


def grands_prix():
    if "g" not in _caches:
        _caches["g"] = {x["id"]: x for x in load("grands-prix.json")}
    return _caches["g"]


def manifest():
    if "m" not in _caches:
        _caches["m"] = load("index.json")
    return _caches["m"]


def driver_name(did, short=False):
    d = drivers().get(did)
    if not d:
        return did
    if short:
        return d.get("lastName") or d.get("name") or did
    return d.get("fullName") or d.get("name") or did


def team_name(tid):
    c = constructors().get(tid)
    return c.get("name") if c else tid


def resolve_driver(query):
    """Return driver_id for a name/id query, or None."""
    q = query.lower()
    if q in drivers():
        return q
    candidates = []
    for did, d in drivers().items():
        hay = f"{d.get('fullName','')} {d.get('name','')} {d.get('lastName','')}".lower()
        if q in hay:
            candidates.append((d.get("totalRaceStarts") or 0, did, d))
    candidates.sort(reverse=True)
    return candidates[0][1] if candidates else None


def resolve_constructor(query):
    q = query.lower()
    if q in constructors():
        return q
    candidates = []
    for cid, c in constructors().items():
        hay = f"{c.get('fullName','')} {c.get('name','')}".lower()
        if q in hay:
            candidates.append((c.get("totalRaceWins") or 0, cid))
    candidates.sort(reverse=True)
    return candidates[0][1] if candidates else None


def die(msg, code=1):
    print(f"{RED}error:{RESET} {msg}", file=sys.stderr)
    sys.exit(code)


# ── Commands ──────────────────────────────────────────────────────────────

def cmd_home(args):
    m = manifest()
    year = m["lastYear"]
    season = load_season(year)
    dpi = load_dpi(year)
    last = season["races"][-1]

    banner("F1 Stats", f"DPI {m.get('dpiVersion','v3')} · {m['years'][0]}–{year}")

    section(f"Latest race · {last['name']}")
    winner = last["results"][0] if last["results"] else None
    pole = next((q for q in last["qualifying"] if q["position"] == 1), None)
    fl = last.get("fastestLap")
    kv("Round", f"{last['round']} of {len(season['races'])}")
    kv("Date", last["date"])
    if winner:
        wd = drivers().get(winner["driverId"], {})
        kv("Winner", f"{BOLD}{driver_name(winner['driverId'])}{RESET} · "
           f"{muted(team_name(winner['constructorId']))}")
    if pole:
        kv("Pole", driver_name(pole["driverId"]))
    if fl:
        kv("Fastest lap", driver_name(fl["driverId"]))

    section(f"{year} Championship · top 10")
    rows = []
    dpi_map = {d["driverId"]: d for d in dpi["drivers"]}
    for s in season["finalDriverStandings"][:10]:
        dr = dpi_map.get(s["driverId"], {})
        rows.append([
            fmt_pos(s["position"]),
            bold(driver_name(s["driverId"])),
            muted(team_name(s["constructorId"]) or "—"),
            f"{s['points']}",
            str(s.get("wins") or 0),
            fmt_score(dr.get("shrunkOverall")),
            f"{dr.get('qualiElo'):>4.0f}" if dr.get("qualiElo") else muted(" —"),
        ])
    table(["#", "Driver", "Team", "Pts", "Wins", "DPI", "qElo"], rows,
          aligns=[">", "<", "<", ">", ">", ">", ">"])

    section(f"{year} DPI top 8")
    rows = []
    top_dpi = sorted(dpi["drivers"], key=lambda x: -(x.get("shrunkOverall") or 0))[:8]
    for i, d in enumerate(top_dpi, 1):
        rows.append([
            fmt_pos(i),
            bold(driver_name(d["driverId"])),
            muted(team_name(d["team"]) or "—"),
            fmt_score(d.get("meanQuali")),
            fmt_score(d.get("meanRaceAdj")),
            fmt_score(d.get("meanFinish")),
            fmt_score(d.get("shrunkOverall")),
        ])
    table(["#", "Driver", "Team", "Quali", "Race", "Finish", "Shrunk"], rows,
          aligns=[">", "<", "<", ">", ">", ">", ">"])


def cmd_seasons(args):
    m = manifest()
    banner("Seasons", f"{m['years'][0]}–{m['years'][-1]}")
    cols = 8
    out = []
    for y in m["years"]:
        out.append(color(f"{y}", BOLD if y == m["lastYear"] else WHITE))
    for i in range(0, len(out), cols):
        print("  " + "  ".join(out[i:i + cols]))


def cmd_schedule(args):
    year = args.year or manifest()["lastYear"]
    season = load_season(year)
    banner(f"{year} schedule", f"{len(season['races'])} races")
    rows = []
    for r in season["races"]:
        winner = r["results"][0] if r["results"] else None
        wd = driver_name(winner["driverId"]) if winner else muted("upcoming")
        rows.append([
            f"R{r['round']:02d}",
            r["date"] or "—",
            bold(r["name"]),
            wd,
        ])
    table(["#", "Date", "Race", "Winner"], rows)


def cmd_season(args):
    year = args.year
    season = load_season(year)
    dpi = load_dpi(year)
    dpi_map = {d["driverId"]: d for d in dpi["drivers"]}
    banner(f"{year} season")

    section("Drivers' championship")
    rows = []
    for s in season["finalDriverStandings"]:
        dr = dpi_map.get(s["driverId"], {})
        rows.append([
            fmt_pos(s["position"]),
            bold(driver_name(s["driverId"])),
            muted(team_name(s["constructorId"]) or "—"),
            f"{s['points']}",
            str(s.get("wins") or 0),
            fmt_score(dr.get("shrunkOverall")),
            f"{dr.get('qualiElo'):>4.0f}" if dr.get("qualiElo") else muted(" —"),
        ])
    table(["#", "Driver", "Team", "Pts", "Wins", "DPI", "qElo"], rows,
          aligns=[">", "<", "<", ">", ">", ">", ">"])

    section("Constructors' championship")
    rows = []
    for s in season["finalConstructorStandings"]:
        rows.append([
            fmt_pos(s["position"]),
            bold(team_name(s["constructorId"]) or "—"),
            f"{s['points']}",
            str(s.get("wins") or 0),
        ])
    table(["#", "Constructor", "Pts", "Wins"], rows,
          aligns=[">", "<", ">", ">"])

    section(f"DPI v3 leaderboard")
    rows = []
    ranked = sorted(dpi["drivers"], key=lambda x: -(x.get("shrunkOverall") or 0))
    for i, d in enumerate(ranked, 1):
        rows.append([
            fmt_pos(i),
            bold(driver_name(d["driverId"])),
            muted(team_name(d["team"]) or "—"),
            fmt_score(d.get("meanQuali")),
            fmt_score(d.get("meanRaceAdj")),
            fmt_score(d.get("meanFinish")),
            fmt_score(d.get("meanOverallAdj")),
            fmt_score(d.get("shrunkOverall")),
            f"{d.get('qualiElo'):>4.0f}" if d.get("qualiElo") else muted(" —"),
        ])
    table(["#", "Driver", "Team", "Q", "Race", "Fin", "Overall", "Shrunk", "qElo"],
          rows, aligns=[">", "<", "<", ">", ">", ">", ">", ">", ">"])


def cmd_race(args):
    season = load_season(args.year)
    race = next((r for r in season["races"] if r["round"] == args.round), None)
    if not race:
        die(f"No race in {args.year} round {args.round}")
    dpi = load_dpi(args.year)
    dpi_race = next((r for r in dpi["races"] if r["round"] == args.round), None)
    dpi_entries = {e["driverId"]: e for e in (dpi_race["entries"] if dpi_race else [])}

    banner(race["name"], f"R{race['round']} · {race['date']}")

    section("Race results")
    rows = []
    for r in race["results"]:
        rows.append([
            color(r.get("positionText") or "—",
                  pos_color(r["position"]) if r.get("position") in (1, 2, 3) else WHITE),
            bold(driver_name(r["driverId"])),
            muted(team_name(r["constructorId"]) or "—"),
            f"{r.get('grid') or '—':>3}",
            f"{r.get('laps') or '—':>3}",
            r.get("time") or r.get("gap") or muted(r.get("status") or "—"),
            f"{r.get('points') or 0}",
            "⚡" if r.get("fastestLap") else " ",
        ])
    table(["#", "Driver", "Team", "Grid", "Laps", "Time / Status", "Pts", "FL"],
          rows, aligns=[">", "<", "<", ">", ">", "<", ">", "^"])

    if race["qualifying"]:
        section("Qualifying")
        rows = []
        for q in race["qualifying"][:20]:
            rows.append([
                color(q.get("positionText") or "—",
                      pos_color(q["position"]) if q.get("position") in (1, 2, 3) else WHITE),
                bold(driver_name(q["driverId"])),
                muted(team_name(q["constructorId"]) or "—"),
                q.get("q1") or "—",
                q.get("q2") or "—",
                q.get("q3") or "—",
            ])
        table(["#", "Driver", "Team", "Q1", "Q2", "Q3"], rows,
              aligns=[">", "<", "<", ">", ">", ">"])

    if dpi_race:
        section("DPI breakdown")
        rows = []
        for e in sorted(dpi_race["entries"], key=lambda x: -(x.get("overallAdj") or x.get("overall") or 0)):
            ov = e.get("overallAdj") or e.get("overall")
            grid_fin = (f"P{e['grid']}→P{e['finish']}" if e.get("grid") and e.get("finish") else "—")
            d_q = f"{e['qualiDelta']:+.2f}%" if e.get("qualiDelta") is not None else "—"
            rows.append([
                bold(driver_name(e["driverId"])),
                muted(team_name(e["team"]) or "—"),
                d_q,
                fmt_score(e.get("qualiRating")),
                grid_fin,
                fmt_score(e.get("racecraftAdj")),
                fmt_score(e.get("finishRating")),
                muted(e.get("statusKind") or "—"),
                fmt_score(ov),
            ])
        table(["Driver", "Team", "Q Δ", "Q rate", "Grid→Fin", "Race", "Finish", "Status", "Overall"],
              rows, aligns=["<", "<", ">", ">", "^", ">", ">", "<", ">"])


def cmd_driver(args):
    did = resolve_driver(args.query)
    if not did:
        die(f"No driver matching '{args.query}'")
    d = drivers()[did]
    all_dpi = load("dpi/all.json")
    my_dpi = next((x for x in all_dpi if x["driverId"] == did), None)

    banner(d.get("fullName") or d.get("name"),
           f"{(d.get('nationality') or '').upper()}  ·  "
           f"{'#' + str(d['permanentNumber']) if d.get('permanentNumber') else ''}")

    section("Career")
    kv("Race starts", str(d.get("totalRaceStarts") or "—"))
    kv("Wins", str(d.get("totalRaceWins") or "—"))
    kv("Podiums", str(d.get("totalPodiums") or "—"))
    kv("Pole positions", str(d.get("totalPolePositions") or "—"))
    kv("Career points", str(d.get("totalPoints") or "—"))
    kv("Championships", str(d.get("totalChampionshipWins") or "—"))
    kv("Best champ pos", str(d.get("bestChampionshipPosition") or "—"))

    if my_dpi:
        section("Driver Performance Index v3")
        kv("Shrunk DPI", fmt_score(my_dpi.get("shrunkOverall"), 6))
        kv("Best 75% DPI", fmt_score(my_dpi.get("best75Overall"), 6))
        kv("Mean Quali", fmt_score(my_dpi.get("meanQuali"), 6))
        kv("Mean Race", fmt_score(my_dpi.get("meanRace"), 6))
        kv("Mean Finish", fmt_score(my_dpi.get("meanFinish"), 6))
        kv("Quali Elo", color(f"{my_dpi.get('qualiElo'):.0f}", BLUE)
           if my_dpi.get("qualiElo") else muted("—"))
        kv("Race Elo", color(f"{my_dpi.get('raceElo'):.0f}", BLUE)
           if my_dpi.get("raceElo") else muted("—"))
        kv("DSC", fmt_score(my_dpi.get("meanDsc"), 6))

        section("Season-by-season")
        rows = []
        for s in my_dpi["seasons"]:
            rows.append([
                bold(str(s["year"])),
                muted(team_name(s["team"]) or "—"),
                str(s["races"]),
                fmt_score(s.get("meanQuali")),
                fmt_score(s.get("meanRace")),
                fmt_score(s.get("meanFinish")),
                fmt_score(s.get("shrunkOverall")),
                f"{s.get('qualiElo'):>4.0f}" if s.get("qualiElo") else muted(" —"),
            ])
        table(["Year", "Team", "R", "Q", "Race", "Fin", "DPI", "qElo"], rows,
              aligns=["<", "<", ">", ">", ">", ">", ">", ">"])


def cmd_team(args):
    cid = resolve_constructor(args.query)
    if not cid:
        die(f"No constructor matching '{args.query}'")
    c = constructors()[cid]
    banner(c.get("fullName") or c.get("name"), c.get("country", "").upper())
    section("Career")
    kv("Race entries", str(c.get("totalRaceEntries") or "—"))
    kv("Race starts", str(c.get("totalRaceStarts") or "—"))
    kv("Wins", str(c.get("totalRaceWins") or "—"))
    kv("Podiums", str(c.get("totalPodiums") or "—"))
    kv("Pole positions", str(c.get("totalPolePositions") or "—"))
    kv("Championships", str(c.get("totalChampionshipWins") or "—"))
    kv("Career points", str(c.get("totalPoints") or "—"))
    kv("Best champ pos", str(c.get("bestChampionshipPosition") or "—"))


def cmd_dpi(args):
    if args.year_or_all == "all":
        all_dpi = load("dpi/all.json")
        min_races = args.min or 50
        filtered = sorted(
            [d for d in all_dpi if (d.get("totalRaces") or 0) >= min_races
             and d.get("shrunkOverall") is not None],
            key=lambda x: -x["shrunkOverall"])[:args.top or 30]
        banner(f"All-time DPI top {len(filtered)}",
               f"min {min_races} races · v3")
        rows = []
        for i, d in enumerate(filtered, 1):
            rows.append([
                fmt_pos(i),
                bold(driver_name(d["driverId"])),
                str(d["totalRaces"]),
                fmt_score(d.get("meanQuali")),
                fmt_score(d.get("meanRace")),
                fmt_score(d.get("meanFinish")),
                fmt_score(d.get("shrunkOverall")),
                f"{d.get('qualiElo'):>4.0f}" if d.get("qualiElo") else muted(" —"),
            ])
        table(["#", "Driver", "R", "Quali", "Race", "Finish", "DPI", "qElo"],
              rows, aligns=[">", "<", ">", ">", ">", ">", ">", ">"])
        return

    year = int(args.year_or_all)
    args.year = year
    cmd_season(args)


def cmd_elo(args):
    all_dpi = load("dpi/all.json")
    min_races = args.min or 50
    filtered = sorted(
        [d for d in all_dpi if (d.get("totalRaces") or 0) >= min_races
         and d.get("qualiElo")],
        key=lambda x: -x["qualiElo"])[:args.top or 30]
    banner(f"All-time qualifying Elo", f"min {min_races} races")
    rows = []
    for i, d in enumerate(filtered, 1):
        rows.append([
            fmt_pos(i),
            bold(driver_name(d["driverId"])),
            str(d["totalRaces"]),
            color(f"{d['qualiElo']:.0f}", BLUE),
            color(f"{d['raceElo']:.0f}", MAGENTA) if d.get("raceElo") else muted("—"),
            fmt_score(d.get("shrunkOverall")),
        ])
    table(["#", "Driver", "R", "qElo", "rElo", "DPI"], rows,
          aligns=[">", "<", ">", ">", ">", ">"])


def cmd_compare(args):
    a_id = resolve_driver(args.a)
    b_id = resolve_driver(args.b)
    if not a_id or not b_id:
        die(f"Could not resolve drivers")
    a, b = drivers()[a_id], drivers()[b_id]
    all_dpi = load("dpi/all.json")
    da = next((x for x in all_dpi if x["driverId"] == a_id), {})
    db = next((x for x in all_dpi if x["driverId"] == b_id), {})

    banner(f"{a.get('fullName') or a.get('name')}  vs  {b.get('fullName') or b.get('name')}")

    def row(label, va, vb, fmt=str, higher_wins=True):
        if va is None and vb is None:
            sa, sb = "—", "—"
        else:
            sa = fmt(va) if va is not None else "—"
            sb = fmt(vb) if vb is not None else "—"
            if va is not None and vb is not None:
                if higher_wins:
                    if va > vb: sa = f"{BOLD}{GREEN}{sa}{RESET}"
                    if vb > va: sb = f"{BOLD}{GREEN}{sb}{RESET}"
                else:
                    if va < vb: sa = f"{BOLD}{GREEN}{sa}{RESET}"
                    if vb < va: sb = f"{BOLD}{GREEN}{sb}{RESET}"
        print(f"  {pad(sa, 18, '>')}   {muted(pad(label, 24, '^'))}   {sb}")

    section("Career")
    row("Race starts", a.get("totalRaceStarts"), b.get("totalRaceStarts"))
    row("Wins", a.get("totalRaceWins"), b.get("totalRaceWins"))
    row("Podiums", a.get("totalPodiums"), b.get("totalPodiums"))
    row("Pole positions", a.get("totalPolePositions"), b.get("totalPolePositions"))
    row("Career points", a.get("totalPoints"), b.get("totalPoints"))
    row("Championships", a.get("totalChampionshipWins"), b.get("totalChampionshipWins"))
    row("Best champ pos", a.get("bestChampionshipPosition"),
        b.get("bestChampionshipPosition"), higher_wins=False)

    section("DPI v3")
    row("Shrunk DPI", da.get("shrunkOverall"), db.get("shrunkOverall"),
        lambda v: f"{v:.1f}")
    row("Best 75% DPI", da.get("best75Overall"), db.get("best75Overall"),
        lambda v: f"{v:.1f}")
    row("Mean Quali", da.get("meanQuali"), db.get("meanQuali"),
        lambda v: f"{v:.1f}")
    row("Mean Race", da.get("meanRace"), db.get("meanRace"),
        lambda v: f"{v:.1f}")
    row("Mean Finish", da.get("meanFinish"), db.get("meanFinish"),
        lambda v: f"{v:.1f}")
    row("Quali Elo", da.get("qualiElo"), db.get("qualiElo"),
        lambda v: f"{v:.0f}")
    row("Race Elo", da.get("raceElo"), db.get("raceElo"),
        lambda v: f"{v:.0f}")
    row("DSC", da.get("meanDsc"), db.get("meanDsc"),
        lambda v: f"{v:.1f}")


def cmd_search(args):
    q = args.query.lower()
    drv = []
    for did, d in drivers().items():
        hay = f"{d.get('fullName','')} {d.get('name','')} {d.get('lastName','')}".lower()
        if q in hay:
            drv.append((d.get("totalRaceStarts") or 0, did, d))
    drv.sort(reverse=True)

    cst = []
    for cid, c in constructors().items():
        hay = f"{c.get('fullName','')} {c.get('name','')}".lower()
        if q in hay:
            cst.append((c.get("totalRaceWins") or 0, cid, c))
    cst.sort(reverse=True)

    banner(f"Search: {args.query}",
           f"{len(drv)} drivers · {len(cst)} constructors")

    if drv:
        section("Drivers")
        rows = []
        for _, did, d in drv[:15]:
            rows.append([
                muted(did),
                bold(d.get("fullName") or d.get("name")),
                (d.get("nationality") or "").upper(),
                str(d.get("totalRaceStarts") or 0),
                str(d.get("totalRaceWins") or 0),
                str(d.get("totalChampionshipWins") or 0),
            ])
        table(["id", "Name", "Nat", "Starts", "Wins", "Titles"], rows,
              aligns=["<", "<", "<", ">", ">", ">"])

    if cst:
        section("Teams")
        rows = []
        for _, cid, c in cst[:10]:
            rows.append([
                muted(cid),
                bold(c.get("fullName") or c.get("name")),
                (c.get("country") or "").upper(),
                str(c.get("totalRaceWins") or 0),
                str(c.get("totalChampionshipWins") or 0),
            ])
        table(["id", "Name", "Country", "Wins", "Titles"], rows,
              aligns=["<", "<", "<", ">", ">"])


# ── Argparse wiring ───────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        prog="f1",
        description="F1stats CLI — pretty colored Formula 1 stats from 1950 to today.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd")

    sp = sub.add_parser("home", help="latest season dashboard")
    sp.set_defaults(func=cmd_home)

    sp = sub.add_parser("seasons", help="list all seasons")
    sp.set_defaults(func=cmd_seasons)

    sp = sub.add_parser("schedule", help="race schedule")
    sp.add_argument("year", nargs="?", type=int)
    sp.set_defaults(func=cmd_schedule)

    sp = sub.add_parser("season", help="season standings + DPI")
    sp.add_argument("year", type=int)
    sp.set_defaults(func=cmd_season)

    sp = sub.add_parser("race", help="race detail")
    sp.add_argument("year", type=int)
    sp.add_argument("round", type=int)
    sp.set_defaults(func=cmd_race)

    sp = sub.add_parser("driver", help="driver profile")
    sp.add_argument("query", help="driver id or name")
    sp.set_defaults(func=cmd_driver)

    sp = sub.add_parser("team", help="constructor profile")
    sp.add_argument("query", help="team id or name")
    sp.set_defaults(func=cmd_team)

    sp = sub.add_parser("dpi", help="DPI leaderboard")
    sp.add_argument("year_or_all", help="year (e.g. 2025) or 'all'")
    sp.add_argument("--min", type=int, help="min races for all-time", default=50)
    sp.add_argument("--top", type=int, help="rows to show", default=30)
    sp.set_defaults(func=cmd_dpi)

    sp = sub.add_parser("elo", help="all-time qualifying Elo top")
    sp.add_argument("--min", type=int, default=50)
    sp.add_argument("--top", type=int, default=30)
    sp.set_defaults(func=cmd_elo)

    sp = sub.add_parser("compare", help="head-to-head two drivers")
    sp.add_argument("a", help="driver A id or name")
    sp.add_argument("b", help="driver B id or name")
    sp.set_defaults(func=cmd_compare)

    sp = sub.add_parser("search", help="search drivers + teams")
    sp.add_argument("query")
    sp.set_defaults(func=cmd_search)

    args = p.parse_args()
    if not args.cmd:
        cmd_home(args)
    else:
        args.func(args)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except KeyboardInterrupt:
        sys.exit(130)
