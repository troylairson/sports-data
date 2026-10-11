// Shared helpers for the draft concept: round classes, labels, tooltip.

export const ROUND_CLASSES = [
  { key: "r1", label: "1st round", test: (r) => r === 1 },
  { key: "r2", label: "2nd round", test: (r) => r === 2 },
  { key: "r3", label: "3rd round", test: (r) => r === 3 },
  { key: "r4", label: "4th–7th round", test: (r) => r >= 4 },
  { key: "udfa", label: "Undrafted", test: (r) => r == null },
];

export const roundKey = (round) => ROUND_CLASSES.find((c) => c.test(round)).key;
export const roundOrder = (round) => (round == null ? 8 : round);

export const PLAYOFF_SHORT = ["", "Wild card", "Divisional", "Conf. title", "Lost S.B.", "Won S.B."];
export const PLAYOFF_LONG = [
  "Missed playoffs",
  "Lost in wild-card round",
  "Lost in divisional round",
  "Lost conference title game",
  "Lost Super Bowl",
  "Won Super Bowl",
];

export const NICKNAMES = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers",
  CHI: "Bears", CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos",
  DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars",
  KC: "Chiefs", LA: "Rams", LAC: "Chargers", LV: "Raiders", MIA: "Dolphins",
  MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants", NYJ: "Jets",
  PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", TB: "Buccaneers",
  TEN: "Titans", WAS: "Commanders",
};

export const record = (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function draftText(p) {
  if (p.round == null) return "Undrafted";
  const by = p.homegrown ? "this team" : NICKNAMES[normalize(p.draftTeam)] || p.draftTeam;
  const pick = p.pick ? `, No. ${p.pick} overall` : " (supplemental)";
  return `${ordinal(p.round)} round${pick}, ${p.draftYear}, by ${by}`;
}

const RELOCATED = { OAK: "LV", SD: "LAC", STL: "LA" };
export const normalize = (code) => RELOCATED[code] || code;

export const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;

/** Pearson correlation. */
export function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, intercept: my - (sxy / sxx) * mx };
}

/** One tooltip per chart container. */
export function makeTip(container) {
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "status");
  container.appendChild(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.style.opacity = "1";
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      let left = x + 14;
      if (left + tw > cw) left = Math.max(0, x - tw - 14);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() {
      tip.style.opacity = "0";
    },
  };
}
