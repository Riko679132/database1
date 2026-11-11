import { useEffect, useState } from 'react';
import { createSqliteProvider } from './data/sqliteProvider';
import type { DataProvider, Facets, Filters, Perf, SnapshotMeta } from './data/types';
import { defaultFilters } from './data/presets';
import { CONSOLE_ENABLED, isConsoleRoute, useRoute } from './data/routing';
import { Nav } from './components/Nav';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { ConsolePage } from './pages/ConsolePage';
import { RunPage } from './pages/RunPage';
import { SettingsPage } from './pages/SettingsPage';

interface Boot {
  provider: DataProvider;
  meta: SnapshotMeta;
  facets: Facets;
  perfMap: Map<number, Perf[]>;
}

export default function App() {
  const rawRoute = useRoute();
  const route = CONSOLE_ENABLED || !isConsoleRoute(rawRoute) ? rawRoute : ({ name: 'home' } as const);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const consoleRoute = isConsoleRoute(route);

  useEffect(() => {
    let alive = true;
    createSqliteProvider()
      .then(async (provider) => {
        const [facets, perfMap] = await Promise.all([
          provider.facets(),
          provider.allPerformance(),
        ]);
        if (!alive) return;
        setBoot({ provider, meta: provider.meta(), facets, perfMap });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (error && !consoleRoute) {
    return (
      <div className="fatal">
        <h1>无法启动数据集</h1>
        <p>{error}</p>
        <pre>npm run sync</pre>
        <p className="muted">该命令读取 data/ccus.sqlite 并重新生成只读快照。</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Nav route={route} meta={boot?.meta ?? null} />

      {consoleRoute ? (
        route.name === 'run' ? (
          <RunPage id={route.id} />
        ) : route.name === 'settings' ? (
          <SettingsPage />
        ) : (
          <ConsolePage />
        )
      ) : !boot ? (
        <div className="boot">正在加载数据库快照…</div>
      ) : route.name === 'home' ? (
        <HomePage meta={boot.meta} facets={boot.facets} />
      ) : (
        <SearchPage
          provider={boot.provider}
          meta={boot.meta}
          facets={boot.facets}
          perfMap={boot.perfMap}
          filters={filters}
          onFilters={setFilters}
        />
      )}

      {!consoleRoute && (
        <footer className="footer">
          <span>
            数据来源：水相单胺与双组分复配胺，总胺 20–50 wt%，无添加剂 / 盐 / 两相 / 浆料。
          </span>
          {boot && (
            <span>
              只读快照，由 <code>tools/build_web_db.py</code> 生成 · 原始库{' '}
              {boot.meta.source_file} · {boot.meta.literature_l2} 条 L2 实验 · {boot.meta.simulation}{' '}
              条仿真
            </span>
          )}
        </footer>
      )}
    </div>
  );
}
