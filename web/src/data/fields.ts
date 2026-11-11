import type { RangeKey } from './types';

export interface RangeField {
  key: RangeKey;
  column: string;
  label: string;
  unit: string;
  step?: number;
  advanced?: boolean;
}

export const RANGE_FIELDS: RangeField[] = [
  { key: 'totalAmine', column: 'total_amine_wt', label: '总胺浓度', unit: 'wt%', step: 1 },
  { key: 'temperature', column: 'temperature_K', label: '温度', unit: 'K', step: 0.1 },
  { key: 'co2', column: 'co2_vol_pct', label: 'CO₂ 体积分数', unit: 'vol%', step: 0.1 },
  { key: 'year', column: 'year', label: '发表年份', unit: 'year', step: 1 },
  { key: 'co2Partial', column: 'co2_partial_kPa', label: 'CO₂ 分压', unit: 'kPa', step: 0.1, advanced: true },
  { key: 'totalPressure', column: 'total_pressure_kPa', label: '总压', unit: 'kPa', step: 1, advanced: true },
  { key: 'initialLoading', column: 'initial_loading', label: '初始负载', unit: 'mol/mol', step: 0.01, advanced: true },
  { key: 'richLoading', column: 'rich_loading', label: '富液负载', unit: 'mol/mol', step: 0.01, advanced: true },
  { key: 'leanLoading', column: 'lean_loading', label: '贫液负载', unit: 'mol/mol', step: 0.01, advanced: true },
  { key: 'gasLiquidRatio', column: 'gas_liquid_ratio', label: '气液比', unit: '', step: 0.1, advanced: true },
  { key: 'liquidVolume', column: 'liquid_volume', label: '液相体积', unit: '', step: 1, advanced: true },
  { key: 'gasFlow', column: 'gas_flow', label: '气相流量', unit: '', step: 1, advanced: true },
];

export const PRIMARY_FIELDS = RANGE_FIELDS.filter((f) => !f.advanced);
export const ADVANCED_FIELDS = RANGE_FIELDS.filter((f) => f.advanced);
