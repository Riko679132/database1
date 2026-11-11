import { useEffect, type ReactNode } from 'react';
import {
  amineLabel,
  celsius,
  concLabel,
  doiUrl,
  fmtMetric,
  fmtNum,
  metricLabel,
  originLabel,
  qcHint,
} from '../data/format';
import type { Perf, TestRow } from '../data/types';

interface Props {
  row: TestRow;
  perf: Perf[];
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{value == null || value === '' ? '—' : value}</dd>
    </div>
  );
}

export function DetailDrawer({ row, perf, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = doiUrl(row.doi);

  return (
    <div className="drawer-layer" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="drawer-amine">{amineLabel(row)}</div>
            <div className="drawer-sub">
              {concLabel(row)} · {row.recipe_type === 'mono' ? '单胺' : '复配'} ·{' '}
              {row.total_amine_wt != null ? `${fmtNum(row.total_amine_wt, 1)} wt% 总胺` : ''}
            </div>
          </div>
          <div className="drawer-badges">
            <span className={`badge qc-${row.qc_level.toLowerCase()}`} title={qcHint(row.qc_level)}>
              {row.qc_level}
            </span>
            <span className={`badge origin-${row.test_origin}`}>{originLabel(row.test_origin)}</span>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <h4>文献</h4>
            <div className="source-card">
              <div className="source-title">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {row.title ?? row.doi}
                  </a>
                ) : (
                  (row.title ?? '（无题名）')
                )}
              </div>
              <div className="source-meta">
                {[row.authors, row.journal, row.year].filter(Boolean).join(' · ') || '—'}
              </div>
              {row.doi && <div className="source-doi">{row.doi}</div>}
            </div>
          </section>

          <section className="drawer-section">
            <h4>配方</h4>
            <div className="amine-cards">
              <div className="amine-card">
                <div className="amine-card-head">
                  {row.amine_a}
                  <span>{fmtNum(row.wt_a, 2)} wt%</span>
                </div>
                <dl className="mini">
                  <Field label="类别" value={row.amine_a_class} />
                  <Field label="CAS" value={row.amine_a_cas} />
                  <Field label="分子量" value={row.amine_a_mw != null ? fmtNum(row.amine_a_mw, 2) : null} />
                  <Field
                    label="SMILES"
                    value={row.amine_a_smiles ? <code>{row.amine_a_smiles}</code> : null}
                  />
                </dl>
              </div>
              {row.amine_b && (
                <div className="amine-card">
                  <div className="amine-card-head">
                    {row.amine_b}
                    <span>{fmtNum(row.wt_b, 2)} wt%</span>
                  </div>
                  <dl className="mini">
                    <Field label="类别" value={row.amine_b_class} />
                    <Field label="CAS" value={row.amine_b_cas} />
                    <Field label="分子量" value={row.amine_b_mw != null ? fmtNum(row.amine_b_mw, 2) : null} />
                    <Field
                      label="SMILES"
                      value={row.amine_b_smiles ? <code>{row.amine_b_smiles}</code> : null}
                    />
                  </dl>
                </div>
              )}
            </div>
            <dl className="grid">
              <Field label="水 wt%" value={fmtNum(row.water_wt, 1)} />
              <Field label="总胺 wt%" value={fmtNum(row.total_amine_wt, 1)} />
            </dl>
          </section>

          <section className="drawer-section">
            <h4>工况</h4>
            <dl className="grid">
              <Field
                label="温度"
                value={`${fmtNum(row.temperature_K, 2)} K${row.temperature_K != null ? `（${celsius(row.temperature_K)}）` : ''}`}
              />
              <Field label="CO₂ 体积分数" value={row.co2_vol_pct != null ? `${fmtNum(row.co2_vol_pct, 2)} vol%` : null} />
              <Field label="CO₂ 分压" value={row.co2_partial_kPa != null ? `${fmtNum(row.co2_partial_kPa, 2)} kPa` : null} />
              <Field label="总压" value={row.total_pressure_kPa != null ? `${fmtNum(row.total_pressure_kPa, 2)} kPa` : null} />
              <Field label="气相流量" value={row.gas_flow != null ? fmtNum(row.gas_flow) : null} />
              <Field label="液相体积" value={row.liquid_volume != null ? fmtNum(row.liquid_volume) : null} />
              <Field label="气液比" value={row.gas_liquid_ratio != null ? fmtNum(row.gas_liquid_ratio) : null} />
              <Field label="初始负载" value={row.initial_loading != null ? `${fmtNum(row.initial_loading)} mol CO₂/mol amine` : null} />
              <Field label="富液负载" value={row.rich_loading != null ? `${fmtNum(row.rich_loading)} mol CO₂/mol amine` : null} />
              <Field label="贫液负载" value={row.lean_loading != null ? `${fmtNum(row.lean_loading)} mol CO₂/mol amine` : null} />
            </dl>
          </section>

          <section className="drawer-section">
            <h4>性能指标</h4>
            {perf.length ? (
              <div className="perf-list">
                {perf.map((p) => (
                  <div className="perf-item" key={p.perf_id}>
                    <div className="perf-top">
                      <span className="perf-name">
                        {metricLabel(p.metric_name)}
                        <code>{p.metric_name}</code>
                      </span>
                      <span className="perf-value">{fmtMetric(p.value, p.unit)}</span>
                    </div>
                    <div className="perf-meta">
                      {p.value_original != null && (
                        <span>
                          原文 {fmtNum(p.value_original, 4)} {p.unit_original ?? ''}
                        </span>
                      )}
                      {p.error_value != null && <span>误差 ±{fmtNum(p.error_value)}</span>}
                      {p.repeat_count != null && <span>重复 {p.repeat_count} 次</span>}
                      {p.is_derived ? <span className="tag">派生值</span> : null}
                    </div>
                    {p.metric_definition && <div className="perf-def">{p.metric_definition}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">该记录暂无性能指标</p>
            )}
          </section>

          <section className="drawer-section">
            <h4>溯源</h4>
            <dl className="grid">
              <Field label="原文位置" value={row.loc_label ?? row.loc_detail} />
              <Field label="test_id" value={<code>{row.test_id}</code>} />
              <Field label="recipe_id" value={<code className="break">{row.recipe_id.slice(0, 12)}…</code>} />
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}
