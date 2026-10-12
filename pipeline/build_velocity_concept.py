"""Build the data for the "Is velocity winning?" concept.

For each MLB season from FIRST_SEASON to LAST_SEASON this script collects:

  1. four-seam fastball velocity for the league, each team's staff and each
     pitcher, plus the full distribution of pitch speeds (Baseball Savant);
  2. each pitcher's season results: innings, ERA, expected ERA, strikeout and
     walk rates, wins and losses (Baseball Savant custom leaderboard);
  3. each team's record, runs allowed and playoff result (MLB Stats API).

Regular-season games only. Responses are cached in pipeline/.cache/velocity/.

Usage:
    python pipeline/build_velocity_concept.py [--first 2016] [--last 2025]
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / ".cache" / "velocity"
OUT = ROOT / "site" / "src" / "data" / "velocity.json"

SAVANT = "https://baseballsavant.mlb.com"
STATSAPI = "https://statsapi.mlb.com/api/v1"

FIRST_SEASON = 2016
LAST_SEASON = 2025

# Speed bins (mph) for the distribution: [lo, hi). Savant reports speeds to 0.1 mph,
# so bin edges are offset by 0.05 to avoid boundary ambiguity.
BIN_EDGES = [0] + list(range(85, 103)) + [200]

# Thresholds for the pitcher-level analysis, for a 162-game season. Both are
# scaled down for shorter seasons (2020 was 60 games).
MIN_FF_PITCHES = 200  # four-seamers in the season
MIN_IP = {"SP": 80, "RP": 30}

PLAYOFF_ROUNDS = {"F": 1, "D": 2, "L": 3, "W": 4}
PLAYOFF_LABELS = [
    "Missed playoffs", "Lost wild-card round", "Lost division series",
    "Lost league championship", "Lost World Series", "Won World Series",
]


# --------------------------------------------------------------------------- fetch

def fetch(url: str, name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists():
        return path.read_bytes()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "sports-data-desk/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            path.write_bytes(body)
            time.sleep(0.2)
            return body
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {name}: {e}", file=sys.stderr)
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("unreachable")


def read_csv(body: bytes) -> list[dict]:
    return list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))


def statcast(season: int, group_by: str, name: str, **extra) -> list[dict]:
    """Aggregated Statcast search over regular-season four-seam fastballs."""
    params = {
        "all": "true", "hfPT": "FF|", "hfGT": "R|", "hfSea": f"{season}|",
        "player_type": "pitcher", "group_by": group_by,
        "min_pitches": "0", "min_results": "0", "sort_col": "pitches", "sort_order": "desc",
    } | extra
    url = f"{SAVANT}/statcast_search/csv?{urllib.parse.urlencode(params)}"
    return read_csv(fetch(url, f"{name}.csv"))


def pitcher_leaderboard(season: int) -> list[dict]:
    fields = "p_formatted_ip,k_percent,bb_percent,p_era,xera,p_win,p_loss,pitch_count,p_game,p_starting_p,ff_avg_speed,n_ff_formatted"
    url = f"{SAVANT}/leaderboard/custom?year={season}&type=pitcher&filter=&min=1&selections={fields}&csv=true"
    return read_csv(fetch(url, f"pitchers_{season}.csv"))


def standings(season: int) -> list[dict]:
    url = f"{STATSAPI}/standings?leagueId=103,104&season={season}&standingsTypes=regularSeason"
    data = json.loads(fetch(url, f"standings_{season}.json"))
    return [tr for rec in data["records"] for tr in rec["teamRecords"]]


def team_names(season: int) -> dict[int, str]:
    url = f"{STATSAPI}/teams?sportId=1&season={season}"
    data = json.loads(fetch(url, f"teams_{season}.json"))
    return {t["id"]: t["name"] for t in data["teams"]}


def postseason(season: int) -> dict[int, int]:
    """team id -> playoff result (1 = lost first round ... 5 = won World Series)."""
    url = f"{STATSAPI}/schedule/postseason/series?season={season}&sportId=1"
    data = json.loads(fetch(url, f"postseason_{season}.json"))
    result: dict[int, int] = {}
    for s in data.get("series", []):
        rnd = PLAYOFF_ROUNDS.get(s["series"]["id"].split("_")[0])
        if rnd is None:
            continue
        last = s["games"][-1]["teams"]
        for side in ("home", "away"):
            tid = last[side]["team"]["id"]
            won = bool(last[side].get("isWinner"))
            reached = rnd + (1 if rnd == 4 and won else 0)
            if not won or rnd == 4:
                result[tid] = max(result.get(tid, 0), reached)
    return result


# --------------------------------------------------------------------------- helpers

def num(x, cast=float):
    try:
        return cast(x)
    except (TypeError, ValueError):
        return None


def innings(ip: str) -> float:
    """'63.1' (63 and one-third) -> 63.333."""
    whole, _, frac = str(ip).partition(".")
    return int(whole or 0) + int(frac or 0) / 3


def weighted_avg(pairs):
    pairs = [(v, w) for v, w in pairs if v is not None and w]
    total = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / total if total else None


# --------------------------------------------------------------------------- build

def build_season(season: int) -> dict:
    print(f"season {season}", file=sys.stderr)

    team_rows = statcast(season, "team", f"team_{season}")
    abbr = {int(r["player_id"]): r["player_name"] for r in team_rows}

    # Distribution of four-seam speeds, per team, by 1-mph bin.
    bins = list(zip(BIN_EDGES[:-1], BIN_EDGES[1:]))

    def bin_query(b):
        lo, hi = b
        rows = statcast(
            season, "team", f"bin_{season}_{lo}",
            metric_1="api_p_release_speed", metric_1_gt=f"{lo - 0.05:.2f}", metric_1_lt=f"{hi - 0.05:.2f}",
        )
        return {int(r["player_id"]): int(r["pitches"]) for r in rows}

    def team_pitchers(tid):
        return tid, statcast(season, "name", f"staff_{season}_{abbr[tid]}", hfTeam=f"{abbr[tid]}|")

    with ThreadPoolExecutor(max_workers=4) as pool:
        bin_counts = list(pool.map(bin_query, bins))
        staffs = dict(pool.map(team_pitchers, abbr))

    # Pitcher season results.
    pitchers = []
    for r in pitcher_leaderboard(season):
        games, starts = num(r["p_game"], int) or 0, num(r["p_starting_p"], int) or 0
        pitch_count = num(r["pitch_count"], int) or 0
        ff_share = (num(r["n_ff_formatted"]) or 0) / 100
        pitchers.append({
            "id": int(r["player_id"]),
            "name": " ".join(reversed(r["last_name, first_name"].split(", "))),
            "role": "SP" if games and starts / games >= 0.5 else "RP",
            "ip": round(innings(r["p_formatted_ip"]), 1),
            "era": num(r["p_era"]), "xera": num(r["xera"]),
            "k": num(r["k_percent"]), "bb": num(r["bb_percent"]),
            "w": num(r["p_win"], int) or 0, "l": num(r["p_loss"], int) or 0,
            "ff": num(r["ff_avg_speed"]), "ffN": round(pitch_count * ff_share),
        })

    # Team records and playoffs.
    playoffs = postseason(season)
    records = {tr["team"]["id"]: tr for tr in standings(season)}
    names = team_names(season)

    teams = []
    for tid, row in ((int(r["player_id"]), r) for r in team_rows):
        rec = records[tid]
        hist = [bc.get(tid, 0) for bc in bin_counts]
        n = int(row["pitches"])
        staff = sorted(
            (
                {"id": int(p["player_id"]), "name": " ".join(reversed(p["player_name"].split(", "))),
                 "n": int(p["pitches"]), "ff": num(p["velocity"])}
                for p in staffs[tid]
            ),
            key=lambda p: -p["n"],
        )
        teams.append({
            "id": tid,
            "abbr": abbr[tid],
            "seasonName": names[tid],
            "wins": rec["wins"], "losses": rec["losses"],
            "winPct": round(rec["wins"] / (rec["wins"] + rec["losses"]), 4),
            "runsAllowed": rec["runsAllowed"], "runsScored": rec["runsScored"],
            "raPerGame": round(rec["runsAllowed"] / (rec["wins"] + rec["losses"]), 3),
            "playoff": playoffs.get(tid, 0),
            "ff": num(row["velocity"]),
            "ffN": n,
            "share95": round(sum(h for (lo, _), h in zip(bins, hist) if lo >= 95) / n, 4),
            "hist": hist,
            "staff": [p for p in staff if p["n"] >= 25],
        })
    assert len(teams) == 30, (season, len(teams))

    league_hist = [sum(t["hist"][i] for t in teams) for i in range(len(bins))]
    league_n = sum(t["ffN"] for t in teams)
    # Bins should account for (nearly) every four-seamer; a few lack a speed reading.
    assert sum(league_hist) <= league_n and sum(league_hist) > 0.99 * league_n, (season, sum(league_hist), league_n)

    by_role = {
        role: weighted_avg((p["ff"], p["ffN"]) for p in pitchers if p["role"] == role)
        for role in ("SP", "RP")
    }
    ip_by_role = {role: sum(p["ip"] for p in pitchers if p["role"] == role) for role in ("SP", "RP")}

    league = {
        "season": season,
        "ff": round(weighted_avg((t["ff"], t["ffN"]) for t in teams), 2),
        "ffN": league_n,
        "hist": league_hist,
        "share95": round(sum(h for (lo, _), h in zip(bins, league_hist) if lo >= 95) / sum(league_hist), 4),
        "share98": round(sum(h for (lo, _), h in zip(bins, league_hist) if lo >= 98) / sum(league_hist), 4),
        "share100": round(sum(h for (lo, _), h in zip(bins, league_hist) if lo >= 100) / sum(league_hist), 4),
        "ffSP": round(by_role["SP"], 2),
        "ffRP": round(by_role["RP"], 2),
        "reliefShareIP": round(ip_by_role["RP"] / (ip_by_role["SP"] + ip_by_role["RP"]), 4),
    }

    scale = max(t["wins"] + t["losses"] for t in teams) / 162
    qualified = [
        p for p in pitchers
        if p["ff"] is not None and p["era"] is not None
        and p["ffN"] >= MIN_FF_PITCHES * scale and p["ip"] >= MIN_IP[p["role"]] * scale
    ]
    return {"league": league, "teams": teams, "pitchers": qualified}


def year_over_year(seasons: list[dict]) -> list[dict]:
    """Same pitcher, same role, consecutive qualifying seasons."""
    by_key = {(p["id"], s["league"]["season"]): p for s in seasons for p in s["pitchers"]}
    pairs = []
    for (pid, season), b in by_key.items():
        a = by_key.get((pid, season - 1))
        if not a or a["role"] != b["role"] or None in (a["xera"], b["xera"], a["k"], b["k"]):
            continue
        pairs.append({
            "id": pid, "name": b["name"], "season": season, "role": b["role"],
            "dFF": round(b["ff"] - a["ff"], 2),
            "dK": round(b["k"] - a["k"], 2),
            "dERA": round(b["era"] - a["era"], 2),
            "dXERA": round(b["xera"] - a["xera"], 2),
        })
    return pairs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", type=int, default=FIRST_SEASON)
    ap.add_argument("--last", type=int, default=LAST_SEASON)
    args = ap.parse_args()

    seasons = [build_season(y) for y in range(args.first, args.last + 1)]

    # Display names: each franchise's most recent name.
    latest = {t["id"]: t["seasonName"] for t in seasons[-1]["teams"]}
    for s in seasons:
        for t in s["teams"]:
            t["name"] = latest[t["id"]]

    data = {
        "meta": {
            "title": "Is velocity winning?",
            "seasons": [args.first, args.last],
            "generated": date.today().isoformat(),
            "source": "Baseball Savant (Statcast); MLB Stats API",
            "bins": BIN_EDGES,
            "minFF": MIN_FF_PITCHES,
            "minIP": MIN_IP,
            "playoffLabels": PLAYOFF_LABELS,
        },
        "seasons": [
            {"season": s["league"]["season"], "league": s["league"],
             "teams": sorted(s["teams"], key=lambda t: -t["winPct"]), "pitchers": s["pitchers"]}
            for s in seasons
        ],
        "yoy": year_over_year(seasons),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
