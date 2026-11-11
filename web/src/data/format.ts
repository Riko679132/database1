import type { TestRow } from './types';

export const METRIC_LABELS: Record<string, string> = {
  equilibrium_loading: '平衡溶解度',
  cyclic_capacity: '循环容量',
  cyclic_capacity_volumetric: '体积循环容量',
  regeneration_energy: '再生能耗',
  regeneration_heat: '再生热',
  regeneration_efficiency: '再生效率',
  initial_absorption_rate: '初始吸收速率',
  initial_desorption_rate: '初始解吸速率',
  absorption_rate_volumetric: '体积吸收速率',
  absorption_amount_volumetric: '体积吸收量',
  co2_removal_efficiency: 'CO₂ 脱除效率',
  cost_per_tonne_co2: '吨 CO₂ 成本',
  iron_solubility: '铁溶解度',
  pka: 'pKa',
  model_prediction_deviation: '模型预测偏差',
  annual_energy_consumption_reduction: '年能耗降低',
  aard_equilibrium_co2_partial_pressure: 'AARD（CO₂ 分压）',
};

export function metricLabel(name: string): string {
  return METRIC_LABELS[name] ?? name;
}

export function fmtStamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 1 : abs >= 100 ? digits - 1 : digits;
  return v.toFixed(Math.max(0, d)).replace(/\.?0+$/, '');
}

export function fmtMetric(v: number | null, unit: string | null): string {
  if (v == null) return '—';
  return unit ? `${fmtNum(v)} ${unit}` : fmtNum(v);
}

export function amineLabel(row: TestRow): string {
  return row.amine_b ? `${row.amine_a} + ${row.amine_b}` : row.amine_a;
}

export function concLabel(row: TestRow): string {
  return row.wt_b != null
    ? `${fmtNum(row.wt_a, 2)}% + ${fmtNum(row.wt_b, 2)}%`
    : `${fmtNum(row.wt_a, 2)}%`;
}

export function celsius(k: number | null): string {
  return k == null ? '—' : `${fmtNum(k - 273.15, 1)} °C`;
}

export function doiUrl(doi: string | null): string | null {
  if (!doi) return null;
  return doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
}

export function qcHint(level: string): string {
  switch (level) {
    case 'L1':
      return '作者提供的原始数据点，可直接复算';
    case 'L2':
      return '全文完整单点：温度/CO₂ 浓度/初始负载齐全且配方闭合';
    case 'L3':
      return '缺必填字段或仿真数据，仅供参考';
    default:
      return '';
  }
}

export function originLabel(origin: string): string {
  return origin === 'simulation' ? '仿真' : '实验';
}
