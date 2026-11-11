import { amineLabel, concLabel, doiUrl, fmtNum, originLabel, qcHint } from '../data/format';
import { metricSummary } from '../data/csv';
import type { Perf, TestRow } from '../data/types';

export type SortKey = 'year' | 'total_amine_wt' | 'temperature_K' | 'co2_vol_pct' | 'test_id';
export type SortDir = 'asc' | 'desc';

interface Props {
  rows: TestRow[];
  perfMap: Map<number, Perf[]>;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  onSelect: (row: TestRow) => void;
  selectedId: number | null;
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  k: SortKey;
  sort: Props['sort'];
  onSort: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={numeric ? 'num sortable' : 'sortable'}>
      <button type="button" onClick={() => onSort(k)} className={active ? 'active' : ''}>
        {label}
        <span className="arrow">{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

export function ResultsTable({ rows, perfMap, sort, onSort, onSelect, selectedId }: Props) {
  if (!rows.length) {
    return (
      <div className="empty">
        <div className="empty-mark">∅</div>
        <p>没有符合条件的记录</p>
        <span>试试放宽浓度/温度区间，或切换到「全部实验数据」</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="results">
        <thead>
          <tr>
            <th className="col-idx">#</th>
            <th>胺 / 配方</th>
            <SortHead label="总胺 wt%" k="total_amine_wt" sort={sort} onSort={onSort} numeric />
            <SortHead label="T (K)" k="temperature_K" sort={sort} onSort={onSort} numeric />
            <SortHead label="CO₂ vol%" k="co2_vol_pct" sort={sort} onSort={onSort} numeric />
            <th>关键指标</th>
            <th>QC</th>
            <th>来源</th>
            <SortHead label="年份" k="year" sort={sort} onSort={onSort} numeric />
            <th>文献</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const url = doiUrl(r.doi);
            return (
              <tr
                key={r.test_id}
                className={selectedId === r.test_id ? 'selected' : undefined}
                onClick={() => onSelect(r)}
              >
                <td className="col-idx">{i + 1}</td>
                <td>
                  <div className="amine">{amineLabel(r)}</div>
                  <div className="sub">
                    {concLabel(r)} · {r.recipe_type === 'mono' ? '单胺' : '复配'}
                  </div>
                </td>
                <td className="num">{fmtNum(r.total_amine_wt, 1)}</td>
                <td className="num">
                  {fmtNum(r.temperature_K, 2)}
                  <div className="sub">{r.temperature_K != null ? `${fmtNum(r.temperature_K - 273.15, 1)} °C` : ''}</div>
                </td>
                <td className="num">
                  {fmtNum(r.co2_vol_pct, 1)}
                  {r.co2_vol_pct == null && r.co2_partial_kPa != null && (
                    <div className="sub">{fmtNum(r.co2_partial_kPa, 1)} kPa</div>
                  )}
                </td>
                <td>
                  <div className="metrics" title={metricSummary(perfMap.get(r.test_id) ?? [], 99)}>
                    {metricSummary(perfMap.get(r.test_id) ?? [])}
                  </div>
                </td>
                <td>
                  <span className={`badge qc-${r.qc_level.toLowerCase()}`} title={qcHint(r.qc_level)}>
                    {r.qc_level}
                  </span>
                </td>
                <td>
                  <span className={`badge origin-${r.test_origin}`}>{originLabel(r.test_origin)}</span>
                </td>
                <td className="num">{r.year ?? '—'}</td>
                <td className="col-source">
                  <div className="title" title={r.title ?? ''}>
                    {r.title ?? '（无题名）'}
                  </div>
                  <div className="sub">
                    {r.journal ?? '—'}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        DOI
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
