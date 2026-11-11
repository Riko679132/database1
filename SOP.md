# 文献自动筛选与入库标准作业流程

本 SOP 描述「从目标 DOI 到一条可复算的 L2 金标准」的完整路径，共 7 个阶段。任何一步跳过都会让数据失去可追溯性。规则红线见 `AGENTS.md`，本文件只讲**怎么做**。

```
① 目标清单  →  ② 下载 PDF  →  ③ 转文本  →  ④ 边界判定  →  ⑤ 抽 JSONL  →  ⑥ 校验入库  →  ⑦ 导出核验
   triage          Unpaywall       pdf_to_text     吃哪张表        快照+字段        validate        gold_standard
                   / CDP
```

## 环境约定（两个 venv 不可混用）

| 用途 | 解释器 | 装了什么 | 谁用 |
|---|---|---|---|
| 主环境 | `.\.venv\Scripts\python.exe` | pyyaml / pdfplumber / requests / beautifulsoup4 / fpdf2 | `scripts/` 全部、`_wordgrid`、`triage_literature`、`postcheck`、`export_gold_standard`、`fetch_unpaywall_one` |
| 工具环境 | `tools\.venv\Scripts\python.exe` | playwright / pypdf / fonttools / campus-paper-fetch | 仅 `fetch_sd_cdp`、`fetch_pdf_cdp`、`verify_pdfs` |

下文所有写成裸 `python xxx.py` 的命令，默认已执行 `.\.venv\Scripts\Activate.ps1`；凡属工具环境的命令一律写全路径，避免误用。

两份依赖清单：根目录 `requirements.txt`、`requirements-tools.txt`。

---

## ① 目标清单：DOI 从哪来

| 入口 | 工具 | 产出 | 适用场景 |
|---|---|---|---|
| 主题检索 | `scripts/fetch_elsevier.py`（Scopus Search API） | `data/raw_pdfs/elsevier_results.json` | 冷启动、探索边界 |
| 引文挖掘 | 读已入库文献的 References 表 | Tier 1/2/3 清单 | **命中率最高**，优先用 |
| 用户指定 | — | 手写 DOI 列表 | 定向补数据空白 |

```powershell
python scripts/fetch_elsevier.py --out data/raw_pdfs/elsevier_results.json
python tools/triage_literature.py          # → data/raw_pdfs/triage_v2.csv
```

`triage_v2.csv` 的 `priority` 决定处理顺序：`1` 实验 + 白名单胺种（直接抽 L1/L2）> `2` 实验 + 非白名单（需先扩白名单）> `3` 物性/降解 > `4` 建模仿真 > `5` 综述（只做引文线索）> `6` 边界外。

**前置条件**：`config.yaml` 里 `elsevier.api_key` 与 `unpaywall.email` 必须是真值。用占位符 `你的_API_KEY` 时脚本会直接拒绝，不会静默失败。

---

## ② 批量下载 PDF

### 2.1 先走免费通道：Unpaywall

```powershell
python scripts/fetch_fulltext.py
```

行为：对 `elsevier_results.json` 里**所有**带 DOI 的条目调 Unpaywall v2（不只看 Scopus 标记 OA=1，为的是捞回 green OA 与作者自存档），逐 location 尝试 `url_for_pdf` → `url` → `url_for_landing_page`，并对 arXiv（`/abs/`→`/pdf/`）、PMC（`/articles/PMCxxx/`→`/pdf/`）做链接推导；sha256 内容去重；全部失败写 `need_manual_download.csv`（按年份降序，近年文献工况更统一）。

单篇重试（不动 `need_manual_download.csv` 台账）：

```powershell
.\.venv\Scripts\python.exe tools\fetch_unpaywall_one.py "10.1016/j.ces.2016.08.017" "10.1021/acs.iecr.4c03980"
```

（用根 `.venv`：该脚本 exec 了 `scripts/fetch_fulltext.py`，需要 requests + pyyaml。）

### 2.2 付费墙：CDP 截流（唯一可行路径）

普通 HTTP 请求无论怎么改 header 都拿不到全文 —— 即使拿到 S3 预签名直链，非浏览器客户端也只会收到 **62 KB 的 "Security verification / JavaScript is disabled" 页面**。可行原理只有一个：**在真实浏览器网络栈内，于 Response 阶段用 CDP `Fetch.getResponseBody` 抢在 PDF viewer 消费掉 body 之前取走字节**。

#### 步骤 1 — 启动带 CDP 的浏览器（每个下载批次只做一次）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "tools/.venv/Lib/site-packages/campus_paper_fetch/data/scripts/start-browser.ps1"
```

启动后监听 `http://127.0.0.1:9222`，是常驻会话，之后所有 DOI 复用同一个浏览器上下文（机构 cookie 已经建立）。

**权限判据**（不是看能否打开落地页，而是看这几处）：

- ScienceDirect 落地页出现 `Brought to you by: Peking University`
- ACS 页面右上角出现机构缩写

没有这个标识就是无权限，脚本会失败，别浪费重试次数。

#### 步骤 2 — 按出版社选脚本

| 出版社 | DOI 前缀 | 脚本 |
|---|---|---|
| Elsevier / ScienceDirect | `10.1016` | `tools/fetch_sd_cdp.py` |
| ACS | `10.1021` | `tools/fetch_pdf_cdp.py` |
| RSC | `10.1039` | `tools/fetch_pdf_cdp.py` |
| Wiley | `10.1002` | `tools/fetch_pdf_cdp.py` |
| Springer / Nature | `10.1007` / `10.1038` | `tools/fetch_pdf_cdp.py` |
| MDPI / Frontiers | `10.3390` / `10.3389` | 走 2.1 的 OA 通道即可 |

两个脚本的差别：`fetch_sd_cdp.py` 精确匹配 `*pdf.sciencedirectassets.com*` 锚点，并复刻了 Elsevier 的 pdfft 路径（DOI 落地页 → 真实 pdfft 链接 → 新页先武装 Fetch 域 → 带文章页作 Referer 导航 → 过 crasolve 桥 → 预签名 URL）；`fetch_pdf_cdp.py` 是通用版，不知道 URL 形态，所以拦 `*pdf*` 通配，但只在响应头 `Content-Type: application/pdf` **且**字节以 `%PDF` 开头时才收，其余请求一律放行。

> URL 构造差异（`fetch_pdf_cdp.py` 的 `resolve()`）：ACS 必须走 `https://pubs.acs.org/doi/pdf/{doi}?download=true`（经 doi.org 只会落到文章页，"PDF" 是按钮不是链接）；其余 DOI 前缀一律走 `https://doi.org/{doi}`。因此对 Wiley / Springer，若落地页不自动触发浏览器内 PDF 响应，脚本会报 `timeout waiting for pdf response` —— 此时先在浏览器里手动点开一次 PDF 让会话预热，再重跑。

#### 步骤 3 — 批量传入（脚本原生支持多 DOI）

```powershell
tools\.venv\Scripts\python.exe tools\fetch_sd_cdp.py `
  "10.1016/j.ces.2016.08.017" `
  "10.1016/j.ijggc.2016.12.018" `
  "10.1016/j.jece.2024.112664" `
  "10.1016/j.seppur.2019.115998"

tools\.venv\Scripts\python.exe tools\fetch_pdf_cdp.py `
  "10.1021/acs.iecr.4c03980" `
  "10.1021/je00005a025" `
  "10.1039/d6gc02196d"
```

- 一次 5–10 个为宜，**别超过 20**（页面超时 + 机房风控）
- 单进程内复用同一 CDP 会话，不要为每个 DOI 重启浏览器
- 输出文件名规则：`sanitize(DOI)_sha8.pdf`，落在 `data/raw_pdfs/`
- 不要手动改名 —— `source.pdf_path` 直接引用这个路径

#### 步骤 4 — 逐篇复核（必做）

```powershell
tools\.venv\Scripts\python.exe tools\verify_pdfs.py                                    # 全目录
tools\.venv\Scripts\python.exe tools\verify_pdfs.py --doi "10.1016/j.ces.2016.08.017"  # 指定 DOI
```

> 必须用 `tools\` 的 venv：`pypdf` + `fonttools` 只装在那里。根 `.venv` 有 pdfplumber/requests/fpdf2，`tools/.venv` 有 playwright/pypdf/fonttools/campus-paper-fetch，两套依赖严格分离，混用会报 `ModuleNotFoundError`。

检查四项：首字节 `%PDF-`、尾部含 `%%EOF`、页数 > 0、首页文本非空。

> 注意：`fetch_*_cdp.py` 打印的 `pages` 是明文 `/Type /Page` 计数，ACS 这类用对象流的 PDF 会显示 `0`，**以 `verify_pdfs.py` 的 pypdf 结果为准**。

#### 步骤 5 — 失败速查

| 现象 | 含义 | 处置 |
|---|---|---|
| `no_anchor` | 落地页找不到 pdfft 链接 = 无机构权限 | 确认校园网出口 IP → 重新登录 → 重试 ≤ 2 次 |
| `not_pdf` | 拦到了响应但内容不是 PDF = 被拦或无权限 | 同上；不要降级去试普通 HTTP |
| `Connection refused 127.0.0.1:9222` | 浏览器没启动或已退出 | 回步骤 1 |
| 中途大量超时 | 单批 DOI 太多 | 拆成每批 5 个 |
| 下载到 62 KB 文件 | 拿到了验证拦截页而非 PDF | 说明绕过了 CDP 直连，检查是否误用 `requests` |

**绝对不要**为了"绕过"去写 `requests` / `httpx` 直连。历史上这样做的结果全是 62 KB 的说明页。

---

## ③ PDF → 文本

```powershell
python scripts/pdf_to_text.py --pdf data/raw_pdfs/10.1016_j.ces.2016.08.017_e2cd1d21.pdf
python scripts/pdf_to_text.py --indir data/raw_pdfs      # 批量
```

输出 `extractions/parsed/<同名>.txt`，页间用 `--- Page N ---` 分隔；末尾 `parse_report.json` 记录 sha256 / 页数 / 字符数。

**判扫描件**：每页平均字符数 < 50 时 `needs_ocr=True`。本阶段不接 OCR —— 扫描件一律登记暂缓，不要试图从图片里"猜"数字。

### 让 AI 高效读文本的三个动作

1. **先定位再读全**：`Select-String -Path <txt> -Pattern "Table \d|Figure \d"` 先拿到表题清单与行号，再按行区间读，不要一次性灌全文（400 行以上会挤掉上下文）。
2. **表格必须坐标复核**：纯文本流会把多栏表串成一行、丢列。用
   ```powershell
   .\.venv\Scripts\python.exe tools\_wordgrid.py <pdf> <页码> [y0 y1 x0 x1]
   ```
   （根目录 `.venv` 才有 pdfplumber，`tools/.venv` 没有）。它按 `round(top/4)` 分带聚类、带内按 `x0` 排序重建列位，是核对无框线表/多栏表的唯一可靠办法。
3. **数字溯源到格**：抽完一个表，用 `_wordgrid` 复核一遍数值与列序，再落 JSONL。Shen & Li 1992 的 27 个点就是这么逐格对齐的。

---

## ④ 边界判定：吃哪张表

三条硬门槛，任一不过就不抽：

**1. 体系** — 水相单胺或双组分复配胺；总胺 20–50 wt%；无添加剂、无盐、无两相、无浆料。
> 例外：纯密度/物性表可留作单位换算参考库（如 PZ 65 wt% 密度），但只作参考，不入 test。

**2. 胺种** — 只有 MEA / PZ / AMP / MDEA 及其复配。**其它胺种即使论文以它为主角也一律忽略**。这是收敛边界的核心，不是可协商项：
> Hartono 2017 列了 15 种新溶剂，全部不在白名单 → 只取 Table A1 的 MEA 基准 1 条。
> Chowdhury 2013 列了 24 种叔胺，只有 MDEA 入选 → 只取 Table 2 的 row 24。

**3. 数据形态** — 必须是**表格或正文中的数值**。只在 Fig 曲线里、需要读数才能得到的结果一律不抽，也**不得**用像素估读：
> Hwang 2018 的 cyclic capacity 结果全在 Fig.3-10 曲线里 → 判定边界外，0 条入库。

**判定顺序**：先列表清单 → 逐表看有无数值 → 再看表头工况是否落在边界 → 最后才读正文讨论。反过来做会浪费大量时间在定性比较段落上。

**读表时的三个必备动作**：

- 查总压：VLE 表若只给 CO₂ 分压而没给总压，`co2_vol_pct` 无法派生 → 该表只能进 L3 或弃抽。原文给了总压才允许 `co2_vol_pct = P_CO2 / P_total × 100`。
- 查水蒸气自洽：`P_CO2 + P_H2O(T) ≤ P_total`。不满足说明实际总压高于文中所述，该温度整列弃用（Shen & Li 的 60/80/100 °C 就是这么被剔除的）。
- 查单位：`g-CO2/L-soln` 这类体积基指标，若原文没给溶液密度，**不得**反算 mol/mol，指标名加 `_volumetric` 后按原单位入库。

---

## ⑤ 抽 JSONL

路径：`extractions/<batch_id>/raw_agent.jsonl`，**一行一条 test**。

```json
{
  "source": {
    "doi": "", "title": "", "authors": "A B.; C D.", "year": 0,
    "journal": "", "pdf_path": "data/raw_pdfs/xxx.pdf", "pdf_hash": "<sha256>",
    "loc_type": "table", "loc_label": "p.98 Table II row 1",
    "excerpt": "该行原文的逐字转录"
  },
  "recipe": {
    "recipe_type": "mono | binary",
    "amine_a": {"standard_name": "MEA", "smiles": "", "inchikey": "", "cas_no": ""},
    "amine_b": null,
    "wt_a": 30.0, "wt_b": null, "water_wt": 70.0, "total_amine_wt": 30.0,
    "additive_flag": 0, "salt_flag": 0, "phase_flag": 0
  },
  "test": {
    "test_origin": "literature",
    "batch_id": "",
    "temperature_K": 313.15, "co2_vol_pct": 0.67,
    "co2_partial_kPa": 1.2, "total_pressure_kPa": 180.0,
    "gas_flow": null, "liquid_volume": null, "gas_liquid_ratio": null,
    "initial_loading": 0.0, "rich_loading": 0.244, "lean_loading": null,
    "raw_data_path": "extractions/<batch>/raw/xxx_snapshot.json",
    "raw_data_hash": "<snapshot sha256>"
  },
  "performance": [
    {"metric_name": "equilibrium_loading", "value": 0.244,
     "unit": "mol_CO2/mol_amine", "value_original": 0.244,
     "unit_original": "mol CO2/mol amine", "is_derived": 0,
     "metric_definition": "VLE equilibrium CO2 solubility in 30 wt% aqueous MDEA at 313.15 K and P_CO2=1.2 kPa"}
  ],
  "qc": {"qc_level": "L2", "qc_reason": "vle_equilibrium_point;..."}
}
```

### 五条容易踩的规则

1. **一条 test = 一个测量点**。VLE 表里每一行 `(P_CO2, alpha)` 都是一条 test，不是一张表一条。
2. **配方必须闭合**：`wt_a + wt_b + water_wt = 100`（容差 0.1）。`recipe_type='binary'` 时 `amine_b.inchikey` 必须存在，否则 `binary_identity` 硬拒。
3. **`metric_name` 一旦确定不要改**。同一指标多单位靠 `_volumetric` 后缀或列名后缀区分，不靠改 `metric_name`。
4. **`is_derived` 诚实标注**：直接抄表 = 0；经过计算（如 `cyclic_capacity = rich − lean`）= 1，并在 `metric_definition` 写明公式。
5. **`qc_reason` 写成分号分隔的机读标签**，如 `vle_equilibrium_point;co2_vol_pct_derived_from_stated_total_pressure_180kPa;initial_loading_fresh_unloaded_solution`。

### 快照（L1/L2 的唯一凭证）

一张表一个 JSON，落在 `extractions/<batch>/raw/`，必须含：DOI / title / authors / journal / year / **pdf_hash** / 表号与表题 / 实验条件 / 每行原始文本 / 采用的派生公式 / `excluded_rows`（哪些行没抽、为什么）。

```powershell
.\.venv\Scripts\python.exe -c "import hashlib;print(hashlib.sha256(open(r'extractions\<batch>\raw\x_snapshot.json','rb').read()).hexdigest())"
```

算出的 sha256 写进 `test.raw_data_hash`。没有快照 → `validate.py` 自动降 L3。

---

## ⑥ 校验与入库

```powershell
python scripts/validate.py --input extractions/<batch>/raw_agent.jsonl --outdir extractions/<batch>/validated
```

三分支：

| 产物 | 条件 | 落库 |
|---|---|---|
| `valid.jsonl` | 字段完整，`qc_level` 保持原样 | 入主库 |
| `valid_incomplete.jsonl` | 缺必填字段但配方闭合，自动 `qc_level=L3` + `incomplete_flag=true` | 入主库（供下游过滤） |
| `rejected.jsonl` | 硬违规：`recipe_type` / `excluded_system` / `concentration_out_of_range` / `mass_balance` / `binary_identity` | **永不入库** |

```powershell
python scripts/import_jsonl.py --input extractions/<batch>/validated/valid.jsonl
python scripts/import_jsonl.py --input extractions/<batch>/validated/valid_incomplete.jsonl   # 若存在
```

**禁止跳过 validate 直接 import** —— 校验是唯一入闸门。`rejected.jsonl` 里每一条都要回头改数据或改判定，不能"手动导入试试"。

---

## ⑦ 导出与核验

```powershell
python tools/export_gold_standard.py
```

产出根目录 `gold_standard_L2.json` / `.csv`（`qc_level='L2' AND test_origin='literature'`）。**L2 数量每变一次就重跑一次**，保证根目录副本与库内一致。simulation 永不进入该文件。

入库后必查（由操作者手动执行，Agent 不得直连数据库）：

```powershell
python tools/postcheck.py                        # 全库
python tools/postcheck.py --batch 20261027_08    # 只看某批次
```

输出规模、QC 分布、七项硬指标与 L2 溯源存在性。七项硬指标为：L2 缺快照、simulation 未强制 L3、simulation 混入 L1/L2、L2 配方不闭合、binary 缺 `amine_b` 身份、外键违例、`integrity_check`。**全部 PASS 才算入库完成**；脚本退出码 1 表示有违例，可直接串联到批处理里拦截。

---

## ⑧ 红线清单

1. 不编造 DOI / CAS / SMILES / InChIKey / 工况数值；原文没有就填 `null`。**标题与作者必须从 PDF 首页复制，不得凭记忆写**（曾把 Hartono 2017 记成带 "Part 2" 副标题、作者多出 3 人）。
2. 不 `import sqlite3`，不直接读写 `data/ccus.sqlite`。
3. 不删除 `extractions/` 下任何文件（含 `parsed/` 与 `raw/` 快照）。
4. 不删除 `source` 表引用的 PDF；删任何 PDF 前必须先写 `data/raw_pdfs/removed_out_of_scope.csv` 台账。
5. **不删除、不改写 CDP / API 工具链**：`tools/fetch_sd_cdp.py`、`tools/fetch_pdf_cdp.py`、`tools/fetch_unpaywall_one.py`、`scripts/fetch_elsevier.py`、`scripts/fetch_fulltext.py`、`scripts/web_crawler.py`、`tools/verify_pdfs.py`、`tools/triage_literature.py`、`tools/.venv/Lib/site-packages/campus_paper_fetch/`。这是突破付费墙的唯一通道。
6. 无溶液密度时不得把 `mol/L`、`g/L` 换算成 `mol/mol`。
7. 不从图中读数、不做像素估读；只取表格与正文数值。
8. 不跳过 `validate.py`。
9. 不修改 `scripts/validate.py`、`preview.py`、`import_jsonl.py`、`schema.sql`（除非用户在对话中显式授权解冻）。
10. 本 Agent 不训练预测模型、不做主动学习选点、不做配方推荐；交付物到「可追溯的 L2 数据集」为止。
