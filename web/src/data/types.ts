export type Origin = 'literature' | 'simulation';
export type QcLevel = 'L1' | 'L2' | 'L3';

export interface MetricInfo {
  count: number;
  min: number | null;
  max: number | null;
  unit: string | null;
}

export interface SnapshotMeta {
  generated_at: string;
  source_file: string;
  source_sha256: string;
  test_count: number;
  performance_count: number;
  literature_l2: number;
  simulation: number;
  source_count: number;
  year_min: number | null;
  year_max: number | null;
  metrics: Record<string, MetricInfo>;
}

export interface Perf {
  perf_id: number;
  test_id: number;
  metric_name: string;
  value: number | null;
  unit: string | null;
  value_original: number | null;
  unit_original: string | null;
  error_value: number | null;
  repeat_count: number | null;
  metric_definition: string | null;
  is_derived: number | null;
}

export interface TestRow {
  test_id: number;
  test_origin: Origin;
  qc_level: QcLevel;
  temperature_K: number | null;
  co2_vol_pct: number | null;
  co2_partial_kPa: number | null;
  total_pressure_kPa: number | null;
  gas_flow: number | null;
  liquid_volume: number | null;
  gas_liquid_ratio: number | null;
  initial_loading: number | null;
  rich_loading: number | null;
  lean_loading: number | null;
  recipe_id: string;
  recipe_type: 'mono' | 'binary';
  wt_a: number;
  wt_b: number | null;
  water_wt: number;
  total_amine_wt: number;
  amine_a: string;
  amine_a_class: string | null;
  amine_a_cas: string | null;
  amine_a_smiles: string | null;
  amine_a_mw: number | null;
  amine_b: string | null;
  amine_b_class: string | null;
  amine_b_cas: string | null;
  amine_b_smiles: string | null;
  amine_b_mw: number | null;
  doi: string | null;
  title: string | null;
  authors: string | null;
  year: number | null;
  journal: string | null;
  loc_label: string | null;
  loc_detail: string | null;
}

export type Range = [number | null, number | null];

export type RangeKey =
  | 'totalAmine'
  | 'temperature'
  | 'co2'
  | 'year'
  | 'co2Partial'
  | 'totalPressure'
  | 'initialLoading'
  | 'richLoading'
  | 'leanLoading'
  | 'gasLiquidRatio'
  | 'liquidVolume'
  | 'gasFlow';

export interface Filters extends Record<RangeKey, Range> {
  q: string;
  origins: Origin[];
  qcLevels: QcLevel[];
  amines: string[];
  amineClass: string | null;
  recipeType: 'all' | 'mono' | 'binary';
  journal: string | null;
  metric: string | null;
  metricRange: Range;
}

export type Bounds = Record<RangeKey, [number | null, number | null]>;

export interface Facets {
  amines: { name: string; count: number }[];
  amineClasses: string[];
  journals: { name: string; count: number }[];
  bounds: Bounds;
}

export interface DataProvider {
  meta(): SnapshotMeta;
  facets(): Promise<Facets>;
  query(filters: Filters): Promise<TestRow[]>;
  allPerformance(): Promise<Map<number, Perf[]>>;
  performanceOf(testId: number): Promise<Perf[]>;
}
