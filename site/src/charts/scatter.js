import * as d3 from "d3";
import { NICKNAMES, PLAYOFF_LONG, makeTip, pearson, record } from "../lib/draft.js";

/**
 * Every team-season as a dot: x = a roster measure, y = regular-season win %.
 * Playoff teams are filled; Super Bowl winners get an ink ring.
 *
 * points: [{season, team, franchise, winPct, playoff, wins, losses, ties, x}]
 */
export function scatter(container, points, { xLabel, xFormat, xDomain, label = [] }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const height = Math.round(Math.min(440, Math.max(300, width * 0.62)));
  const m = { top: 28, right: 12, bottom: 44, left: 40 };

  const x = d3
    .scaleLinear()
    .domain(xDomain || d3.extent(points, (d) => d.x))
    .nice()
    .range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", `${xLabel} versus win percentage`);

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")).tickSize(-(width - m.left - m.right)))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick text").attr("x", -6));

  svg
    .append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(width < 500 ? 4 : 6).tickFormat(xFormat).tickSizeOuter(0));

  svg
    .append("text")
    .attr("x", width - m.right)
    .attr("y", height - 8)
    .attr("text-anchor", "end")
    .attr("class", "label-muted")
    .text(`${xLabel} →`);
  svg.append("text").attr("x", 0).attr("y", 10).attr("class", "label-muted").text("Regular-season win %");

  // Trend line
  const fit = pearson(points.map((d) => d.x), points.map((d) => d.winPct));
  const [xa, xb] = x.domain();
  svg
    .append("line")
    .attr("x1", x(xa))
    .attr("x2", x(xb))
    .attr("y1", y(fit.intercept + fit.slope * xa))
    .attr("y2", y(fit.intercept + fit.slope * xb))
    .attr("stroke", "var(--ink-2)")
    .attr("stroke-width", 1.5);

  const sorted = [...points].sort((a, b) => (a.playoff > 0) - (b.playoff > 0) || a.playoff - b.playoff);
  const dots = svg
    .append("g")
    .selectAll("circle")
    .data(sorted)
    .join("circle")
    .attr("cx", (d) => x(d.x))
    .attr("cy", (d) => y(d.winPct))
    .attr("r", (d) => (d.playoff === 5 ? 5.5 : 4))
    .attr("fill", (d) => (d.playoff > 0 ? "var(--s1)" : "var(--udfa)"))
    .attr("fill-opacity", (d) => (d.playoff > 0 ? 0.85 : 0.45))
    .attr("stroke", (d) => (d.playoff === 5 ? "var(--ink)" : "var(--surface)"))
    .attr("stroke-width", (d) => (d.playoff === 5 ? 2 : 1));

  // Labels for named team-seasons
  const labeled = points.filter((p) => label.some((l) => l.season === p.season && l.team === p.team));
  svg
    .append("g")
    .selectAll("text")
    .data(labeled)
    .join("text")
    .attr("x", (d) => x(d.x))
    .attr("text-anchor", (d) => (x(d.x) > width - 80 ? "end" : x(d.x) < m.left + 80 ? "start" : "middle"))
    .attr("y", (d) => y(d.winPct) - 12)
    .attr("class", "label-strong halo")
    .text((d) => `${d.season} ${NICKNAMES[d.franchise]}`);

  // r annotation
  svg
    .append("text")
    .attr("x", width - m.right)
    .attr("y", 10)
    .attr("text-anchor", "end")
    .attr("class", "label-strong")
    .text(`Correlation: r = ${fit.r.toFixed(2)}`);

  // Hover: nearest point
  const delaunay = d3.Delaunay.from(sorted, (d) => x(d.x), (d) => y(d.winPct));
  const ring = svg.append("circle").attr("r", 8).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.5).style("opacity", 0);
  svg
    .append("rect")
    .attr("x", m.left)
    .attr("y", m.top)
    .attr("width", width - m.left - m.right)
    .attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [px, py] = d3.pointer(event);
      const d = sorted[delaunay.find(px, py)];
      if (Math.hypot(x(d.x) - px, y(d.winPct) - py) > 24) {
        ring.style("opacity", 0);
        return tip.hide();
      }
      ring.attr("cx", x(d.x)).attr("cy", y(d.winPct)).style("opacity", 1);
      tip.show(
        `<strong>${d.season} ${NICKNAMES[d.franchise]}</strong><br>${record(d)} · ${PLAYOFF_LONG[d.playoff]}<br><span class="muted">${xLabel}: ${xFormat(d.x)}</span>`,
        x(d.x),
        y(d.winPct),
      );
    })
    .on("mouseleave", () => {
      ring.style("opacity", 0);
      tip.hide();
    });

  return fit;
}
