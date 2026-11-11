import type { Filters, QcLevel } from './types';
import { RANGE_FIELDS } from './fields';

export interface Preset {
  id: string;
  label: string;
  hint: string;
  origins: Filters['origins'];
  qcLevels: QcLevel[];
}

export const PRESETS: Preset[] = [
  {
    id: 'l2',
    label: 'L2 金标准',
    hint: '文献实验 · 原文完整单点且配方闭合',
    origins: ['literature'],
    qcLevels: ['L2'],
  },
  {
    id: 'exp',
    label: '全部实验数据',
    hint: '文献实验 · 含缺字段的 L3 记录',
    origins: ['literature'],
    qcLevels: ['L1', 'L2', 'L3'],
  },
  {
    id: 'all',
    label: '含仿真数据',
    hint: '实验 + 建模/模拟，仿真记录强制 L3 且不可混用',
    origins: ['literature', 'simulation'],
    qcLevels: ['L1', 'L2', 'L3'],
  },
];

export function presetOf(filters: Filters): string | null {
  const found = PRESETS.find(
    (p) =>
      p.origins.length === filters.origins.length &&
      p.qcLevels.length === filters.qcLevels.length &&
      p.origins.every((o) => filters.origins.includes(o)) &&
      p.qcLevels.every((q) => filters.qcLevels.includes(q)),
  );
  return found ? found.id : null;
}

export const defaultFilters: Filters = {
  q: '',
  origins: ['literature'],
  qcLevels: ['L2'],
  amines: [],
  amineClass: null,
  recipeType: 'all',
  journal: null,
  totalAmine: [null, null],
  temperature: [null, null],
  co2: [null, null],
  year: [null, null],
  co2Partial: [null, null],
  totalPressure: [null, null],
  initialLoading: [null, null],
  richLoading: [null, null],
  leanLoading: [null, null],
  gasLiquidRatio: [null, null],
  liquidVolume: [null, null],
  gasFlow: [null, null],
  metric: null,
  metricRange: [null, null],
};

export function applyPreset(filters: Filters, preset: Preset): Filters {
  return { ...filters, origins: [...preset.origins], qcLevels: [...preset.qcLevels] };
}

export function hasActiveFilters(filters: Filters): boolean {
  const rangeActive = RANGE_FIELDS.some((f) => filters[f.key].some((v) => v != null));
  return (
    filters.q.trim() !== '' ||
    filters.amines.length > 0 ||
    filters.amineClass != null ||
    filters.recipeType !== 'all' ||
    filters.journal != null ||
    rangeActive ||
    filters.metric !== null
  );
}

export function resetFilters(filters: Filters): Filters {
  const { origins, qcLevels } = filters;
  return { ...defaultFilters, origins, qcLevels };
}
