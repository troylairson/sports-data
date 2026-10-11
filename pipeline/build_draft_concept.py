"""Build the data for the "Does the draft build winners?" concept.

For each NFL team-season from FIRST_SEASON to LAST_SEASON this script:

  1. identifies the 22 starters: the 11 offensive and 11 defensive players
     with the most regular-season snaps for that team;
  2. looks up where each starter was drafted (round, pick, drafting team),
     treating anyone with no draft record as undrafted;
  3. joins the team's regular-season record and how far it went in the playoffs.

Every input is a public CSV published by nflverse:
https://github.com/nflverse/nflverse-data

Usage:
    python pipeline/build_draft_concept.py [--first 2016] [--last 2025]
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / ".cache"
OUT = ROOT / "site" / "src" / "data" / "draft-and-winning.json"
RELEASES = "https://github.com/nflverse/nflverse-data/releases/download"

FIRST_SEASON = 2016
LAST_SEASON = 2025
STARTERS_PER_SIDE = 11

# Drafts used to fit the pick-value curve: old enough that careers are mostly over.
VALUE_CURVE_DRAFTS = (2000, 2015)

# Supplemental-draft picks have no row in draft_picks.csv.
# pfr_player_id -> (draft year, round, drafting team)
SUPPLEMENTAL = {
    "ThomJa04": (2019, 5, "ARI"),  # Jalen Thompson
    "BealSa00": (2018, 3, "NYG"),  # Sam Beal
    "AlexAd00": (2018, 6, "WAS"),  # Adonis Alexander
}

# Collapse relocated franchises onto today's abbreviation.
FRANCHISE = {"OAK": "LV", "SD": "LAC", "STL": "LA"}

# draft_picks.csv uses Pro Football Reference codes; map them to nflverse codes.
PFR_TEAM = {
    "GNB": "GB", "KAN": "KC", "LVR": "LV", "NOR": "NO", "NWE": "NE",
    "SFO": "SF", "TAM": "TB", "LAR": "LA", "SDG": "LAC", "OAK": "LV", "STL": "LA",
}

TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks", "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}

POSITION_GROUP = {
    "QB": "QB", "RB": "RB", "FB": "RB", "HB": "RB",
    "WR": "WR", "TE": "TE",
    "T": "OL", "OT": "OL", "LT": "OL", "RT": "OL", "G": "OL", "OG": "OL",
    "LG": "OL", "RG": "OL", "C": "OL", "OL": "OL",
    # PFR labels 3-4 edge rushers "LB" and 4-3 ones "DE", so edge is not separable.
    "DE": "DL", "DT": "DL", "NT": "DL", "DL": "DL", "EDGE": "DL",
    "LB": "LB", "ILB": "LB", "MLB": "LB", "OLB": "LB",
    "CB": "CB", "DB": "S", "S": "S", "SS": "S", "FS": "S",
}

# How far a team went: 0 missed playoffs ... 5 won the Super Bowl.
PLAYOFF_ROUNDS = ["WC", "DIV", "CON", "SB"]
PLAYOFF_LABELS = [
    "Missed playoffs", "Lost wild card", "Lost divisional round",
    "Lost conference title", "Lost Super Bowl", "Won Super Bowl",
]


def fetch(name: str, url: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"  downloading {name}", file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    return path


def load_inputs(first: int, last: int):
    draft = pd.read_csv(fetch("draft_picks.csv", f"{RELEASES}/draft_picks/draft_picks.csv"), low_memory=False)
    games = pd.read_csv(fetch("games.csv", f"{RELEASES}/schedules/games.csv"), low_memory=False)
    snaps = pd.concat(
        pd.read_csv(fetch(f"snap_counts_{y}.csv", f"{RELEASES}/snap_counts/snap_counts_{y}.csv"))
        for y in range(first, last + 1)
    )
    rosters = pd.concat(
        pd.read_csv(fetch(f"roster_{y}.csv", f"{RELEASES}/rosters/roster_{y}.csv"), low_memory=False)
        for y in range(first, last + 1)
    )
    return draft, games, snaps, rosters


def fit_pick_value(draft: pd.DataFrame) -> tuple[float, float]:
    """Fit value = a + b*ln(pick) to the mean career value at each draft slot.

    Career value is Pro Football Reference's weighted Approximate Value. The
    curve is rescaled so the No. 1 pick is worth 100.
    """
    lo, hi = VALUE_CURVE_DRAFTS
    d = draft[(draft.season >= lo) & (draft.season <= hi)]
    mean_av = d.assign(w_av=d.w_av.fillna(0)).groupby("pick").w_av.mean()
    b, a = np.polyfit(np.log(mean_av.index.values), mean_av.values, 1)
    return 100.0, 100.0 * b / a  # value(pick) = 100 + slope*ln(pick)


def pick_value(pick, slope: float) -> float:
    if pick is None or pd.isna(pick):
        return 0.0
    return max(0.0, 100.0 + slope * np.log(pick))


def build_draft_lookup(draft: pd.DataFrame, rosters: pd.DataFrame) -> dict:
    """pfr_player_id -> {year, round, pick, team}."""
    lookup = {}
    for r in draft.dropna(subset=["pfr_player_id"]).itertuples():
        lookup[r.pfr_player_id] = {
            "year": int(r.season), "round": int(r.round), "pick": int(r.pick),
            "team": PFR_TEAM.get(r.team, r.team),
        }

    # Older draft_picks rows sometimes lack a PFR id. Fall back to the roster
    # file's draft year + overall pick, and resolve the round from draft_picks.
    by_slot = {(int(r.season), int(r.pick)): r for r in draft.itertuples()}
    rost = rosters.dropna(subset=["pfr_id", "draft_number", "rookie_year"])
    for r in rost.drop_duplicates("pfr_id").itertuples():
        if r.pfr_id in lookup:
            continue
        slot = by_slot.get((int(r.rookie_year), int(r.draft_number)))
        if slot is not None:
            lookup[r.pfr_id] = {
                "year": int(slot.season), "round": int(slot.round), "pick": int(slot.pick),
                "team": PFR_TEAM.get(slot.team, slot.team),
            }

    for pid, (year, rnd, team) in SUPPLEMENTAL.items():
        lookup[pid] = {"year": year, "round": rnd, "pick": None, "team": team, "supplemental": True}
    return lookup


def team_records(games: pd.DataFrame, first: int, last: int) -> pd.DataFrame:
    g = games[(games.season >= first) & (games.season <= last)].dropna(subset=["home_score"])
    rows = []
    for r in g.itertuples():
        for team, pf, pa in ((r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)):
            rows.append({
                "season": r.season, "team": team, "game_type": r.game_type,
                "win": pf > pa, "loss": pf < pa, "tie": pf == pa, "pf": pf, "pa": pa,
            })
    df = pd.DataFrame(rows)

    reg = df[df.game_type == "REG"].groupby(["season", "team"]).agg(
        wins=("win", "sum"), losses=("loss", "sum"), ties=("tie", "sum"),
        pf=("pf", "sum"), pa=("pa", "sum"),
    ).reset_index()

    post = df[df.game_type != "REG"].copy()
    post["depth"] = post.game_type.map({k: i + 1 for i, k in enumerate(PLAYOFF_ROUNDS)})
    # A team's playoff result is the deepest round it reached, plus one if it won that game.
    deepest = post.sort_values("depth").groupby(["season", "team"]).last().reset_index()
    deepest["playoff"] = deepest.depth + ((deepest.game_type == "SB") & deepest.win).astype(int)
    # Teams with a first-round bye show up first in the divisional round; if they
    # lost there they "lost divisional round", same as a wild-card winner.
    reg = reg.merge(deepest[["season", "team", "playoff"]], on=["season", "team"], how="left")
    reg["playoff"] = reg.playoff.fillna(0).astype(int)
    reg["made_playoffs"] = reg.playoff > 0
    reg["win_pct"] = (reg.wins + 0.5 * reg.ties) / (reg.wins + reg.losses + reg.ties)
    return reg


def pick_starters(snaps: pd.DataFrame) -> pd.DataFrame:
    reg = snaps[snaps.game_type == "REG"]
    team_games = reg.groupby(["season", "team"]).game_id.nunique().rename("team_games")
    agg = reg.groupby(["season", "team", "pfr_player_id"]).agg(
        player=("player", "first"),
        position=("position", lambda s: s.mode().iat[0]),
        offense_snaps=("offense_snaps", "sum"),
        defense_snaps=("defense_snaps", "sum"),
        games=("game_id", "nunique"),
    ).reset_index()
    # The file has no team snap totals, so approximate them per game with the
    # snaps of whoever played the most (usually the center / a safety, ~100%).
    team_snaps = reg.groupby(["season", "team", "game_id"]).agg(
        o=("offense_snaps", "max"), d=("defense_snaps", "max")
    ).groupby(["season", "team"]).sum()

    picked = []
    for side, col, total in (("O", "offense_snaps", "o"), ("D", "defense_snaps", "d")):
        ranked = agg[agg[col] > 0].sort_values(col, ascending=False)
        top = ranked.groupby(["season", "team"]).head(STARTERS_PER_SIDE).copy()
        top["side"] = side
        top["snaps"] = top[col]
        top = top.join(team_snaps[total].rename("team_side_snaps"), on=["season", "team"])
        top["snap_share"] = top.snaps / top.team_side_snaps
        picked.append(top)
    out = pd.concat(picked).join(team_games, on=["season", "team"])
    return out


def build(first: int, last: int) -> dict:
    draft, games, snaps, rosters = load_inputs(first, last)
    _, slope = fit_pick_value(draft)
    lookup = build_draft_lookup(draft, rosters)
    records = team_records(games, first, last)
    starters = pick_starters(snaps)

    seasons = []
    for season in range(first, last + 1):
        teams = []
        for rec in records[records.season == season].itertuples():
            st = starters[(starters.season == season) & (starters.team == rec.team)]
            franchise = FRANCHISE.get(rec.team, rec.team)
            players = []
            for p in st.sort_values(["side", "snaps"], ascending=[False, False]).itertuples():
                dr = lookup.get(p.pfr_player_id)
                drafted_by = dr["team"] if dr else None
                players.append({
                    "name": p.player,
                    "pos": p.position,
                    "group": POSITION_GROUP.get(p.position.split("/")[0], p.position),
                    "side": p.side,
                    "snaps": int(p.snaps),
                    "share": round(float(min(p.snap_share, 1.0)), 3),
                    "round": dr["round"] if dr else None,
                    "pick": dr["pick"] if dr else None,
                    "draftYear": dr["year"] if dr else None,
                    "draftTeam": drafted_by,
                    "homegrown": bool(drafted_by and FRANCHISE.get(drafted_by, drafted_by) == franchise),
                    "value": round(pick_value(dr["pick"] if dr else None, slope), 1),
                })
            assert len(players) == 2 * STARTERS_PER_SIDE, (season, rec.team, len(players))

            rounds = [p["round"] for p in players]
            n = len(players)
            teams.append({
                "team": rec.team,
                "franchise": franchise,
                "name": TEAM_NAMES[franchise],
                "wins": int(rec.wins), "losses": int(rec.losses), "ties": int(rec.ties),
                "winPct": round(float(rec.win_pct), 4),
                "pointDiff": int(rec.pf - rec.pa),
                "playoff": int(rec.playoff),
                "summary": {
                    "byRound": {str(k): sum(1 for r in rounds if r == k) for k in range(1, 8)}
                    | {"udfa": sum(1 for r in rounds if r is None)},
                    "firstRoundShare": round(sum(1 for r in rounds if r == 1) / n, 4),
                    "dayOneTwoShare": round(sum(1 for r in rounds if r in (1, 2, 3)) / n, 4),
                    "udfaShare": round(sum(1 for r in rounds if r is None) / n, 4),
                    "homegrownShare": round(sum(p["homegrown"] for p in players) / n, 4),
                    "capital": round(float(np.mean([p["value"] for p in players])), 2),
                },
                "starters": players,
            })
        assert len(teams) == 32, (season, len(teams))
        seasons.append({"season": season, "teams": sorted(teams, key=lambda t: -t["winPct"])})

    return {
        "meta": {
            "title": "Does the draft build winners?",
            "seasons": [first, last],
            "generated": date.today().isoformat(),
            "source": "nflverse (snap counts from Pro Football Reference; draft picks; schedules)",
            "starterRule": f"Top {STARTERS_PER_SIDE} offensive and {STARTERS_PER_SIDE} defensive players by regular-season snaps",
            "pickValue": {"intercept": 100, "slope": round(slope, 4), "fitDrafts": list(VALUE_CURVE_DRAFTS)},
            "playoffLabels": PLAYOFF_LABELS,
        },
        "seasons": seasons,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", type=int, default=FIRST_SEASON)
    ap.add_argument("--last", type=int, default=LAST_SEASON)
    args = ap.parse_args()

    data = build(args.first, args.last)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
