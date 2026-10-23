import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyMetrics } from "../../sim/types";

type Props = { metrics: DailyMetrics[]; foodPrice: { day: number; price: number }[]; baseline?: DailyMetrics[] | null };

const series: { key: keyof DailyMetrics | "foodPrice"; title: string; fmt: (v: number) => string; note: string }[] = [
  { key: "foodPrice", title: "Food price", fmt: (v) => `$${(v / 100).toFixed(2)}`, note: "market clearing price per unit; base $3.00" },
  { key: "unemployment", title: "Unemployment", fmt: (v) => `${v}%`, note: "share of working-age adults without a job" },
  { key: "avgWellbeing", title: "Wellbeing", fmt: (v) => `${v}`, note: "mean of the four needs, 0–100 (a model variable, not a measured human one)" },
  { key: "gini", title: "Wealth inequality (Gini)", fmt: (v) => (v / 1000).toFixed(2), note: "0 = equal, 1 = one person holds everything" },
  { key: "treasuryTotal", title: "Treasury", fmt: (v) => `$${Math.round(v / 100).toLocaleString()}`, note: "council cash after taxes and spending" },
  { key: "gdp", title: "Daily output", fmt: (v) => `$${Math.round(v / 100).toLocaleString()}`, note: "goods produced × price + service wages" },
  { key: "population", title: "Population", fmt: (v) => `${v}`, note: "births, deaths and the people who moved between towns" },
  { key: "infected", title: "Infected", fmt: (v) => `${v}`, note: "people sick or incubating the fever" },
  { key: "trade", title: "Caravan arrivals", fmt: (v) => `${v} units`, note: "goods that reached a market by caravan today; the roads open when a good is a quarter dearer across them" },
  { key: "caravans", title: "Caravans on the road", fmt: (v) => `${v}`, note: "carts between towns at the end of the day" },
];

/** Charts over the run's metrics. Every series is defined in docs/03 and computed in sim/metrics.ts. */
export function Analytics({ metrics, foodPrice, baseline }: Props): JSX.Element {
  if (metrics.length < 2) return <p className="dim">Charts appear once the simulation has run a few days.</p>;
  const byDay = new Map<number, DailyMetrics>();
  for (const m of baseline ?? []) byDay.set(m.day, m);
  const horizon = Math.min(545, Math.max(metrics[metrics.length - 1].day + 60, 60));
  const data: Record<string, number | null>[] = [];
  for (let d = metrics[0].day; d <= horizon; d++) {
    const m = metrics.find((x) => x.day === d) ?? null;
    const b = byDay.get(d) ?? null;
    const row: Record<string, number | null> = { day: d, foodPrice: m ? foodPrice.find((p) => p.day === d)?.price ?? null : null };
    for (const s of series) {
      if (s.key === "foodPrice") continue;
      row[s.key] = m ? Number(m[s.key]) : null;
      row[`${s.key}_seen`] = b ? Number(b[s.key]) : null;
    }
    data.push(row);
  }
  return (
    <div className="analytics">
      {baseline && <p className="dim">Dashed: the Oracle's untouched run. Solid: this world.</p>}
      {series.map((s) => (
        <figure key={s.key} className="chart">
          <figcaption><strong>{s.title}</strong> <span className="dim">{s.note}</span></figcaption>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#223052" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#8c8378", fontSize: 10 }} stroke="#223052" minTickGap={30} />
              <YAxis tick={{ fill: "#8c8378", fontSize: 10 }} stroke="#223052" width={44} tickFormatter={(v: number) => s.fmt(v)} />
              <Tooltip contentStyle={{ background: "#0b1437", border: "1px solid #223052", fontSize: 12 }} labelFormatter={(d) => `Day ${d}`} formatter={(v: number) => [s.fmt(v), s.title]} />
              {s.key !== "foodPrice" && baseline && <Line type="monotone" dataKey={`${s.key}_seen`} stroke="#8c8378" strokeDasharray="4 3" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />}
              <Line type="monotone" dataKey={s.key} stroke="#f2c14e" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </figure>
      ))}
    </div>
  );
}
