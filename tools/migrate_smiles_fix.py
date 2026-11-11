"""修正 compound 表两处 SMILES 错配（batch 20261027_06 写入时的人工失误）。

- AMP  (id=3, CAS 124-68-5): CC(C)(C)CO  -> CC(C)(CO)N
  旧值是新戊醇（2,2-dimethyl-1-propanol），不含氮原子，与 InChIKey 不符。
- MDEA (id=4, CAS 105-59-9): CN(C)CCO    -> CN(CCO)CCO
  旧值是 2-(dimethylamino)ethanol (DMAE)，与 CAS 105-59-9 不符。

只改 smiles 列，不动 inchikey/cas_no/standard_name；MEA/PZ 不做改动。
执行后写 audit_log。幂等：已是目标值则跳过。

用法: .venv\Scripts\python.exe tools\migrate_smiles_fix.py
"""
import sqlite3

DB = "data/ccus.sqlite"
FIXES = {
    3: ("CBTVGIZVANXIJB-UHFFFAOYSA-N", "AMP", "CC(C)(C)CO", "CC(C)(CO)N"),
    4: ("CRVGTESFCCXCTH-UHFFFAOYSA-N", "MDEA", "CN(C)CCO", "CN(CCO)CCO"),
}


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    changed = []
    for cid, (key, name, old, new) in FIXES.items():
        row = cur.execute(
            "SELECT inchikey, standard_name, smiles FROM compound WHERE compound_id=?",
            (cid,),
        ).fetchone()
        if row is None:
            print(f"[skip] compound_id={cid} 不存在")
            continue
        got_key, got_name, got_smiles = row
        if got_key != key or got_name != name:
            raise SystemExit(
                f"[abort] compound_id={cid} 身份不符: {got_key}/{got_name} != {key}/{name}"
            )
        if got_smiles == new:
            print(f"[skip] {name} smiles 已是目标值")
            continue
        if got_smiles != old:
            raise SystemExit(f"[abort] {name} smiles={got_smiles!r} 与预期旧值 {old!r} 不符")
        cur.execute("UPDATE compound SET smiles=? WHERE compound_id=?", (new, cid))
        changed.append(f"{name}(id={cid}): {old} -> {new}")
        print(f"[fix ] {changed[-1]}")

    if changed:
        cur.execute(
            "INSERT INTO audit_log(table_name,record_id,action,detail,operator) "
            "VALUES(?,?,?,?,?)",
            (
                "compound",
                None,
                "fix_smiles",
                "batch=20261027_06 结构字段修正: " + "; ".join(changed)
                + "; 依据 CAS/InChIKey 反查正确 SMILES，未改动 inchikey/cas_no",
                "auto_agent",
            ),
        )
        conn.commit()
        print(f"\ncommitted {len(changed)} fix(es) + 1 audit_log")
    else:
        print("\nno change")
    conn.close()


main()
