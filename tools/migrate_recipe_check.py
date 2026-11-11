"""One-off migration: drop the total_amine_wt 20-50 CHECK from table `recipe`.

Why: simulation recipes (e.g. 60 wt% MEA) must be storable. The 20-50 wt%
rule is now enforced in scripts/validate.py and conditioned on test_origin.

SQLite cannot ALTER a CHECK, so the table is rebuilt following the official
12-step procedure. Guards: backup -> before-state assert -> single transaction
-> foreign_key_check -> after-state assert -> audit_log.
"""
import shutil
import sqlite3
import time
from pathlib import Path

DB = Path("data/ccus.sqlite")
BACKUP_DIR = Path("data/backups")
EXPECTED_ROWS = 3
OLD_MARK = "total_amine_wt BETWEEN 20 AND 50"

sql = Path("scripts/schema.sql").read_text(encoding="utf-8")
start = sql.index("CREATE TABLE IF NOT EXISTS recipe (")
end = sql.index(");", start) + 2
NEW_DDL = sql[start:end].replace(
    "CREATE TABLE IF NOT EXISTS recipe (", "CREATE TABLE recipe_new (")

if OLD_MARK in NEW_DDL:
    raise SystemExit("ABORT: schema.sql still carries the old concentration CHECK")

BACKUP_DIR.mkdir(parents=True, exist_ok=True)
backup = BACKUP_DIR / f"ccus_{time.strftime('%Y%m%d_%H%M%S')}.sqlite"
shutil.copy(DB, backup)
print("backup ->", backup)

conn = sqlite3.connect(DB)
cur = conn.cursor()

old_ddl = cur.execute("SELECT sql FROM sqlite_master WHERE name='recipe'").fetchone()[0]
n_before = cur.execute("SELECT COUNT(*) FROM recipe").fetchone()[0]
cols_before = [r[1] for r in cur.execute("PRAGMA table_info(recipe)")]
rows_before = cur.execute("SELECT * FROM recipe ORDER BY recipe_id").fetchall()
if OLD_MARK not in old_ddl:
    conn.close()
    raise SystemExit("ABORT: live recipe table has no expected CHECK; already migrated?")
if n_before != EXPECTED_ROWS:
    conn.close()
    raise SystemExit(f"ABORT: recipe has {n_before} rows, expected {EXPECTED_ROWS}")

test_before = cur.execute("SELECT COUNT(*) FROM test").fetchone()[0]
perf_before = cur.execute("SELECT COUNT(*) FROM performance").fetchone()[0]

cur.execute("PRAGMA foreign_keys=OFF")
cur.execute("PRAGMA legacy_alter_table=ON")
try:
    cur.execute("BEGIN IMMEDIATE")
    cur.execute(NEW_DDL)
    cur.execute("INSERT INTO recipe_new SELECT * FROM recipe")
    cur.execute("DROP TABLE recipe")
    cur.execute("ALTER TABLE recipe_new RENAME TO recipe")

    cols_after = [r[1] for r in cur.execute("PRAGMA table_info(recipe)")]
    if cols_after != cols_before:
        raise RuntimeError(f"column drift: {cols_before} -> {cols_after}")
    rows_after = cur.execute("SELECT * FROM recipe ORDER BY recipe_id").fetchall()
    if rows_after != rows_before:
        raise RuntimeError("row content drift after rebuild")
    fk = cur.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"foreign_key_check failed: {fk}")

    cur.execute(
        "INSERT INTO audit_log(table_name,record_id,action,detail,operator) VALUES(?,?,?,?,?)",
        ("recipe", "ALL", "schema_migrate",
         f"drop CHECK(total_amine_wt BETWEEN 20 AND 50); rule moved to validate.py, "
         f"conditioned on test_origin; rows={n_before}; backup={backup.name}", "auto_agent"))
    cur.execute("COMMIT")
except Exception as exc:
    cur.execute("ROLLBACK")
    conn.close()
    raise SystemExit(f"ABORT, rolled back: {exc}")

cur.execute("PRAGMA foreign_keys=ON")
new_ddl = cur.execute("SELECT sql FROM sqlite_master WHERE name='recipe'").fetchone()[0]
test_after = cur.execute("SELECT COUNT(*) FROM test").fetchone()[0]
perf_after = cur.execute("SELECT COUNT(*) FROM performance").fetchone()[0]
integrity = cur.execute("PRAGMA integrity_check").fetchone()[0]
conn.close()

print("recipe rows      :", n_before, "->", len(rows_after))
print("test rows        :", test_before, "->", test_after)
print("performance rows :", perf_before, "->", perf_after)
print("old CHECK gone   :", OLD_MARK not in new_ddl)
print("mass-balance CHECK kept:", "<= 0.1" in new_ddl)
print("integrity_check  :", integrity)
