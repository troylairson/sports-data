import * as d3 from "d3";
import { NICKNAMES, PLAYOFF_SHORT, draftText, makeTip, record, roundKey, roundOrder, pct } from "../lib/draft.js";

/**
 * One row per team, sorted by record. Each row shows that team's 22 starters as
 * dots colored by draft round, offense on the left and defense on the right.
 */
export function leadStrip(container, season, { teamHref, rowLabel, labelHeader = "Team" } = {}) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const narrow = width < 560;

  const nameW = narrow ? 40 : 112;
  const recW = narrow ? 40 : 52;
  const postW = narrow ? 64 : 92;
  const dotsW = width - nameW - recW - postW;
  const step = Math.min(21, dotsW / 23.5);
  const r = Math.max(3.2, Math.min(5.5, step / 2 - 1.4));
  const sideGap = step * 1.5;
  const rowH = Math.max(18, Math.min(23, step + 6));
  const headH = 26;
  const height = headH + season.teams.length * rowH;
  const x0 = nameW + recW;
  // Playoff column sits right after the dots rather than at the far edge.
  const postX = Math.min(width, x0 + 22 * step + step * 1.5 + 16 + postW);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", `Draft round of each team's 22 starters${season.season ? `, ${season.season} season` : ""}`);

  const dotX = (side, i) => x0 + (side === "D" ? 11 * step + sideGap : 0) + i * step + step / 2;

  const head = svg.append("g").attr("transform", `translate(0,${headH - 9})`);
  head.append("text").attr("x", 0).text(labelHeader).attr("class", "label-muted");
  head.append("text").attr("x", nameW + recW - 8).attr("text-anchor", "end").text(narrow ? "W-L" : "Record").attr("class", "label-muted");
  head.append("text").attr("x", dotX("O", 0) - r).text("Offense").attr("class", "label-muted");
  head.append("text").attr("x", dotX("D", 0) - r).text("Defense").attr("class", "label-muted");
  head.append("text").attr("x", postX).attr("text-anchor", "end").text("Playoffs").attr("class", "label-muted");
  svg.append("line").attr("x1", 0).attr("x2", postX).attr("y1", headH - 1).attr("y2", headH - 1).attr("stroke", "var(--rule-strong)");

  const rows = svg
    .selectAll("g.row")
    .data(season.teams)
    .join("g")
    .attr("class", "row")
    .attr("transform", (_, i) => `translate(0,${headH + i * rowH + rowH / 2})`);

  rows
    .append("rect")
    .attr("x", 0)
    .attr("y", -rowH / 2)
    .attr("width", postX)
    .attr("height", rowH)
    .attr("fill", (t) => (t.playoff === 5 ? "var(--wash)" : "transparent"));

  const name = rows
    .append("a")
    .attr("href", (t) => (teamHref ? teamHref(t.franchise) : null));
  name
    .append("text")
    .attr("x", 0)
    .attr("dy", "0.35em")
    .attr("class", (t) => (t.playoff > 0 ? "label-strong" : ""))
    .text((t) => (rowLabel ? rowLabel(t, narrow) : narrow ? t.franchise : NICKNAMES[t.franchise]));

  rows
    .append("text")
    .attr("x", nameW + recW - 8)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .style("font-variant-numeric", "tabular-nums")
    .text(record);

  rows
    .append("text")
    .attr("x", postX)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("class", (t) => (t.playoff === 5 ? "label-strong" : "label-muted"))
    .text((t) => (narrow ? ["", "WC", "Div.", "Conf.", "Lost SB", "Champ"][t.playoff] : PLAYOFF_SHORT[t.playoff]));

  rows.each(function (team) {
    const sides = ["O", "D"].map((side) =>
      team.starters
        .filter((p) => p.side === side)
        .sort((a, b) => roundOrder(a.round) - roundOrder(b.round) || (a.pick ?? 999) - (b.pick ?? 999)),
    );
    const g = d3.select(this);
    sides.forEach((players, si) => {
      const side = si === 0 ? "O" : "D";
      const dots = g
        .selectAll(`g.dot-${side}`)
        .data(players)
        .join("g")
        .attr("class", `dot-${side}`)
        .attr("transform", (_, i) => `translate(${dotX(side, i)},0)`);
      dots
        .append("circle")
        .attr("r", (p) => (p.round == null ? r - 0.75 : r))
        .attr("fill", (p) => (p.round == null ? "var(--surface)" : `var(--${roundKey(p.round)})`))
        .attr("stroke", (p) => (p.round == null ? "var(--udfa)" : "none"))
        .attr("stroke-width", 1.5);
      dots
        .append("rect")
        .attr("x", -step / 2)
        .attr("y", -rowH / 2)
        .attr("width", step)
        .attr("height", rowH)
        .attr("fill", "transparent")
        .on("mouseenter", (event, p) => {
          const [mx, my] = d3.pointer(event, container);
          tip.show(
            `<strong>${p.name}</strong> <span class="muted">${p.pos}, ${NICKNAMES[team.franchise]}</span><br>${draftText(p)}<br><span class="muted">${pct(p.share)} of ${p.side === "O" ? "offensive" : "defensive"} snaps</span>`,
            mx,
            my,
          );
        })
        .on("mouseleave", () => tip.hide());
    });
  });
}
