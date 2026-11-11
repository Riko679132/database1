"""生成网站用的脱敏只读快照：web/public/data/ccus_public.sqlite + meta.json。

只读打开 data/ccus.sqlite，把可公开展示的字段导出到一个全新的小库，
网站（浏览器内 SQLite WASM）只读这份快照，永远不接触主库。

脱敏口径：不含本地 PDF 路径、raw_data 溯源路径/哈希、qc_reason（内部判定
理由）、batch_id、audit/candidate/失败日志等内部表。

用法: .venv\\Scripts\\python.exe tools/build_web_db.py [--db data/ccus.sqlite]
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

TEST_SQL = """
SELECT
  t.test_id, t.test_origin, t.qc_level,
  t.temperature_K, t.co2_vol_pct, t.co2_partial_kPa, t.total_pressure_kPa,
  t.gas_flow, t.liquid_volume, t.gas_liquid_ratio,
  t.initial_loading, t.rich_loading, t.lean_loading,
  r.recipe_id, r.recipe_type, r.wt_a, r.wt_b, r.water_wt, r.total_amine_wt,
  ca.standard_name AS amine_a, ca.amine_class AS amine_a_class,
  ca.cas_no AS amine_a_cas, ca.smiles AS amine_a_smiles, ca.mw AS amine_a_mw,
  cb.standard_name AS amine_b, cb.amine_class AS amine_b_class,
  cb.cas_no AS amine_b_cas, cb.smiles AS amine_b_smiles, cb.mw AS amine_b_mw,
  s.doi, s.title, s.authors, s.year, s.journal,
  l.loc_label, l.loc_detail
FROM test t
JOIN recipe r ON r.recipe_id = t.recipe_id
JOIN compound ca ON ca.compound_id = r.amine_a_id
LEFT JOIN compound cb ON cb.compound_id = r.amine_b_id
LEFT JOIN source s ON s.source_id = t.source_id
LEFT JOIN source_location l ON l.location_id = t.location_id
ORDER BY t.test_id
"""

PERF_SQL = """
SELECT p.perf_id, p.test_id, p.metric_name, p.value, p.unit,
       p.value_original, p.unit_original, p.error_value, p.repeat_count,
       p.metric_definition, p.is_derived
FROM performance p
JOIN test t ON t.test_id = p.test_id
ORDER BY p.test_id, p.perf_id
"""

SCHEMA = """
CREATE TABLE tests ({cols});
CREATE TABLE performance (
  perf_id INTEGER PRIMARY KEY,
  test_id INTEGER NOT NULL,
  metric_name TEXT NOT NULL,
  value REAL,
  unit TEXT,
  value_original REAL,
  unit_original TEXT,
  error_value REAL,
  repeat_count INTEGER,
  metric_definition TEXT,
  is_derived INTEGER
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_tests_origin_qc ON tests(test_origin, qc_level);
CREATE INDEX idx_perf_test ON performance(test_id);
CREATE INDEX idx_perf_metric ON performance(metric_name, value);
"""


TEXT_IDS = {"recipe_id"}


def col_type(name: str) -> str:
    if name in TEXT_IDS:
        return "TEXT"
    if name.endswith("_id") or name in {"year", "repeat_count"}:
        return "INTEGER"
    if name in {
        "temperature_K", "co2_vol_pct", "co2_partial_kPa", "total_pressure_kPa",
        "gas_flow", "liquid_volume", "gas_liquid_ratio", "initial_loading",
        "rich_loading", "lean_loading", "wt_a", "wt_b", "water_wt",
        "total_amine_wt", "amine_a_mw", "amine_b_mw", "value",
        "value_original", "error_value", "is_derived",
    }:
        return "REAL"
    return "TEXT"


def build(db_path: Path, out_dir: Path) -> None:
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")

    src = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row

    tests = src.execute(TEST_SQL).fetchall()
    perf = src.execute(PERF_SQL).fetchall()

    total_tests = src.execute("SELECT count(*) FROM test").fetchone()[0]
    if len(tests) != total_tests:
        raise SystemExit(
            f"row count mismatch: view={len(tests)} test={total_tests} "
            "(JOIN 丢了行，检查 recipe/source 外键)"
        )

    # 指标名过滤需要准确的值域，页面据此画筛选器
    metrics = {
        r["metric_name"]: {"count": r["n"], "min": r["lo"], "max": r["hi"], "unit": r["unit"]}
        for r in src.execute(
            """
            SELECT metric_name, count(*) AS n, min(value) AS lo, max(value) AS hi,
                   (SELECT unit FROM performance p2
                    WHERE p2.metric_name = p.metric_name AND p2.unit IS NOT NULL
                    LIMIT 1) AS unit
            FROM performance p GROUP BY metric_name ORDER BY metric_name
            """
        )
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    out_db = out_dir / "ccus_public.sqlite"
    if out_db.exists():
        out_db.unlink()

    fields = [d[0] for d in src.execute(TEST_SQL + " LIMIT 0").description]
    cols_sql = ", ".join(f'"{f}" {col_type(f)}' for f in fields)

    dst = sqlite3.connect(out_db)
    dst.executescript(SCHEMA.format(cols=cols_sql))
    dst.executemany(
        f'INSERT INTO tests ({",".join(chr(34) + f + chr(34) for f in fields)}) '
        f'VALUES ({",".join("?" * len(fields))})',
        [tuple(r) for r in tests],
    )
    dst.executemany(
        "INSERT INTO performance (perf_id,test_id,metric_name,value,unit,"
        "value_original,unit_original,error_value,repeat_count,"
        "metric_definition,is_derived) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [tuple(r) for r in perf],
    )

    years = [r["year"] for r in tests if r["year"] is not None]
    raw = db_path.read_bytes()
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_file": db_path.name,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "test_count": len(tests),
        "performance_count": len(perf),
        "literature_l2": sum(
            1 for r in tests if r["test_origin"] == "literature" and r["qc_level"] == "L2"
        ),
        "simulation": sum(1 for r in tests if r["test_origin"] == "simulation"),
        "source_count": len({r["doi"] for r in tests if r["doi"]}),
        "year_min": min(years) if years else None,
        "year_max": max(years) if years else None,
        "metrics": metrics,
    }
    dst.executemany(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        [(k, json.dumps(v, ensure_ascii=False)) for k, v in meta.items()],
    )
    dst.commit()
    dst.execute("VACUUM")
    dst.commit()
    dst.close()
    src.close()

    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 站点由 server 托管 web/dist 时，页面读的是 dist/data，必须同步镜像过去
    mirrored = _mirror_to_dist(out_dir)

    size = out_db.stat().st_size
    print(f"snapshot : {out_db.as_posix()} ({size/1024:.1f} KB)")
    if mirrored:
        print(f"mirror   : {mirrored.as_posix()}")
    print(f"tests    : {meta['test_count']}  performance: {meta['performance_count']}")
    print(f"L2 literature: {meta['literature_l2']}  simulation: {meta['simulation']}")
    print(f"sha256   : {meta['source_sha256'][:16]}…  generated_at: {meta['generated_at']}")


def _mirror_to_dist(out_dir: Path):
    root = Path(__file__).resolve().parent.parent
    public = (root / "web" / "public" / "data").resolve()
    dist = root / "web" / "dist"
    try:
        if out_dir.resolve() != public or not dist.is_dir():
            return None
        target = dist / "data"
        target.mkdir(parents=True, exist_ok=True)
        for name in ("ccus_public.sqlite", "meta.json"):
            shutil.copy2(out_dir / name, target / name)
        return target
    except OSError:
        return None


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(root / "data" / "ccus.sqlite"))
    ap.add_argument("--outdir", default=str(root / "web" / "public" / "data"))
    args = ap.parse_args()
    build(Path(args.db), Path(args.outdir))


if __name__ == "__main__":
    main()
