import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataProvider, Facets, Filters, Perf, SnapshotMeta, TestRow } from '../data/types';
import { PRESETS, applyPreset, presetOf, resetFilters } from '../data/presets';
import { downloadCsv } from '../data/csv';
import { FilterPanel } from '../components/FilterPanel';
import { ResultsTable, type SortDir, type SortKey } from '../components/ResultsTable';
import { DetailDrawer } from '../components/DetailDrawer';

interface Props {
  provider: DataProvider;
  meta: SnapshotMeta;
  facets: Facets;
  perfMap: Map<number, Perf[]>;
  filters: Filters;
  onFilters: (next: Filters) => void;
}

export function SearchPage({ provider, meta, facets, perfMap, filters, onFilters }: Props) {
  const [rows, setRows] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TestRow | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'year', dir: 'desc' });
  const firstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(
      () => {
        provider
          .query(filters)
          .then((r) => {
            if (cancelled) return;
            setRows(r);
            setError(null);
            setLoading(false);
            firstLoad.current = false;
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          });
      },
      firstLoad.current ? 0 : 120,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [provider, filters]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const av = a[key] as number | null;
      const bv = b[key] as number | null;
      if (av == null && bv == null) return a.test_id - b.test_id;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sort]);

  const activePreset = presetOf(filters);
  const presetHint = PRESETS.find((p) => p.id === activePreset)?.hint ?? '自定义筛选条件';

  const handleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'year' ? 'desc' : 'asc' },
    );
  };

  return (
    <main className="layout">
      <FilterPanel
        facets={facets}
        metrics={meta.metrics}
        filters={filters}
        onChange={onFilters}
        onReset={() => onFilters(resetFilters(filters))}
      />

      <section className="content">
        <div className="preset-row">
          <div className="segmented">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={activePreset === p.id ? 'active' : ''}
                onClick={() => onFilters(applyPreset(filters, p))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="preset-hint">
            {presetHint}
            {loading && <em> · 查询中…</em>}
          </span>
        </div>

        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              type="search"
              value={filters.q}
              placeholder="搜索胺名称、文献标题、DOI、作者、期刊…"
              onChange={(e) => onFilters({ ...filters, q: e.target.value })}
            />
          </div>
          <div className="toolbar-actions">
            <span className="count">
              <b>{sorted.length}</b> / {meta.test_count} 条
            </span>
            <button
              type="button"
              className="btn"
              disabled={!sorted.length}
              onClick={() => downloadCsv(sorted, perfMap)}
            >
              导出 CSV
            </button>
          </div>
        </div>

        {error && <div className="inline-error">{error}</div>}

        {loading && !sorted.length ? (
          <div className="loading">正在查询…</div>
        ) : (
          <ResultsTable
            rows={sorted}
            perfMap={perfMap}
            sort={sort}
            onSort={handleSort}
            onSelect={setSelected}
            selectedId={selected?.test_id ?? null}
          />
        )}

        <p className="legend">
          默认只展示 L2 金标准：原文完整单点（温度 / CO₂ 浓度 / 初始负载齐全）且配方闭合。
          仿真数据强制 L3，切到「含仿真数据」时请勿与实验数据混用。
        </p>
      </section>

      {selected && (
        <DetailDrawer
          row={selected}
          perf={perfMap.get(selected.test_id) ?? []}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
