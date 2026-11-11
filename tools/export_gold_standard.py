"""导出 L2 金标准数据集到项目根目录（gold_standard_L2.json / .csv）。

筛选口径：test.qc_level='L2' AND test.test_origin='literature'。
这是训练集的第一块基石——只含经原始数据快照溯源的真实实验单点，
仿真数据（test_origin='simulation'，强制 L3）永远不进这里。

用法: .venv\Scripts\python.exe tools\export_gold_standard.py [--db data/ccus.sqlite]
"""
import argparse
import csv
import json
import sqlite3
from datetime import datetime
from pathlib import Path

SQL = """
SELECT t.test_id, t.batch_id, t.test_origin, t.qc_level,
       t.temperature_K, t.co2_vol_pct, t.co2_partial_kPa, t.total_pressure_kPa,
       t.gas_flow, t.liquid_volume, t.gas_liquid_ratio,
       t.initial_loading, t.rich_loading, t.lean_loading,
       t.raw_data_path, t.raw_data_hash, t.qc_reason,
       r.recipe_id, r.recipe_type, r.wt_a, r.wt_b, r.water_wt, r.total_amine_wt,
       c.standard_name, c.inchikey, c.cas_no, c.smiles, c.amine_class,
       s.doi, s.title, s.authors, s.year, s.journal, s.pdf_path, s.pdf_hash,
       l.loc_type, l.loc_label
FROM test t
JOIN recipe r ON r.recipe_id = t.recipe_id
JOIN compound c ON c.compound_id = r.amine_a_id
LEFT JOIN source s ON s.source_id = t.source_id
LEFT JOIN source_location l ON l.location_id = t.location_id
WHERE t.qc_level = 'L2' AND t.test_origin = 'literature'
ORDER BY t.test_id
"""

PERF_SQL = """
SELECT metric_name, value, unit, value_original, unit_original,
       error_value, repeat_count, metric_definition, is_derived
FROM performance WHERE test_id = ? ORDER BY perf_id
"""

CSV_FIELDS = [
    "test_id", "batch_id", "doi", "year", "journal", "amine", "inchikey", "cas_no",
    "smiles", "recipe_type", "wt_a", "wt_b", "water_wt",
    "temperature_K", "co2_vol_pct", "co2_partial_kPa", "total_pressure_kPa",
    "initial_loading", "rich_loading", "lean_loading",
    "metric_name", "value", "unit", "value_original", "unit_original", "is_derived",
    "metric_definition", "qc_level", "raw_data_path", "raw_data_hash",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/ccus.sqlite")
    ap.add_argument("--outdir", default=".")
    args = ap.parse_args()

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    records = []
    # 必须先把主查询全部取出：同一个 cursor 上再跑 PERF_SQL 会中断外层迭代，
    # 导致只处理第一条记录。
    rows = cur.execute(SQL).fetchall()
    perf_cur = conn.cursor()
    for row in rows:
        perf = [dict(p) for p in perf_cur.execute(PERF_SQL, (row["test_id"],))]
        records.append(
            {
                "test_id": row["test_id"],
                "batch_id": row["batch_id"],
                "source": {
                    "doi": row["doi"],
                    "title": row["title"],
                    "authors": row["authors"],
                    "year": row["year"],
                    "journal": row["journal"],
                    "pdf_path": row["pdf_path"],
                    "pdf_hash": row["pdf_hash"],
                    "loc_type": row["loc_type"],
                    "loc_label": row["loc_label"],
                },
                "compound": {
                    "standard_name": row["standard_name"],
                    "inchikey": row["inchikey"],
                    "cas_no": row["cas_no"],
                    "smiles": row["smiles"],
                    "amine_class": row["amine_class"],
                },
                "recipe": {
                    "recipe_id": row["recipe_id"],
                    "recipe_type": row["recipe_type"],
                    "wt_a": row["wt_a"],
                    "wt_b": row["wt_b"],
                    "water_wt": row["water_wt"],
                    "total_amine_wt": row["total_amine_wt"],
                },
                "conditions": {
                    "temperature_K": row["temperature_K"],
                    "co2_vol_pct": row["co2_vol_pct"],
                    "co2_partial_kPa": row["co2_partial_kPa"],
                    "total_pressure_kPa": row["total_pressure_kPa"],
                    "gas_flow": row["gas_flow"],
                    "liquid_volume": row["liquid_volume"],
                    "gas_liquid_ratio": row["gas_liquid_ratio"],
                    "initial_loading": row["initial_loading"],
                },
                "loadings": {"rich": row["rich_loading"], "lean": row["lean_loading"]},
                "performance": perf,
                "qc": {
                    "qc_level": row["qc_level"],
                    "qc_reason": row["qc_reason"],
                    "raw_data_path": row["raw_data_path"],
                    "raw_data_hash": row["raw_data_hash"],
                },
            }
        )
    conn.close()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    payload = {
        "dataset": "CCUS aqueous amine L2 gold standard",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "filter": "test.qc_level='L2' AND test.test_origin='literature'",
        "notes": [
            "仅含带原始数据快照（raw_data_path + sha256）的真实实验单点；无快照者已降为 L3。",
            "simulation（机理模型）数据强制 L3，永不出现在本文件中。",
            "performance.is_derived=1 表示由原始量按 metric_definition 计算得到。",
            "同一 test 可能有多条 performance；rich/lean loading 在 loadings 字段。",
        ],
        "n_tests": len(records),
        "n_performance": sum(len(r["performance"]) for r in records),
        "records": records,
    }

    jpath = outdir / "gold_standard_L2.json"
    jpath.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    cpath = outdir / "gold_standard_L2.csv"
    with cpath.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in records:
            base = {
                "test_id": r["test_id"],
                "batch_id": r["batch_id"],
                "doi": r["source"]["doi"],
                "year": r["source"]["year"],
                "journal": r["source"]["journal"],
                "amine": r["compound"]["standard_name"],
                "inchikey": r["compound"]["inchikey"],
                "cas_no": r["compound"]["cas_no"],
                "smiles": r["compound"]["smiles"],
                "recipe_type": r["recipe"]["recipe_type"],
                "wt_a": r["recipe"]["wt_a"],
                "wt_b": r["recipe"]["wt_b"],
                "water_wt": r["recipe"]["water_wt"],
                "temperature_K": r["conditions"]["temperature_K"],
                "co2_vol_pct": r["conditions"]["co2_vol_pct"],
                "co2_partial_kPa": r["conditions"]["co2_partial_kPa"],
                "total_pressure_kPa": r["conditions"]["total_pressure_kPa"],
                "initial_loading": r["conditions"]["initial_loading"],
                "rich_loading": r["loadings"]["rich"],
                "lean_loading": r["loadings"]["lean"],
                "qc_level": r["qc"]["qc_level"],
                "raw_data_path": r["qc"]["raw_data_path"],
                "raw_data_hash": r["qc"]["raw_data_hash"],
            }
            if not r["performance"]:
                w.writerow(base)
            for p in r["performance"]:
                w.writerow(
                    {
                        **base,
                        "metric_name": p["metric_name"],
                        "value": p["value"],
                        "unit": p["unit"],
                        "value_original": p["value_original"],
                        "unit_original": p["unit_original"],
                        "is_derived": p["is_derived"],
                        "metric_definition": p["metric_definition"],
                    }
                )

    print(f"wrote {jpath} ({len(records)} tests)")
    print(f"wrote {cpath}")
    by_amine = {}
    for r in records:
        n = r["compound"]["standard_name"]
        by_amine[n] = by_amine.get(n, 0) + 1
    print("amines:", ", ".join(f"{k}x{v}" for k, v in sorted(by_amine.items())))


main()
