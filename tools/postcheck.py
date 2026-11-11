"""入库后核验：只读打开数据库，输出质控看板 + 五项硬指标判定。

属于「文献数据提取与质控」职责内工具，不参与抽数、不写库。

用法:
    python tools/postcheck.py                 # 全量核验
    python tools/postcheck.py --batch 20261027_08   # 只看某批次

退出码：0 = 全部通过；1 = 存在硬指标违例（用于批处理串联）。
"""
import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "ccus.sqlite"

HARD_CHECKS = [
    ("L2 缺原始数据快照",
     "select count(*) from test where qc_level='L2' and (raw_data_path is null or raw_data_hash is null)",
     lambda n: n == 0),
    ("simulation 未强制 L3",
     "select count(*) from test where test_origin='simulation' and qc_level!='L3'",
     lambda n: n == 0),
    ("simulation 混入 L1/L2",
     "select count(*) from test where test_origin='simulation' and qc_level in ('L1','L2')",
     lambda n: n == 0),
    ("L2 配方不闭合",
     "select count(*) from test t join recipe r on r.recipe_id=t.recipe_id "
     "where t.qc_level in ('L1','L2') and abs(r.wt_a + coalesce(r.wt_b,0) + r.water_wt - 100) > 0.1",
     lambda n: n == 0),
    ("binary 配方缺 amine_b 身份",
     "select count(*) from recipe r left join compound c on c.compound_id=r.amine_b_id "
     "where r.recipe_type='binary' and (c.inchikey is null or c.inchikey='')",
     lambda n: n == 0),
]


def scalar(cur, sql, args=()):
    row = cur.execute(sql, args).fetchone()
    return row[0] if row else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", help="只统计该 batch_id 的 test/performance")
    args = ap.parse_args()

    if not DB.exists():
        print(f"[FAIL] 数据库不存在: {DB}")
        return 1

    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    cur = con.cursor()
    where, params = ("where batch_id=?", (args.batch,)) if args.batch else ("", ())

    print("=" * 62)
    print("入库后核验", f"（batch={args.batch}）" if args.batch else "（全库）")
    print("=" * 62)

    print("\n[规模]")
    for tbl in ("compound", "recipe", "source", "source_location", "test", "performance", "audit_log"):
        print(f"  {tbl:<16}{scalar(cur, f'select count(*) from {tbl}'):>8}")
    n_bin = scalar(cur, "select count(*) from recipe where recipe_type='binary'")
    n_mono = scalar(cur, "select count(*) from recipe where recipe_type='mono'")
    print(f"  {'recipe binary':<16}{n_bin:>8}")
    print(f"  {'recipe mono':<16}{n_mono:>8}")

    print("\n[QC 分布]")
    rows = cur.execute(
        "select test_origin, qc_level, count(*) from test "
        + (where + " " if where else "")
        + "group by test_origin, qc_level order by test_origin, qc_level",
        params,
    ).fetchall()
    for origin, level, n in rows:
        print(f"  {origin:<12}{str(level):<6}{n:>6}")
    if not rows:
        print("  （无记录）")

    print("\n[硬指标]")
    failed = 0
    for label, sql, ok in HARD_CHECKS:
        n = scalar(cur, sql)
        good = ok(n)
        failed += 0 if good else 1
        print(f"  [{'PASS' if good else 'FAIL'}] {label}: {n}")

    fk = cur.execute("pragma foreign_key_check").fetchall()
    print(f"  [{'PASS' if not fk else 'FAIL'}] 外键违例: {len(fk)}")
    failed += 0 if not fk else 1

    integrity = scalar(cur, "pragma integrity_check")
    print(f"  [{'PASS' if integrity == 'ok' else 'FAIL'}] integrity_check: {integrity}")
    failed += 0 if integrity == "ok" else 1

    print("\n[L2 溯源]")
    miss = cur.execute(
        "select test_id, batch_id, raw_data_path from test "
        "where qc_level='L2' and raw_data_path is not null"
    ).fetchall()
    broken = [(t, b, p) for t, b, p in miss if not (ROOT / p).exists()]
    print(f"  快照文件存在性: {len(miss) - len(broken)}/{len(miss)}")
    for t, b, p in broken[:10]:
        print(f"    MISSING test#{t} {b} {p}")
    failed += 1 if broken else 0

    con.close()
    print("\n" + "=" * 62)
    print("结论:", "全部通过" if failed == 0 else f"{failed} 项不通过")
    print("=" * 62)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
