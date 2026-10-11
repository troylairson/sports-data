import * as d3 from "d3";
import { ROUND_CLASSES, makeTip, pct, roundKey } from "../lib/draft.js";

/**
 * 100% stacked bars: the average round mix of starters for each group of teams.
 * rows: [{label, n, shares: {r1, r2, r3, r4, udfa}}]
 */
export function roundMixBars(container, rows) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const narrow = width < 560;
  const labelW = narrow ? 118 : 200;
  const barH = 22;
  const rowH = barH + 14;
  const m = { top: 4, right: 4, bottom: 4 };
  const height = m.top + rows.length * rowH + m.bottom;
  const x = d3.scaleLinear().domain([0, 1]).range([labelW, width - m.right]);
  const GAP = 2;

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", "Round mix of starters by playoff outcome");

  const g = svg
    .selectAll("g.row")
    .data(rows)
    .join("g")
    .attr("transform", (_, i) => `translate(0,${m.top + i * rowH})`);

  g.append("text")
    .attr("x", 0)
    .attr("y", barH / 2)
    .attr("dy", "0.35em")
    .attr("class", (d) => (d.strong ? "label-strong" : ""))
    .text((d) => d.label);
  g.append("text")
    .attr("x", 0)
    .attr("y", barH / 2 + 13)
    .attr("dy", "0.35em")
    .attr("class", "label-muted")
    .style("font-size", "11px")
    .text((d) => `${d.n} team-seasons`)
    .style("display", narrow ? "none" : null);

  g.each(function (row) {
    let acc = 0;
    const segs = ROUND_CLASSES.map((c) => {
      const s = { key: c.key, label: c.label, v: row.shares[c.key], x0: acc };
      acc += s.v;
      return s;
    });
    const sel = d3
      .select(this)
      .selectAll("g.seg")
      .data(segs)
      .join("g")
      .attr("class", "seg");
    sel
      .append("rect")
      .attr("x", (s) => x(s.x0) + (s.x0 > 0 ? GAP / 2 : 0))
      .attr("width", (s) => Math.max(0, x(s.x0 + s.v) - x(s.x0) - (s.x0 > 0 ? GAP / 2 : 0) - (s.x0 + s.v < 0.9999 ? GAP / 2 : 0)))
      .attr("y", 0)
      .attr("height", barH)
      .attr("fill", (s) => (s.key === "udfa" ? "var(--surface)" : `var(--${s.key})`))
      .attr("stroke", (s) => (s.key === "udfa" ? "var(--udfa)" : "none"))
      .attr("stroke-width", 1.5)
      .on("mouseenter", (event, s) => {
        const [mx, my] = d3.pointer(event, container);
        tip.show(`<strong>${row.label}</strong><br>${s.label}: ${pct(s.v, 1)} of starters`, mx, my);
      })
      .on("mouseleave", () => tip.hide());
    sel
      .append("text")
      .attr("x", (s) => x(s.x0 + s.v / 2))
      .attr("y", barH / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .style("pointer-events", "none")
      .style("font-variant-numeric", "tabular-nums")
      .style("fill", (s) => (["r1", "r2"].includes(s.key) ? "var(--surface)" : "var(--ink)"))
      .text((s) => (x(s.x0 + s.v) - x(s.x0) > 34 ? pct(s.v) : ""));
  });
}

/**
 * Dumbbell: for each position group, the share of starters who were first-round
 * picks on playoff teams (s1) vs. teams that missed (s2).
 * rows: [{group, a, b, na, nb}]
 */
export function dumbbell(container, rows, { aLabel, bLabel }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const m = { top: 24, right: 16, bottom: 8, left: 120 };
  const rowH = 30;
  const height = m.top + rows.length * rowH + m.bottom;
  const max = d3.max(rows, (d) => Math.max(d.a, d.b));
  const x = d3.scaleLinear().domain([0, Math.ceil(max * 10) / 10]).range([m.left, width - m.right]);
  const y = (i) => m.top + i * rowH + rowH / 2;

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", "First-round share of starters by position");

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${m.top})`)
    .call(d3.axisTop(x).ticks(width < 500 ? 4 : 6).tickFormat(d3.format(".0%")).tickSize(-(rows.length * rowH)))
    .call((g) => g.select(".domain").remove());

  const row = svg
    .selectAll("g.row")
    .data(rows)
    .join("g")
    .attr("transform", (_, i) => `translate(0,${y(i)})`);

  row.append("text").attr("x", 0).attr("dy", "0.35em").attr("class", "label-strong").text((d) => d.label);
  row
    .append("line")
    .attr("x1", (d) => x(Math.min(d.a, d.b)))
    .attr("x2", (d) => x(Math.max(d.a, d.b)))
    .attr("stroke", "var(--axis)")
    .attr("stroke-width", 2);
  for (const [key, color] of [["b", "var(--s2)"], ["a", "var(--s1)"]]) {
    row
      .append("circle")
      .attr("cx", (d) => x(d[key]))
      .attr("r", 5.5)
      .attr("fill", color)
      .attr("stroke", "var(--surface)")
      .attr("stroke-width", 2);
  }
  row
    .append("rect")
    .attr("x", m.left)
    .attr("y", -rowH / 2)
    .attr("width", width - m.left - m.right)
    .attr("height", rowH)
    .attr("fill", "transparent")
    .on("mouseenter", (event, d) => {
      const [mx, my] = d3.pointer(event, container);
      tip.show(
        `<strong>${d.label}</strong><br>${aLabel}: ${pct(d.a)} <span class="muted">(${d.na} starters)</span><br>${bLabel}: ${pct(d.b)} <span class="muted">(${d.nb} starters)</span>`,
        mx,
        my,
      );
    })
    .on("mouseleave", () => tip.hide());
}

/** Single-series line over seasons with an end label. points: [{season, v}] */
export function seasonLine(container, points, { yLabel }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const height = 240;
  const m = { top: 16, right: 48, bottom: 28, left: 40 };
  const x = d3.scaleLinear().domain(d3.extent(points, (d) => d.season)).range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain([0, Math.ceil(d3.max(points, (d) => d.v) * 20) / 20]).range([height - m.bottom, m.top]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", yLabel);

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")).tickSize(-(width - m.left - m.right)))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick text").attr("x", -6));
  svg
    .append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(width < 500 ? 5 : 10).tickFormat(d3.format("d")).tickSizeOuter(0));

  svg
    .append("path")
    .datum(points)
    .attr("fill", "none")
    .attr("stroke", "var(--s1)")
    .attr("stroke-width", 2)
    .attr("stroke-linejoin", "round")
    .attr("stroke-linecap", "round")
    .attr("d", d3.line((d) => x(d.season), (d) => y(d.v)));

  const first = points[0];
  const last = points[points.length - 1];
  for (const d of [first, last]) {
    svg.append("circle").attr("cx", x(d.season)).attr("cy", y(d.v)).attr("r", 4.5).attr("fill", "var(--s1)").attr("stroke", "var(--surface)").attr("stroke-width", 2);
  }
  // First value sits above its dot; last value to the right of its dot.
  svg.append("text").attr("x", x(first.season) + 2).attr("y", y(first.v) - 14).attr("dy", "0.35em").attr("class", "label-strong").text(pct(first.v, 1));
  svg.append("text").attr("x", x(last.season) + 8).attr("y", y(last.v)).attr("dy", "0.35em").attr("class", "label-strong").text(pct(last.v, 1));

  const focus = svg.append("circle").attr("r", 5).attr("fill", "var(--s1)").attr("stroke", "var(--surface)").attr("stroke-width", 2).style("opacity", 0);
  svg
    .append("rect")
    .attr("x", m.left)
    .attr("y", m.top)
    .attr("width", width - m.left - m.right)
    .attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [px] = d3.pointer(event);
      const season = Math.round(x.invert(px));
      const d = points.find((p) => p.season === season);
      if (!d) return;
      focus.attr("cx", x(d.season)).attr("cy", y(d.v)).style("opacity", 1);
      tip.show(`<strong>${d.season}</strong><br>${pct(d.v, 1)} ${yLabel.toLowerCase()}`, x(d.season), y(d.v));
    })
    .on("mouseleave", () => {
      focus.style("opacity", 0);
      tip.hide();
    });
}

export { roundKey };
