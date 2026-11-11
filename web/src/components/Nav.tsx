import { fmtStamp } from '../data/format';
import { CONSOLE_ENABLED, href, isConsoleRoute, type Route } from '../data/routing';
import type { SnapshotMeta } from '../data/types';

export function Nav({ route, meta }: { route: Route; meta: SnapshotMeta | null }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="mark">C</div>
        <div>
          <h1>CCUS 胺法碳捕集数据集</h1>
          <p>结构化文献实验数据 · 本地工作台</p>
        </div>
      </div>

      <nav className="nav-links">
        <a href={href.home} className={route.name === 'home' ? 'active' : ''}>
          首页
        </a>
        <a href={href.search} className={route.name === 'search' ? 'active' : ''}>
          数据检索
        </a>
        {CONSOLE_ENABLED && (
          <a href={href.console} className={isConsoleRoute(route) ? 'active' : ''}>
            工作台
          </a>
        )}
      </nav>

      {meta && (
        <div className="snapshot-chip" title={`sha256 ${meta.source_sha256}`}>
          <span className="dot" />
          快照 {fmtStamp(meta.generated_at)}
          <span className="sep">·</span>
          {meta.test_count} 条测试 / {meta.performance_count} 条指标
          <span className="sep">·</span>
          sha {meta.source_sha256.slice(0, 8)}
        </div>
      )}
    </header>
  );
}
