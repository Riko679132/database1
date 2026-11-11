"""LLM 结构化抽取：论文文本 → raw_agent 记录（与 validate.py 的字段完全对齐）。"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from . import llm
from .settings import ROOT

MAX_CHARS = 110_000
WHITELIST = ROOT / "data" / "compound_whitelist.csv"

METRIC_ENUM = [
    "equilibrium_loading",
    "cyclic_capacity",
    "cyclic_capacity_volumetric",
    "regeneration_energy",
    "regeneration_heat",
    "regeneration_efficiency",
    "initial_absorption_rate",
    "initial_desorption_rate",
    "absorption_rate_volumetric",
    "absorption_amount_volumetric",
    "co2_removal_efficiency",
    "cost_per_tonne_co2",
    "iron_solubility",
    "pka",
    "model_prediction_deviation",
    "annual_energy_consumption_reduction",
    "aard_equilibrium_co2_partial_pressure",
]

SYSTEM_PROMPT = f"""你是水相胺 CO2 捕集文献的结构化数据抽取器。
只依据给定的论文文本抽取，禁止使用外部知识补全数值、结构或文献信息。

研究边界（不满足则不输出该配方）：
1) 水相单胺或双组分复配胺，总胺 20–50 wt%；
2) 无添加剂、无盐、无两相、无浆料。

输出必须是 JSON 对象，形如 {{"records": [...]}}，不要任何解释文字。
每条记录结构：
{{
  "source": {{"doi": null, "title": null, "authors": null, "year": null, "journal": null,
              "loc_type": "table|text|figure", "loc_label": "页码/表号/章节", "excerpt": "支撑本条的原文片段，<=400字"}},
  "recipe": {{"recipe_type": "mono|binary",
              "amine_a": {{"standard_name": "...", "cas_no": "..."}},
              "amine_b": null 或 {{"standard_name": "...", "cas_no": "..."}},
              "wt_a": null, "wt_b": null, "water_wt": null, "total_amine_wt": null,
              "additive_flag": 0, "salt_flag": 0, "phase_flag": 0}},
  "test": {{"temperature_K": null, "co2_vol_pct": null, "co2_partial_kPa": null,
            "total_pressure_kPa": null, "gas_flow": null, "liquid_volume": null,
            "gas_liquid_ratio": null, "initial_loading": null, "rich_loading": null, "lean_loading": null}},
  "performance": [{{"metric_name": "...", "value": null, "unit": null, "value_original": null,
                    "unit_original": null, "metric_definition": null, "is_derived": 0}}]
}}

规则：
- 单位统一：温度 K；CO2 体积分数 vol%；压力 kPa；负载 mol CO2/mol amine；同时把原文数值写入 value_original。
- 缺失一律 null，不得猜测，不得从其他文献补。
- 胺只能取自给定白名单（按 CAS 或名称匹配）；白名单外的胺，整条不输出。
- 原文只给 molality（mol/kg 溶剂）且给出分子量时可换算 wt%；只给 mol/L 且未给溶液密度时，该配方不输出。
- 同一论文中每个「配方 × 工况」组合输出一条记录；不要输出重复记录。
- metric_name 只能取以下枚举之一：{", ".join(METRIC_ENUM)}。
- excerpt 必须是原文中能直接支撑本条数值的句子（保留原文语言）。
- 若本文没有符合边界的实验数据，输出 {{"records": []}}。"""


class SkipRecord(Exception):
    """该条记录不进 raw_agent（例如未知化合物），需在预览中提示。"""


def load_compounds() -> list[dict]:
    rows: list[dict] = []
    if WHITELIST.exists():
        with WHITELIST.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                if not row.get("standard_name"):
                    continue
                rows.append(
                    {
                        "standard_name": row["standard_name"].strip(),
                        "cas_no": (row.get("cas_no") or "").strip(),
                        "smiles": (row.get("smiles") or "").strip(),
                        "inchikey": (row.get("inchikey") or "").strip(),
                        "amine_class": (row.get("amine_class") or "").strip(),
                    }
                )
    return rows


def _index(compounds: list[dict]) -> tuple[dict, dict]:
    by_cas, by_name = {}, {}
    for c in compounds:
        if c["cas_no"]:
            by_cas[c["cas_no"]] = c
        by_name[c["standard_name"].upper()] = c
    return by_cas, by_name


def resolve(compounds: list[dict], obj: dict | None) -> dict | None:
    if not obj:
        return None
    by_cas, by_name = _index(compounds)
    for raw in (obj.get("cas_no"), obj.get("standard_name"), obj.get("name")):
        if not raw:
            continue
        key = str(raw).strip()
        hit = by_cas.get(key) or by_name.get(key.upper())
        if hit:
            return hit
    return None


def _num(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def doi_from_filename(pdf: Path) -> str | None:
    stem = pdf.stem
    if not stem.startswith("10."):
        return None
    parts = stem.split("_")
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return None


def _truncate(text: str) -> tuple[str, bool]:
    if len(text) <= MAX_CHARS:
        return text, False
    head = text[: int(MAX_CHARS * 0.25)]
    tail = text[-int(MAX_CHARS * 0.75) :]
    return head + "\n\n[... 中间部分因长度限制省略 ...]\n\n" + tail, True


def extract_paper(
    text: str,
    *,
    pdf: Path,
    compounds: list[dict],
    log=lambda _msg: None,
) -> tuple[list[dict], bool]:
    body, truncated = _truncate(text)
    if truncated:
        log(f"  文本长度 {len(text)} 字符，超限已截断至 {MAX_CHARS}")
    meta = {
        "file": pdf.name,
        "doi_guess": doi_from_filename(pdf),
    }
    whitelist = [
        {"standard_name": c["standard_name"], "cas_no": c["cas_no"], "amine_class": c["amine_class"]}
        for c in compounds
    ]
    user = (
        f"【文献元信息】文件名：{meta['file']}；文件名推测 DOI：{meta['doi_guess'] or '未知'}\n"
        f"【化合物白名单】{json.dumps(whitelist, ensure_ascii=False)}\n"
        f"【论文文本】\n{body}"
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
    content = llm.chat(messages, json_mode=True, max_tokens=8192)
    records = _parse_records(content)
    if records is None:
        log("  模型输出不是合法 JSON，重试一次")
        messages.append({"role": "assistant", "content": content[:2000]})
        messages.append({"role": "user", "content": "上面的输出不是合法 JSON。请只输出 {\"records\": [...]} 形式的 JSON。"})
        content = llm.chat(messages, json_mode=True, max_tokens=8192)
        records = _parse_records(content)
    if records is None:
        raise llm.LLMError("模型两次输出均无法解析为 JSON")
    return records, truncated


def _parse_records(content: str) -> list[dict] | None:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except ValueError:
            return None
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        records = data.get("records")
        if isinstance(records, list):
            return records
    return None


def normalize(
    raw: dict,
    *,
    compounds: list[dict],
    pdf: Path,
    pdf_hash: str,
    batch_id: str,
) -> dict:
    recipe_raw = raw.get("recipe") or {}
    amine_a = resolve(compounds, recipe_raw.get("amine_a"))
    if not amine_a:
        raise SkipRecord(f"胺 A 不在白名单：{(recipe_raw.get('amine_a') or {}).get('standard_name')}")
    amine_b_raw = recipe_raw.get("amine_b")
    amine_b = resolve(compounds, amine_b_raw) if amine_b_raw else None
    if amine_b_raw and not amine_b:
        raise SkipRecord(f"胺 B 不在白名单：{(amine_b_raw or {}).get('standard_name')}")

    notes: list[str] = []
    wt_a = _num(recipe_raw.get("wt_a"))
    wt_b = _num(recipe_raw.get("wt_b")) if amine_b else None
    total = _num(recipe_raw.get("total_amine_wt"))
    water = _num(recipe_raw.get("water_wt"))
    if total is None and wt_a is not None:
        total = round(wt_a + (wt_b or 0), 4)
        notes.append("total_amine_wt_derived")
    if water is None and total is not None:
        water = round(100 - total, 4)
        notes.append("water_wt_derived_by_mass_balance")

    test_raw = raw.get("test") or {}
    test = {
        "test_origin": "literature",
        "batch_id": batch_id,
        "temperature_K": _num(test_raw.get("temperature_K")),
        "co2_vol_pct": _num(test_raw.get("co2_vol_pct")),
        "co2_partial_kPa": _num(test_raw.get("co2_partial_kPa")),
        "total_pressure_kPa": _num(test_raw.get("total_pressure_kPa")),
        "gas_flow": _num(test_raw.get("gas_flow")),
        "liquid_volume": _num(test_raw.get("liquid_volume")),
        "gas_liquid_ratio": _num(test_raw.get("gas_liquid_ratio")),
        "initial_loading": _num(test_raw.get("initial_loading")),
        "rich_loading": _num(test_raw.get("rich_loading")),
        "lean_loading": _num(test_raw.get("lean_loading")),
    }

    performance = []
    for item in raw.get("performance") or []:
        if not isinstance(item, dict):
            continue
        metric = str(item.get("metric_name") or "").strip()
        value = _num(item.get("value"))
        if not metric or value is None:
            continue
        performance.append(
            {
                "metric_name": metric,
                "value": value,
                "unit": item.get("unit"),
                "value_original": _num(item.get("value_original")),
                "unit_original": item.get("unit_original"),
                "error_value": _num(item.get("error_value")),
                "repeat_count": _num(item.get("repeat_count")),
                "metric_definition": item.get("metric_definition"),
                "is_derived": int(item.get("is_derived") or 0),
            }
        )

    source_raw = raw.get("source") or {}
    source = {
        "doi": source_raw.get("doi") or doi_from_filename(pdf),
        "title": source_raw.get("title"),
        "authors": source_raw.get("authors"),
        "year": int(_num(source_raw.get("year")) or 0) or None,
        "journal": source_raw.get("journal"),
        "pdf_path": pdf.as_posix(),
        "pdf_hash": pdf_hash,
        "loc_type": source_raw.get("loc_type") or "text",
        "loc_label": source_raw.get("loc_label"),
        "excerpt": source_raw.get("excerpt"),
    }

    return {
        "source": source,
        "recipe": {
            "recipe_type": "binary" if amine_b else "mono",
            "amine_a": amine_a,
            "amine_b": amine_b,
            "wt_a": wt_a,
            "wt_b": wt_b,
            "water_wt": water,
            "total_amine_wt": total,
            "additive_flag": int(recipe_raw.get("additive_flag") or 0),
            "salt_flag": int(recipe_raw.get("salt_flag") or 0),
            "phase_flag": int(recipe_raw.get("phase_flag") or 0),
        },
        "test": test,
        "performance": performance,
        "qc": {
            # 无 raw_data 快照，按项目规则最高只能 L3
            "qc_level": "L3",
            "qc_reason": ";".join(["llm_extraction_no_raw_snapshot", *notes]),
        },
    }
