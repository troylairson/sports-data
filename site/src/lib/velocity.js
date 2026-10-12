// Helpers and derived figures for the velocity concept. Used at build time
// (for the copy) and in the browser (for the charts).
import { pearson } from "./draft.js";

export const NICKNAMES = {
  108: "Angels", 109: "Diamondbacks", 110: "Orioles", 111: "Red Sox", 112: "Cubs",
  113: "Reds", 114: "Guardians", 115: "Rockies", 116: "Tigers", 117: "Astros",
  118: "Royals", 119: "Dodgers", 120: "Nationals", 121: "Mets", 133: "Athletics",
  134: "Pirates", 135: "Padres", 136: "Mariners", 137: "Giants", 138: "Cardinals",
  139: "Rays", 140: "Rangers", 141: "Blue Jays", 142: "Twins", 143: "Phillies",
  144: "Braves", 145: "White Sox", 146: "Marlins", 147: "Yankees", 158: "Brewers",
};

export const PLAYOFF_SHORT = ["", "Wild card", "Division", "L.C.S.", "Lost W.S.", "Won W.S."];

export const slug = (t) => t.abbr.toLowerCase();
export const record = (t) => `${t.wins}-${t.losses}`;
export const mph = (v, digits = 1) => `${v.toFixed(digits)} mph`;
export const signed = (v, digits = 1, unit = "") => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}${unit}`;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}

/** Every team-season, with velocity relative to that season's league average. */
export function allTeams(data) {
  return data.seasons.flatMap((s) => s.teams.map((t) => ({ ...t, season: s.season, rel: t.ff - s.league.ff })));
}

/** Every qualifying pitcher-season, with velocity relative to the league average for his role that season. */
export function allPitchers(data) {
  return data.seasons.flatMap((s) =>
    s.pitchers.map((p) => ({ ...p, season: s.season, rel: p.ff - (p.role === "SP" ? s.league.ffSP : s.league.ffRP) })),
  );
}

export const YOY_BANDS = [
  { label: "Lost 1.5+ mph", test: (d) => d < -1.5 },
  { label: "Lost 0.5–1.5", test: (d) => d >= -1.5 && d < -0.5 },
  { label: "Within 0.5", test: (d) => d >= -0.5 && d <= 0.5 },
  { label: "Gained 0.5–1.5", test: (d) => d > 0.5 && d <= 1.5 },
  { label: "Gained 1.5+ mph", test: (d) => d > 1.5 },
];

export function yoyBands(pairs, key) {
  return YOY_BANDS.map((b) => {
    const g = pairs.filter((p) => b.test(p.dFF));
    return { label: b.label, v: g.length ? mean(g.map((p) => p[key])) : 0, n: g.length };
  });
}

export function summarize(data) {
  const L = data.seasons.map((s) => s.league);
  const first = L[0];
  const last = L[L.length - 1];

  const pitchers = allPitchers(data);
  const byRole = (role) => pitchers.filter((p) => p.role === role);
  const r = (ps, key) => pearson(ps.map((p) => p.rel), ps.map((p) => p[key])).r;
  const sp = byRole("SP");
  const rp = byRole("RP");

  const teams = allTeams(data);
  const teamR = pearson(teams.map((t) => t.rel), teams.map((t) => t.winPct)).r;
  const teamRA = pearson(teams.map((t) => t.rel), teams.map((t) => t.raPerGame)).r;
  const q1 = quantile(teams.map((t) => t.rel), 0.25);
  const q3 = quantile(teams.map((t) => t.rel), 0.75);
  const rate = (ts) => ts.filter((t) => t.playoff > 0).length / ts.length;
  const fast = teams.filter((t) => t.rel >= q3);
  const slow = teams.filter((t) => t.rel <= q1);

  // Where each champion ranked in staff velocity that season (1 = hardest-throwing).
  const champs = data.seasons.map((s) => {
    const c = s.teams.find((t) => t.playoff === 5);
    const rank = [...s.teams].sort((a, b) => b.ff - a.ff).findIndex((t) => t.id === c.id) + 1;
    return { season: s.season, id: c.id, ff: c.ff, rank };
  });

  // Fastest vs. slowest quarter of starters, by velocity relative to the league.
  const spSorted = [...sp].sort((a, b) => a.rel - b.rel);
  const qn = Math.floor(spSorted.length / 4);
  const spGroup = (g) => ({
    era: mean(g.map((p) => p.era)),
    k: mean(g.map((p) => p.k)),
    w: mean(g.map((p) => p.w)),
    ip: mean(g.map((p) => p.ip)),
  });
  const spQuartiles = { slow: spGroup(spSorted.slice(0, qn)), fast: spGroup(spSorted.slice(-qn)) };

  const pairs = data.yoy;
  const bands = { k: yoyBands(pairs, "dK"), era: yoyBands(pairs, "dERA"), xera: yoyBands(pairs, "dXERA") };

  return {
    first, last,
    gain: last.ff - first.ff,
    perYear: (last.ff - first.ff) / (last.season - first.season),
    pitchers: {
      n: pitchers.length,
      sp: { n: sp.length, k: r(sp, "k"), era: r(sp, "era"), xera: r(sp, "xera"), w: r(sp, "w"), quartiles: spQuartiles },
      rp: { n: rp.length, k: r(rp, "k"), era: r(rp, "era"), xera: r(rp, "xera") },
    },
    teams: {
      n: teams.length,
      r: teamR,
      rRA: teamRA,
      fastRate: rate(fast),
      slowRate: rate(slow),
      overallRate: rate(teams),
      q1, q3,
    },
    champs,
    yoy: { n: pairs.length, bands },
  };
}
