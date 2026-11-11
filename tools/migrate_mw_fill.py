"""补齐 compound.mw（分子量），来源全部为已解析文献的表格，非手写。

幂等：只更新 mw IS NULL 的行。每次实际改动写一条 audit_log。
"""
import sqlite3

DB = r"d:/数据库/data/ccus.sqlite"

# inchikey -> (standard_name, mw, 出处)
FILLS = {
    "HZAXFHJVJLSVMW-UHFFFAOYSA-N": (
        "MEA", 61.08,
        "Hartono 2017 Table 1 S1 (C2H7NO 61.08); jece.2024.112664 Table 2"),
    "GLUUGHFVERTEDX-UHFFFAOYSA-N": (
        "PZ", 86.14,
        "Hwang 2018 Table 2 (piperazine MW 86.14)"),
    "CBTVGIZVANXIJB-UHFFFAOYSA-N": (
        "AMP", 89.14,
        "jece.2024.112664 Table 2; Hwang 2018 Table 2"),
    "CRVGTESFCCXCTH-UHFFFAOYSA-N": (
        "MDEA", 119.16,
        "jece.2024.112664 Table 2; Hwang 2018 Table 2"),
}

conn = sqlite3.connect(DB)
cur = conn.cursor()
changed = []
for inchikey, (name, mw, src) in FILLS.items():
    row = cur.execute(
        "SELECT compound_id, standard_name, mw FROM compound WHERE inchikey=?",
        (inchikey,)).fetchone()
    if not row:
        print(f"[skip] {name}: inchikey 不存在，拒绝新建")
        continue
    cid, db_name, db_mw = row
    if db_name != name:
        print(f"[skip] compound_id={cid} 名称不符 ({db_name} != {name})")
        continue
    if db_mw is not None:
        print(f"[keep] {name}(id={cid}): mw 已为 {db_mw}，不覆盖")
        continue
    cur.execute("UPDATE compound SET mw=? WHERE compound_id=?", (mw, cid))
    changed.append((cid, name, mw, src))
    print(f"[fill] {name}(id={cid}): mw NULL -> {mw}")

for cid, name, mw, src in changed:
    cur.execute(
        "INSERT INTO audit_log(table_name,record_id,action,detail,operator) "
        "VALUES(?,?,?,?,?)",
        ("compound", str(cid), "fill_mw",
         f"{name} mw={mw}; source={src}", "auto_agent"))

conn.commit()
print(f"committed {len(changed)} fill(s) + {len(changed)} audit_log")
conn.close()
