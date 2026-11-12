'use client';
// Three small trend charts above the problems table, written for a merchant at a glance:
// problems found vs. fixed, money at risk over time, and money coming due. Interactive
// (hover for values, click the legend to hide a line). Colours follow the light/dark theme.
import {
  AgCharts,
  AllCommunityModule,
  ModuleRegistry,
  type AgCartesianChartOptions,
  type AgChartInstance,
} from 'ag-charts-community';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QueueRow } from './types';

ModuleRegistry.registerModules([AllCommunityModule]);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CLOSED = new Set(['RESOLVED', 'DISMISSED']);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dollars = (cents: number) => Math.round(cents) / 100;

interface Bucket {
  start: number;
  end: number;
  label: string;
}

/** Hourly buckets when everything is recent, daily buckets otherwise. */
function pastBuckets(rows: QueueRow[], now: number): Bucket[] {
  const times = rows.map((r) => Date.parse(r.detectedAt ?? '')).filter(Number.isFinite);
  const earliest = times.length ? Math.min(...times) : now;
  const hourly = now - earliest <= 2 * DAY;
  if (hourly) {
    const first = Math.floor(Math.max(earliest, now - 2 * DAY) / HOUR) * HOUR;
    const span = Math.max(6, Math.ceil((now - first) / HOUR) + 1);
    const start = Math.floor(now / HOUR) * HOUR - (span - 1) * HOUR;
    return Array.from({ length: span }, (_, i) => {
      const s = start + i * HOUR;
      const d = new Date(s);
      return {
        start: s,
        end: s + HOUR,
        label: d.toLocaleTimeString('en-US', { hour: 'numeric' }),
      };
    });
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, i) => {
    const s = today.getTime() - (13 - i) * DAY;
    return {
      start: s,
      end: s + DAY,
      label: new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  });
}

function trendData(rows: QueueRow[], now: number) {
  // The past charts end at the later of the clock and the newest event (Demo's clock is frozen
  // before its sample data was loaded); the "coming due" chart always counts from `now`.
  const events = rows
    .flatMap((r) => [r.detectedAt, r.resolvedAt])
    .map((t) => Date.parse(t ?? ''))
    .filter(Number.isFinite);
  const pastEnd = Math.max(now, ...events);
  const buckets = pastBuckets(rows, pastEnd);
  const activity = buckets.map((b) => ({
    when: b.label,
    found: rows.filter((r) => inRange(r.detectedAt, b)).length,
    fixed: rows.filter((r) => r.status === 'RESOLVED' && inRange(r.resolvedAt, b)).length,
  }));
  const risk = buckets.map((b) => {
    const at = Math.min(b.end, pastEnd);
    const cents = rows
      .filter((r) => {
        const found = Date.parse(r.detectedAt ?? '');
        const closed = r.resolvedAt && CLOSED.has(r.status) ? Date.parse(r.resolvedAt) : Infinity;
        return Number.isFinite(found) && found <= at && closed > at;
      })
      .reduce((sum, r) => sum + (r.amountAtRiskCents ?? 0), 0);
    return { when: b.label, atRisk: dollars(cents) };
  });
  // Money whose deadline passes by the end of each of the next 7 days (open problems only).
  const open = rows.filter((r) => !CLOSED.has(r.status) && r.deadlineAt);
  const due = Array.from({ length: 7 }, (_, i) => {
    const end = now + (i + 1) * DAY;
    const cents = open
      .filter((r) => Date.parse(r.deadlineAt!) <= end)
      .reduce((sum, r) => sum + (r.amountAtRiskCents ?? 0), 0);
    const label =
      i === 0
        ? 'Next 24h'
        : new Date(end).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
    return { when: label, due: dollars(cents) };
  });
  return {
    activity,
    risk,
    due,
    hourly: buckets[1] ? buckets[1].start - buckets[0]!.start === HOUR : false,
  };
}

function inRange(iso: string | null, b: Bucket) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) && t >= b.start && t < b.end;
}

/** Read the theme's colours from CSS variables, so charts match light and dark mode. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    ink: v('--ink'),
    muted: v('--muted'),
    line: v('--line'),
    surface: v('--surface'),
    teal: v('--teal'),
    red: v('--red'),
    amber: v('--amber'),
  };
}

type Palette = ReturnType<typeof palette>;

function base(p: Palette, title: string, subtitle: string): Partial<AgCartesianChartOptions> {
  return {
    background: { fill: p.surface },
    title: { text: title, color: p.ink, fontSize: 15, fontWeight: 600, textAlign: 'left' },
    subtitle: { text: subtitle, color: p.muted, fontSize: 12, textAlign: 'left' },
    padding: { top: 12, right: 16, bottom: 8, left: 8 },
    legend: { position: 'bottom', item: { label: { color: p.ink } } },
  };
}

function axes(p: Palette, money: boolean): AgCartesianChartOptions['axes'] {
  return {
    x: {
      type: 'category',
      position: 'bottom',
      label: { color: p.muted, fontSize: 11 },
      line: { stroke: p.line },
    },
    y: {
      type: 'number',
      position: 'left',
      label: {
        color: p.muted,
        fontSize: 11,
        ...(money ? { formatter: ({ value }: { value: number }) => usd.format(value) } : {}),
      },
      gridLine: { style: [{ stroke: p.line, lineDash: [3, 3] }] },
      ...(money ? {} : { interval: { minSpacing: 30 } }),
    },
  };
}

function Chart({ options, label }: { options: AgCartesianChartOptions; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<AgChartInstance | null>(null);
  useEffect(() => {
    if (!host.current) return;
    if (chart.current) void chart.current.update({ ...options, container: host.current });
    else chart.current = AgCharts.create({ ...options, container: host.current });
  }, [options]);
  useEffect(
    () => () => {
      chart.current?.destroy();
      chart.current = null;
    },
    [],
  );
  return <div className="trend-chart" ref={host} role="img" aria-label={label} />;
}

/** `now` is the page's clock (the server's; frozen in Demo), so the charts match the table. */
export function TrendCharts({ rows, now }: { rows: QueueRow[]; now: number }) {
  // Re-read colours when the light/dark toggle flips `data-theme` on <html>.
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const charts = useMemo(() => {
    const p = palette();
    const d = trendData(rows, now);
    const period = d.hourly ? 'hour by hour' : 'day by day';
    const activity: AgCartesianChartOptions = {
      ...base(
        p,
        'Problems found vs. fixed',
        `How many Vigil spotted and how many you fixed, ${period}`,
      ),
      data: d.activity,
      axes: axes(p, false),
      series: [
        {
          type: 'line',
          xKey: 'when',
          yKey: 'found',
          yName: 'Found',
          stroke: p.red,
          marker: { fill: p.red, stroke: p.red, size: 6 },
          interpolation: { type: 'smooth' },
        },
        {
          type: 'line',
          xKey: 'when',
          yKey: 'fixed',
          yName: 'Fixed',
          stroke: p.teal,
          marker: { fill: p.teal, stroke: p.teal, size: 6 },
          interpolation: { type: 'smooth' },
        },
      ],
    };
    const risk: AgCartesianChartOptions = {
      ...base(p, 'Money at risk over time', 'Total money in open problems at each point'),
      data: d.risk,
      axes: axes(p, true),
      series: [
        {
          type: 'area',
          xKey: 'when',
          yKey: 'atRisk',
          yName: 'Money at risk',
          stroke: p.red,
          strokeWidth: 2,
          fill: p.red,
          fillOpacity: 0.15,
          marker: { enabled: true, fill: p.red, stroke: p.red, size: 5 },
          interpolation: { type: 'smooth' },
        },
      ],
    };
    const due: AgCartesianChartOptions = {
      ...base(p, 'Money coming due', 'Held or unshipped money whose deadline passes by each day'),
      data: d.due,
      axes: axes(p, true),
      series: [
        {
          type: 'line',
          xKey: 'when',
          yKey: 'due',
          yName: 'Due by then',
          stroke: p.amber,
          strokeWidth: 2,
          marker: { fill: p.amber, stroke: p.amber, size: 6 },
          interpolation: { type: 'step' },
        },
      ],
    };
    return { activity, risk, due };
    // `theme` is a dependency on purpose: it re-reads the CSS colours.
  }, [rows, now, theme]);

  return (
    <section className="trends" aria-label="Trends">
      <Chart options={charts.activity} label="Line chart of problems found and fixed over time" />
      <Chart options={charts.risk} label="Area chart of money at risk over time" />
      <Chart options={charts.due} label="Step chart of money coming due over the next 7 days" />
    </section>
  );
}
