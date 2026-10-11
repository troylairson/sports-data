// Derived figures for the draft concept. Used at build time (for the copy) and
// in the browser (for the charts), so the text always matches the data.
import { ROUND_CLASSES, pearson, roundKey } from "./draft.js";

export const allTeams = (data) => data.seasons.flatMap((s) => s.teams.map((t) => ({ ...t, season: s.season })));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}

export function roundShares(teams) {
  const counts = Object.fromEntries(ROUND_CLASSES.map((c) => [c.key, 0]));
  let n = 0;
  for (const t of teams) {
    for (const p of t.starters) {
      counts[roundKey(p.round)]++;
      n++;
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / n]));
}

export const POSITION_LABELS = {
  QB: "Quarterback", OL: "Offensive line", WR: "Wide receiver", TE: "Tight end", RB: "Running back",
  DL: "Defensive line", LB: "Linebacker", CB: "Cornerback", S: "Safety",
};

export function positionFirstRound(teams) {
  const acc = {};
  for (const t of teams) {
    for (const p of t.starters) {
      const a = (acc[p.group] ??= { a1: 0, an: 0, b1: 0, bn: 0 });
      if (t.playoff > 0) { a.a1 += p.round === 1; a.an++; } else { a.b1 += p.round === 1; a.bn++; }
    }
  }
  return Object.entries(acc)
    .filter(([g]) => POSITION_LABELS[g])
    .map(([g, v]) => ({ group: g, label: POSITION_LABELS[g], a: v.a1 / v.an, b: v.b1 / v.bn, na: v.an, nb: v.bn }))
    .sort((x, y) => y.a - x.a);
}

export function summarize(data) {
  const teams = allTeams(data);
  const win = teams.map((t) => t.winPct);
  const capital = pearson(teams.map((t) => t.summary.capital), win);
  const firstRound = pearson(teams.map((t) => t.summary.firstRoundShare), win);
  const homegrown = pearson(teams.map((t) => t.summary.homegrownShare), win);

  const hg = teams.map((t) => t.summary.homegrownShare);
  const q1 = quantile(hg, 0.25);
  const q3 = quantile(hg, 0.75);
  const top = teams.filter((t) => t.summary.homegrownShare >= q3);
  const bottom = teams.filter((t) => t.summary.homegrownShare <= q1);
  const playoffRate = (ts) => ts.filter((t) => t.playoff > 0).length / ts.length;

  const champs = teams.filter((t) => t.playoff === 5);
  const missed = teams.filter((t) => t.playoff === 0);
  const made = teams.filter((t) => t.playoff > 0);

  const qbs = (ts) => ts.flatMap((t) => t.starters.filter((p) => p.pos === "QB"));
  const firstRoundQB = (ts) => mean(qbs(ts).map((p) => (p.round === 1 ? 1 : 0)));

  const bySeason = data.seasons.map((s) => ({
    season: s.season,
    udfa: roundShares(s.teams).udfa,
  }));

  return {
    n: teams.length,
    starters: teams.length * 22,
    seasons: data.meta.seasons,
    r: { capital: capital.r, firstRound: firstRound.r, homegrown: homegrown.r },
    homegrown: {
      mean: mean(hg),
      q1, q3,
      topRate: playoffRate(top),
      bottomRate: playoffRate(bottom),
      overallRate: playoffRate(teams),
    },
    shares: {
      champs: roundShares(champs),
      made: roundShares(made),
      missed: roundShares(missed),
    },
    qb: { made: firstRoundQB(made), missed: firstRoundQB(missed) },
    bySeason,
    champs,
  };
}
