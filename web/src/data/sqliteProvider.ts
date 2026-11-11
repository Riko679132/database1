import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type {
  Bounds,
  DataProvider,
  Facets,
  Filters,
  Perf,
  SnapshotMeta,
  TestRow,
} from './types';
import { RANGE_FIELDS } from './fields';

const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/ccus_public.sqlite`;

function select<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

function readMeta(db: Database): SnapshotMeta {
  const rows = select<{ key: string; value: string }>(db, 'SELECT key, value FROM meta');
  const raw: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    try {
      raw[key] = JSON.parse(value);
    } catch {
      raw[key] = value;
    }
  }
  return raw as unknown as SnapshotMeta;
}

function buildWhere(f: Filters): { clause: string; params: SqlValue[] } {
  const conds: string[] = [];
  const params: SqlValue[] = [];

  if (f.origins.length) {
    conds.push(`t.test_origin IN (${f.origins.map(() => '?').join(',')})`);
    params.push(...f.origins);
  }
  if (f.qcLevels.length) {
    conds.push(`t.qc_level IN (${f.qcLevels.map(() => '?').join(',')})`);
    params.push(...f.qcLevels);
  }
  if (f.recipeType !== 'all') {
    conds.push('t.recipe_type = ?');
    params.push(f.recipeType);
  }
  if (f.amines.length) {
    const ph = f.amines.map(() => '?').join(',');
    conds.push(`(t.amine_a IN (${ph}) OR t.amine_b IN (${ph}))`);
    params.push(...f.amines, ...f.amines);
  }
  if (f.amineClass) {
    conds.push('(t.amine_a_class = ? OR t.amine_b_class = ?)');
    params.push(f.amineClass, f.amineClass);
  }
  if (f.journal) {
    conds.push('t.journal = ?');
    params.push(f.journal);
  }

  for (const field of RANGE_FIELDS) {
    const [lo, hi] = f[field.key];
    if (lo != null) {
      conds.push(`t.${field.column} >= ?`);
      params.push(lo);
    }
    if (hi != null) {
      conds.push(`t.${field.column} <= ?`);
      params.push(hi);
    }
  }

  const q = f.q.trim().toLowerCase();
  if (q) {
    const like = `%${q}%`;
    conds.push(
      `(lower(t.title) LIKE ? OR lower(t.doi) LIKE ? OR lower(t.amine_a) LIKE ?
        OR lower(COALESCE(t.amine_b,'')) LIKE ? OR lower(COALESCE(t.journal,'')) LIKE ?
        OR lower(COALESCE(t.authors,'')) LIKE ?)`,
    );
    params.push(like, like, like, like, like, like);
  }

  if (f.metric) {
    const sub = ['p.test_id = t.test_id', 'p.metric_name = ?'];
    const subParams: SqlValue[] = [f.metric];
    if (f.metricRange[0] != null) {
      sub.push('p.value >= ?');
      subParams.push(f.metricRange[0]);
    }
    if (f.metricRange[1] != null) {
      sub.push('p.value <= ?');
      subParams.push(f.metricRange[1]);
    }
    conds.push(`EXISTS (SELECT 1 FROM performance p WHERE ${sub.join(' AND ')})`);
    params.push(...subParams);
  }

  return {
    clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

export async function createSqliteProvider(): Promise<DataProvider> {
  const SQL = await initSqlJs({
    locateFile: (file) => `${import.meta.env.BASE_URL}${file}`,
  });

  const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `无法加载数据库快照（HTTP ${res.status}）。请运行 npm run sync 重新生成。`,
    );
  }
  const db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
  const meta = readMeta(db);

  let perfCache: Map<number, Perf[]> | null = null;

  const loadPerf = (): Map<number, Perf[]> => {
    if (!perfCache) {
      const all = select<Perf>(
        db,
        `SELECT perf_id, test_id, metric_name, value, unit, value_original,
                unit_original, error_value, repeat_count, metric_definition, is_derived
         FROM performance ORDER BY perf_id`,
      );
      perfCache = new Map();
      for (const p of all) {
        const list = perfCache.get(p.test_id) ?? [];
        list.push(p);
        perfCache.set(p.test_id, list);
      }
    }
    return perfCache;
  };

  return {
    meta: () => meta,

    async facets(): Promise<Facets> {
      const amines = select<{ name: string; count: number }>(
        db,
        `SELECT amine AS name, count(*) AS count FROM (
           SELECT amine_a AS amine FROM tests
           UNION ALL
           SELECT amine_b FROM tests WHERE amine_b IS NOT NULL
         ) GROUP BY amine ORDER BY count DESC, amine`,
      );
      const amineClasses = select<{ name: string }>(
        db,
        `SELECT DISTINCT amine_class AS name FROM (
           SELECT amine_a_class AS amine_class FROM tests
           UNION ALL SELECT amine_b_class FROM tests
         ) WHERE amine_class IS NOT NULL ORDER BY name`,
      ).map((r) => r.name);

      const journals = select<{ name: string; count: number }>(
        db,
        `SELECT journal AS name, count(*) AS count FROM tests
         WHERE journal IS NOT NULL AND journal <> ''
         GROUP BY journal ORDER BY count DESC, name`,
      );

      const cols = RANGE_FIELDS.map(
        (f) => `min(${f.column}) AS "${f.key}_lo", max(${f.column}) AS "${f.key}_hi"`,
      ).join(', ');
      const [row] = select<Record<string, number | null>>(db, `SELECT ${cols} FROM tests`);
      const bounds = {} as Bounds;
      for (const f of RANGE_FIELDS) {
        bounds[f.key] = [row[`${f.key}_lo`] ?? null, row[`${f.key}_hi`] ?? null];
      }

      return { amines, amineClasses, journals, bounds };
    },

    async query(filters: Filters): Promise<TestRow[]> {
      const { clause, params } = buildWhere(filters);
      return select<TestRow>(
        db,
        `SELECT * FROM tests t ${clause}
         ORDER BY t.year IS NULL, t.year DESC, t.test_id`,
        params,
      );
    },

    async allPerformance(): Promise<Map<number, Perf[]>> {
      return loadPerf();
    },

    async performanceOf(testId: number): Promise<Perf[]> {
      return loadPerf().get(testId) ?? [];
    },
  };
}
