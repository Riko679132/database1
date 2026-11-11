import { amineLabel, concLabel, fmtMetric, metricLabel } from './format';
import type { Perf, TestRow } from './types';

const COLUMNS: [string, (r: TestRow, perf: Perf[]) => string | number][] = [
  ['test_id', (r) => r.test_id],
  ['amine_a', (r) => r.amine_a],
  ['amine_b', (r) => r.amine_b ?? ''],
  ['recipe', (r) => amineLabel(r)],
  ['concentration', (r) => concLabel(r)],
  ['recipe_type', (r) => r.recipe_type],
  ['total_amine_wt', (r) => r.total_amine_wt],
  ['water_wt', (r) => r.water_wt],
  ['temperature_K', (r) => r.temperature_K ?? ''],
  ['co2_vol_pct', (r) => r.co2_vol_pct ?? ''],
  ['co2_partial_kPa', (r) => r.co2_partial_kPa ?? ''],
  ['total_pressure_kPa', (r) => r.total_pressure_kPa ?? ''],
  ['initial_loading', (r) => r.initial_loading ?? ''],
  ['rich_loading', (r) => r.rich_loading ?? ''],
  ['lean_loading', (r) => r.lean_loading ?? ''],
  ['qc_level', (r) => r.qc_level],
  ['test_origin', (r) => r.test_origin],
  ['doi', (r) => r.doi ?? ''],
  ['title', (r) => r.title ?? ''],
  ['authors', (r) => r.authors ?? ''],
  ['year', (r) => r.year ?? ''],
  ['journal', (r) => r.journal ?? ''],
  ['location', (r) => r.loc_label ?? ''],
  [
    'metrics',
    (_r, perf) =>
      perf
        .map((p) => `${p.metric_name}=${fmtMetric(p.value, p.unit)}`)
        .join('; '),
  ],
];

function cell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: TestRow[], perfMap: Map<number, Perf[]>): string {
  const header = COLUMNS.map(([name]) => name).join(',');
  const lines = rows.map((r) =>
    COLUMNS.map(([, pick]) => cell(pick(r, perfMap.get(r.test_id) ?? []))).join(','),
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

export function downloadCsv(rows: TestRow[], perfMap: Map<number, Perf[]>): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([buildCsv(rows, perfMap)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ccus_tests_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function metricSummary(perf: Perf[], max = 2): string {
  if (!perf.length) return '—';
  return perf
    .slice(0, max)
    .map((p) => `${metricLabel(p.metric_name)} ${fmtMetric(p.value, p.unit)}`)
    .join(' · ');
}
