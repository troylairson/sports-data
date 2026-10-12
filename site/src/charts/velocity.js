import * as d3 from "d3";
import { makeTip } from "../lib/draft.js";

/**
 * Ridgeline: one row per season, the share of four-seamers thrown at each
 * 1-mph speed, with the season average marked.
 * rows: [{label, hist: number[], avg}] ; edges: bin edges from the pipeline
 */
export function ridgeline(container, rows, edges, { highlight = 95 } = {}) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const narrow = width < 560;
  const m = { top: 8, right: narrow ? 56 : 72, bottom: 28, left: 44 };
  const rowH = narrow ? 30 : 36;
  const overlap = 1.7;
  const height = m.top + rows.length * rowH + rowH * (overlap - 1) + m.bottom;

  // Plot bins 85..102 at their centers; the open-ended bins sit at the edges.
  const lo = 84, hi = 103;
  const x = d3.scaleLinear().domain([lo, hi]).range([m.left, width - m.right]);
  const center = (i) => {
    const a = edges[i], b = edges[i + 1];
    if (a === 0) return lo + 0.5;
    if (b >= 200) return hi - 0.5;
    return (a + b) / 2;
  };
  const shares = rows.map((r) => {
    const n = d3.sum(r.hist);
    return r.hist.map((h) => h / n);
  });
  const ymax = d3.max(shares.flat());
  const y = d3.scaleLinear().domain([0, ymax]).range([0, rowH * overlap]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", "Distribution of four-seam fastball speed by season");

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(d3.range(85, 103, narrow ? 3 : 2)).tickFormat((d) => `${d}${d === 85 ? " mph" : ""}`).tickSize(-(height - m.top - m.bottom)))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick text").attr("dy", "1em"));

  const area = d3
    .area()
    .curve(d3.curveMonotoneX)
    .x((d) => x(d.c))
    .y0(0)
    .y1((d) => -y(d.s));

  rows.forEach((row, i) => {
    const base = m.top + rowH * overlap + i * rowH;
    const pts = shares[i].map((s, j) => ({ c: center(j), s }));
    const g = svg.append("g").attr("transform", `translate(0,${base})`);
    const clipId = `clip-${container.dataset.chart}-${i}`;
    g.append("clipPath").attr("id", clipId).append("rect").attr("x", x(highlight)).attr("y", -rowH * overlap - 2).attr("width", width).attr("height", rowH * overlap + 2);
    g.append("path").datum(pts).attr("d", area).attr("fill", "var(--surface)");
    g.append("path").datum(pts).attr("d", area).attr("fill", "var(--r4)").attr("fill-opacity", 0.55);
    g.append("path").datum(pts).attr("d", area).attr("fill", "var(--r2)").attr("clip-path", `url(#${clipId})`);
    g.append("path").datum(pts).attr("d", area.lineY1()).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1);
    g.append("line").attr("x1", m.left).attr("x2", width - m.right).attr("stroke", "var(--axis)");
    g.append("line")
      .attr("x1", x(row.avg)).attr("x2", x(row.avg))
      .attr("y1", 0).attr("y2", -y(d3.max(shares[i])) - 4)
      .attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
    g.append("text").attr("x", 0).attr("y", -4).attr("class", "label-strong").text(row.label);
    g.append("text")
      .attr("x", width).attr("y", -4).attr("text-anchor", "end")
      .style("font-variant-numeric", "tabular-nums")
      .attr("class", i === rows.length - 1 || i === 0 ? "label-strong" : "label-muted")
      .text(`${row.avg.toFixed(1)}${narrow ? "" : " mph"}`);
    g.append("rect")
      .attr("x", m.left).attr("y", -rowH).attr("width", width - m.left - m.right).attr("height", rowH)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [px] = d3.pointer(event);
        const mph = x.invert(px);
        const j = pts.reduce((best, p, k) => (Math.abs(p.c - mph) < Math.abs(pts[best].c - mph) ? k : best), 0);
        const a = edges[j], b = edges[j + 1];
        const range = a === 0 ? `Under ${b} mph` : b >= 200 ? `${a}+ mph` : `${a}–${a + 0.9} mph`;
        const above = d3.sum(shares[i].filter((_, k) => edges[k] >= highlight));
        const [mx, my] = d3.pointer(event, container);
        tip.show(
          `<strong>${row.label}</strong> · average ${row.avg.toFixed(1)} mph<br>${range}: ${(shares[i][j] * 100).toFixed(1)}% of four-seamers<br><span class="muted">${highlight}+ mph: ${(above * 100).toFixed(1)}%</span>`,
          mx,
          my,
        );
      })
      .on("mouseleave", () => tip.hide());
  });
}

/**
 * Multi-series line over seasons with direct end labels.
 * series: [{label, color, points: [{season, v}]}]
 */
export function multiLine(container, series, { format, domain, height = 260, tipFormat = format }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const narrow = width < 560;
  const m = { top: 16, right: narrow ? 64 : 112, bottom: 28, left: 44 };
  const all = series.flatMap((s) => s.points);
  const x = d3.scaleLinear().domain(d3.extent(all, (d) => d.season)).range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain(domain || d3.extent(all, (d) => d.v)).nice().range([height - m.bottom, m.top]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", series.map((s) => s.label).join(", "));

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(format).tickSize(-(width - m.left - m.right)))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick text").attr("x", -6));
  svg
    .append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(narrow ? 5 : 10).tickFormat(d3.format("d")).tickSizeOuter(0));

  const line = d3.line((d) => x(d.season), (d) => y(d.v));
  // End labels: nudge apart if two series end close together.
  const ends = series.map((s) => ({ s, y: y(s.points[s.points.length - 1].v) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;

  for (const s of series) {
    svg.append("path").datum(s.points).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("d", line);
    const last = s.points[s.points.length - 1];
    svg.append("circle").attr("cx", x(last.season)).attr("cy", y(last.v)).attr("r", 4.5).attr("fill", s.color).attr("stroke", "var(--surface)").attr("stroke-width", 2);
    const ly = ends.find((e) => e.s === s).y;
    svg
      .append("text")
      .attr("x", x(last.season) + 10)
      .attr("y", ly)
      .attr("dy", "0.35em")
      .attr("class", "label-strong")
      .text(narrow ? tipFormat(last.v) : `${s.label} ${tipFormat(last.v)}`);
  }

  const focus = svg.append("g").style("opacity", 0);
  const rule = focus.append("line").attr("y1", m.top).attr("y2", height - m.bottom).attr("stroke", "var(--axis)");
  const dots = series.map((s) => focus.append("circle").attr("r", 4.5).attr("fill", s.color).attr("stroke", "var(--surface)").attr("stroke-width", 2));
  svg
    .append("rect")
    .attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const season = Math.round(x.invert(d3.pointer(event)[0]));
      focus.style("opacity", 1);
      rule.attr("x1", x(season)).attr("x2", x(season));
      const rows = series.map((s, i) => {
        const p = s.points.find((q) => q.season === season);
        if (p) dots[i].attr("cx", x(season)).attr("cy", y(p.v));
        return p ? `<span class="swatch line" style="background:${s.color};display:inline-block;vertical-align:middle;margin-right:6px"></span>${s.label}: ${tipFormat(p.v)}` : "";
      });
      tip.show(`<strong>${season}</strong><br>${rows.filter(Boolean).join("<br>")}`, x(season), y(series[0].points.find((q) => q.season === season)?.v ?? 0));
    })
    .on("mouseleave", () => {
      focus.style("opacity", 0);
      tip.hide();
    });
}

/**
 * Horizontal bars from a zero line, for "average change" by group.
 * rows: [{label, v, n}] ; good: "up" or "down" decides which direction is shaded as better.
 */
export function changeBars(container, rows, { format, good = "up", title }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const labelW = 104;
  const barH = 20;
  const rowH = 30;
  const m = { top: title ? 22 : 4, right: 44, bottom: 4, left: labelW };
  const height = m.top + rows.length * rowH + m.bottom;
  const ext = d3.max(rows, (r) => Math.abs(r.v)) || 1;
  const x = d3.scaleLinear().domain([-ext, ext]).range([m.left + 36, width - m.right]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", title || "Average change");
  if (title) svg.append("text").attr("x", 0).attr("y", 12).attr("class", "label-strong").text(title);

  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.top - 4).attr("y2", height - m.bottom).attr("stroke", "var(--axis)");

  const g = svg.selectAll("g.row").data(rows).join("g").attr("transform", (_, i) => `translate(0,${m.top + i * rowH})`);
  g.append("text").attr("x", 0).attr("y", barH / 2).attr("dy", "0.35em").text((d) => d.label);
  const better = (d) => (good === "up" ? d.v > 0 : d.v < 0);
  g.append("rect")
    .attr("x", (d) => Math.min(x(0), x(d.v)))
    .attr("width", (d) => Math.abs(x(d.v) - x(0)))
    .attr("y", 0)
    .attr("height", barH)
    .attr("rx", 2)
    .attr("fill", (d) => (better(d) ? "var(--s1)" : "var(--s2)"));
  g.append("text")
    .attr("x", (d) => (d.v >= 0 ? x(d.v) + 6 : x(d.v) - 6))
    .attr("text-anchor", (d) => (d.v >= 0 ? "start" : "end"))
    .attr("y", barH / 2)
    .attr("dy", "0.35em")
    .attr("class", "label-strong")
    .style("font-variant-numeric", "tabular-nums")
    .text((d) => format(d.v));
  g.append("rect")
    .attr("x", 0).attr("y", -4).attr("width", width).attr("height", rowH)
    .attr("fill", "transparent")
    .on("mouseenter", (event, d) => {
      const [mx, my] = d3.pointer(event, container);
      tip.show(`<strong>${d.label}</strong><br>Average change: ${format(d.v)}<br><span class="muted">${d.n} pitcher-seasons</span>`, mx, my);
    })
    .on("mouseleave", () => tip.hide());
}

/**
 * One row per season; each team's staff four-seam velocity relative to the
 * league average that season. Playoff teams filled, champion ringed and labeled.
 * rows: [{season, teams: [{id, rel, playoff, ...}]}]
 */
export function seasonDots(container, rows, { name, tipHtml, href }) {
  container.innerHTML = "";
  const tip = makeTip(container);
  const width = container.clientWidth;
  const narrow = width < 560;
  const m = { top: 24, right: narrow ? 8 : 104, bottom: 28, left: 44 };
  const rowH = 30;
  const height = m.top + rows.length * rowH + m.bottom;
  const all = rows.flatMap((r) => r.teams.map((t) => t.rel));
  const ext = Math.ceil(d3.max(all, Math.abs) * 2) / 2;
  const x = d3.scaleLinear().domain([-ext, ext]).range([m.left, width - m.right]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("role", "img").attr("aria-label", "Team staff velocity relative to league average, by season");

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(narrow ? 5 : 9).tickFormat((d) => (d === 0 ? "League avg." : `${d > 0 ? "+" : "−"}${Math.abs(d)}`)).tickSize(-(height - m.top - m.bottom)))
    .call((g) => g.select(".domain").remove());
  svg.append("text").attr("x", x(-ext)).attr("y", 12).attr("class", "label-muted").text("← Slower staff");
  if (!narrow) svg.append("text").attr("x", width - m.right + 12).attr("y", 12).attr("class", "label-muted").text("Champion");
  svg.append("text").attr("x", x(ext)).attr("y", 12).attr("text-anchor", "end").attr("class", "label-muted").text("Harder-throwing staff →");

  const pts = [];
  rows.forEach((row, i) => {
    const cy = m.top + i * rowH + rowH / 2;
    svg.append("text").attr("x", 0).attr("y", cy).attr("dy", "0.35em").attr("class", "label-strong").text(row.season);
    const sorted = [...row.teams].sort((a, b) => (a.playoff > 0) - (b.playoff > 0) || a.playoff - b.playoff);
    for (const t of sorted) {
      const s = t.playoff === 5 ? { fill: "var(--s1)", r: 6, ring: true, o: 0.9 } : t.playoff > 0 ? { fill: "var(--s1)", r: 4.5, o: 0.85 } : { fill: "var(--udfa)", r: 4.5, o: 0.45 };
      svg.append("circle").attr("cx", x(t.rel)).attr("cy", cy).attr("r", s.r).attr("fill", s.fill).attr("fill-opacity", s.o)
        .attr("stroke", s.ring ? "var(--ink)" : "var(--surface)").attr("stroke-width", s.ring ? 2 : 1);
      pts.push({ t, row, cx: x(t.rel), cy });
    }
    const champ = row.teams.find((t) => t.playoff === 5);
    if (champ && !narrow) {
      svg.append("text").attr("x", width - m.right + 12).attr("y", cy).attr("dy", "0.35em").attr("class", "label-strong").text(name(champ));
    }
  });

  const delaunay = d3.Delaunay.from(pts, (p) => p.cx, (p) => p.cy);
  const ring = svg.append("circle").attr("r", 8).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.5).style("opacity", 0);
  svg
    .append("rect")
    .attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .style("cursor", href ? "pointer" : null)
    .on("mousemove", (event) => {
      const [px, py] = d3.pointer(event);
      const p = pts[delaunay.find(px, py)];
      if (Math.hypot(p.cx - px, p.cy - py) > 16) {
        ring.style("opacity", 0);
        return tip.hide();
      }
      ring.attr("cx", p.cx).attr("cy", p.cy).style("opacity", 1);
      tip.show(tipHtml(p.t, p.row), p.cx, p.cy);
    })
    .on("click", (event) => {
      if (!href) return;
      const [px, py] = d3.pointer(event);
      const p = pts[delaunay.find(px, py)];
      if (Math.hypot(p.cx - px, p.cy - py) <= 16) window.location.href = href(p.t);
    })
    .on("mouseleave", () => {
      ring.style("opacity", 0);
      tip.hide();
    });
}
