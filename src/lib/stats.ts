/** Field statistics, as in QGIS's Statistics panel. */

export interface NumericStats { kind: "numeric"; count: number; nulls: number; sum: number; mean: number; median: number; min: number; max: number; stddev: number; unique: number; histogram: { from: number; to: number; n: number }[] }
export interface TextStats { kind: "text"; count: number; nulls: number; unique: number; minLength: number; maxLength: number; top: [string, number][] }

export function fieldStats(values: unknown[], bins = 20): NumericStats | TextStats {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  const nulls = values.length - present.length;
  const nums = present.map(Number);
  if (present.length && present.every((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))))) {
    const sorted = [...nums].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    // Sample standard deviation, as QGIS reports it.
    const stddev = n > 1 ? Math.sqrt(sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    const [min, max] = [sorted[0], sorted[n - 1]];
    const width = (max - min) / bins || 1;
    const histogram = Array.from({ length: min === max ? 1 : bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, n: 0 }));
    for (const v of sorted) histogram[Math.min(histogram.length - 1, Math.floor((v - min) / width))].n++;
    return { kind: "numeric", count: n, nulls, sum, mean, median, min, max, stddev, unique: new Set(sorted).size, histogram };
  }
  const strings = present.map(String);
  const counts = new Map<string, number>();
  for (const s of strings) counts.set(s, (counts.get(s) ?? 0) + 1);
  const lengths = strings.map((s) => s.length);
  return {
    kind: "text",
    count: strings.length,
    nulls,
    unique: counts.size,
    minLength: lengths.length ? Math.min(...lengths) : 0,
    maxLength: lengths.length ? Math.max(...lengths) : 0,
    top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}
