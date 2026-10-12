import * as d3 from "d3";
import { makeTip, pearson } from "../lib/draft.js";

/** Playoff-tier dot style shared by the team scatters. */
export const tierDot = (tier) =>
  tier === 2
    ? { fill: "var(--s1)", opacity: 0.85, r: 5.5, ring: true }
    : tier === 1
      ? { fill: "var(--s1)", opacity: 0.85, r: 4 }
      : { fill: "var(--udfa)", opacity: 0.45, r: 4 };

/**
 * Scatter with a least-squares trend line and its correlation.
 *
 * points: [{x, y, ...}]
 * x / y:  {label, format, domain?, reverse?}  (reverse puts low values at the top)
 * dot(d): {fill, opacity, r, ring?}            ring = ink outline for emphasis
 * order(d): draw order (higher draws on top)
 * tip(d): tooltip HTML;  label(d): direct label text or null
 */
export function scatter(container, points, { x: xo, y: yo, dot, order = () => 0, tip: tipHtml, label = () => null }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const height = Math.round(Math.min(440, Math.max(300, width * 0.62)));
  const m = { top: 28, right: 12, bottom: 44, left: 40 };

  const x = d3
    .scaleLinear()
    .domain(xo.domain || d3.extent(points, (d) => d.x))
    .nice()
    .range([m.left, width - m.right]);
  const yRange = yo.reverse ? [m.top, height - m.bottom] : [height - m.bottom, m.top];
  const y = d3
    .scaleLinear()
    .domain(yo.domain || d3.extent(points, (d) => d.y))
    .nice()
    .range(yRange);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", `${xo.label} versus ${yo.label}`);

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(yo.format).tickSize(-(width - m.left - m.right)))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick text").attr("x", -6));

  svg
    .append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(width < 500 ? 4 : 6).tickFormat(xo.format).tickSizeOuter(0));

  svg.append("text").attr("x", width - m.right).attr("y", height - 8).attr("text-anchor", "end").attr("class", "label-muted").text(`${xo.label} →`);
  svg.append("text").attr("x", 0).attr("y", 10).attr("class", "label-muted").text(yo.reverse ? `${yo.label} (lower is better)` : yo.label);

  const fit = pearson(points.map((d) => d.x), points.map((d) => d.y));
  const [xa, xb] = x.domain();
  svg
    .append("line")
    .attr("x1", x(xa))
    .attr("x2", x(xb))
    .attr("y1", y(fit.intercept + fit.slope * xa))
    .attr("y2", y(fit.intercept + fit.slope * xb))
    .attr("stroke", "var(--ink-2)")
    .attr("stroke-width", 1.5);

  const sorted = [...points].sort((a, b) => order(a) - order(b));
  const styles = new Map(sorted.map((d) => [d, dot(d)]));
  svg
    .append("g")
    .selectAll("circle")
    .data(sorted)
    .join("circle")
    .attr("cx", (d) => x(d.x))
    .attr("cy", (d) => y(d.y))
    .attr("r", (d) => styles.get(d).r)
    .attr("fill", (d) => styles.get(d).fill)
    .attr("fill-opacity", (d) => styles.get(d).opacity)
    .attr("stroke", (d) => (styles.get(d).ring ? "var(--ink)" : "var(--surface)"))
    .attr("stroke-width", (d) => (styles.get(d).ring ? 2 : 1));

  svg
    .append("g")
    .selectAll("text")
    .data(points.filter((d) => label(d)))
    .join("text")
    .attr("x", (d) => x(d.x))
    .attr("text-anchor", (d) => (x(d.x) > width - 80 ? "end" : x(d.x) < m.left + 80 ? "start" : "middle"))
    // Above the dot, unless that would run into the header line.
    .attr("y", (d) => (y(d.y) - 12 < m.top + 4 ? y(d.y) + 20 : y(d.y) - 12))
    .attr("class", "label-strong halo")
    .text(label);

  svg
    .append("text")
    .attr("x", width - m.right)
    .attr("y", 10)
    .attr("text-anchor", "end")
    .attr("class", "label-strong")
    .text(`Correlation: r = ${fit.r.toFixed(2)}`);

  const delaunay = d3.Delaunay.from(sorted, (d) => x(d.x), (d) => y(d.y));
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
      if (Math.hypot(x(d.x) - px, y(d.y) - py) > 24) {
        ring.style("opacity", 0);
        return tip.hide();
      }
      ring.attr("cx", x(d.x)).attr("cy", y(d.y)).style("opacity", 1);
      tip.show(tipHtml(d), x(d.x), y(d.y));
    })
    .on("mouseleave", () => {
      ring.style("opacity", 0);
      tip.hide();
    });

  return fit;
}
