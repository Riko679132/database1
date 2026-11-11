import type { Facets, Filters, MetricInfo, Range } from '../data/types';
import { ADVANCED_FIELDS, PRIMARY_FIELDS } from '../data/fields';
import { fmtNum, metricLabel } from '../data/format';
import { hasActiveFilters } from '../data/presets';

interface Props {
  facets: Facets;
  metrics: Record<string, MetricInfo>;
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
}

function NumRange({
  value,
  onChange,
  step,
  placeholder,
}: {
  value: Range;
  onChange: (next: Range) => void;
  step?: number;
  placeholder?: [string, string];
}) {
  const toNum = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <div className="range">
      <input
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        value={value[0] ?? ''}
        placeholder={placeholder?.[0] ?? '下限'}
        onChange={(e) => onChange([toNum(e.target.value), value[1]])}
      />
      <span className="range-dash">–</span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        value={value[1] ?? ''}
        placeholder={placeholder?.[1] ?? '上限'}
        onChange={(e) => onChange([value[0], toNum(e.target.value)])}
      />
    </div>
  );
}

export function FilterPanel({ facets, metrics, filters, onChange, onReset }: Props) {
  const toggleAmine = (name: string) => {
    const has = filters.amines.includes(name);
    onChange({
      ...filters,
      amines: has ? filters.amines.filter((a) => a !== name) : [...filters.amines, name],
    });
  };

  const metricInfo = filters.metric ? metrics[filters.metric] : undefined;
  const b = facets.bounds;

  return (
    <aside className="filters">
      <div className="filters-head">
        <h2>筛选条件</h2>
        <button
          type="button"
          className="link-btn"
          onClick={onReset}
          disabled={!hasActiveFilters(filters)}
        >
          重置
        </button>
      </div>

      <section className="fgroup">
        <h3>胺名称</h3>
        <div className="chips">
          {facets.amines.map((a) => (
            <button
              type="button"
              key={a.name}
              className={`chip${filters.amines.includes(a.name) ? ' active' : ''}`}
              onClick={() => toggleAmine(a.name)}
            >
              {a.name}
              <span className="chip-count">{a.count}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="fgroup">
        <h3>胺种类</h3>
        <select
          className="select"
          value={filters.amineClass ?? ''}
          disabled={!facets.amineClasses.length}
          onChange={(e) => onChange({ ...filters, amineClass: e.target.value || null })}
        >
          <option value="">
            {facets.amineClasses.length ? '不限种类' : '暂无数据（字段已就绪）'}
          </option>
          {facets.amineClasses.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </section>

      <section className="fgroup">
        <h3>配方类型</h3>
        <div className="segmented small">
          {(
            [
              ['all', '全部'],
              ['mono', '单胺'],
              ['binary', '复配'],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={filters.recipeType === id ? 'active' : ''}
              onClick={() => onChange({ ...filters, recipeType: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {PRIMARY_FIELDS.map((f) => (
        <section className="fgroup" key={f.key}>
          <h3>
            {f.label}
            {f.unit && <span className="unit">{f.unit}</span>}
          </h3>
          <NumRange
            value={filters[f.key]}
            step={f.step}
            placeholder={[
              b[f.key][0] != null ? fmtNum(b[f.key][0]) : '下限',
              b[f.key][1] != null ? fmtNum(b[f.key][1]) : '上限',
            ]}
            onChange={(v) => onChange({ ...filters, [f.key]: v })}
          />
        </section>
      ))}

      <section className="fgroup">
        <h3>性能指标</h3>
        <select
          className="select"
          value={filters.metric ?? ''}
          onChange={(e) => {
            const m = e.target.value || null;
            onChange({ ...filters, metric: m, metricRange: [null, null] });
          }}
        >
          <option value="">不限指标</option>
          {Object.entries(metrics)
            .sort((a, b2) => b2[1].count - a[1].count)
            .map(([name, info]) => (
              <option key={name} value={name}>
                {metricLabel(name)}（{info.count}）
              </option>
            ))}
        </select>
        {filters.metric && (
          <div className="metric-range">
            <NumRange
              value={filters.metricRange}
              placeholder={[
                metricInfo?.min != null ? fmtNum(metricInfo.min) : '下限',
                metricInfo?.max != null ? fmtNum(metricInfo.max) : '上限',
              ]}
              onChange={(v) => onChange({ ...filters, metricRange: v })}
            />
            {metricInfo?.unit && <div className="hint">单位：{metricInfo.unit}</div>}
          </div>
        )}
      </section>

      <details className="fmore">
        <summary>
          更多条件
          <span className="hint-inline">压力 / 负载 / 气液比 / 期刊</span>
        </summary>

        <section className="fgroup">
          <h3>期刊</h3>
          <select
            className="select"
            value={filters.journal ?? ''}
            onChange={(e) => onChange({ ...filters, journal: e.target.value || null })}
          >
            <option value="">不限期刊</option>
            {facets.journals.map((j) => (
              <option key={j.name} value={j.name}>
                {j.name}（{j.count}）
              </option>
            ))}
          </select>
        </section>

        {ADVANCED_FIELDS.map((f) => (
          <section className="fgroup" key={f.key}>
            <h3>
              {f.label}
              {f.unit && <span className="unit">{f.unit}</span>}
            </h3>
            <NumRange
              value={filters[f.key]}
              step={f.step}
              placeholder={[
                b[f.key][0] != null ? fmtNum(b[f.key][0]) : '下限',
                b[f.key][1] != null ? fmtNum(b[f.key][1]) : '上限',
              ]}
              onChange={(v) => onChange({ ...filters, [f.key]: v })}
            />
          </section>
        ))}
      </details>
    </aside>
  );
}
