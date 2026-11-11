# CCUS 控制台前端交付包（给对面的 agent）

这个包只包含**前端 + 本地控制服务**，不含数据库、密钥、PDF 和抽取产物。
目标是接到你方已有的后端项目根目录上，得到 `首页 / 数据检索 / 工作台` 三个页面，
其中工作台可以点按钮执行后端预设任务。

## 一、目录要求（必须与后端项目同级）

```
<项目根>/
├─ data/ccus.sqlite          ← 你方已有
├─ data/compound_whitelist.csv ← 你方已有（LLM 抽取用来解析化合物身份）
├─ config.yaml                ← 你方已有（database.path 等）
├─ scripts/ tools/            ← 你方已有
├─ tools/build_web_db.py      ← 本包提供（新增，用于生成网站快照）
├─ server/                    ← 本包提供（本地控制服务）
├─ web/                       ← 本包提供（前端源码 + 预构建 dist）
├─ start_console.bat          ← 本包提供
├─ requirements-server.txt    ← 本包提供
└─ config.local.example.yaml  ← 本包提供（密钥模板，不含密钥）
```

拷入时注意：
- `web/`、`server/`、`tools/build_web_db.py` 与原有目录**不要嵌套**到子目录里。
- 不要用本包覆盖你方的 `config.yaml`、`scripts/`、`tools/` 其它文件。

## 二、安装

```bat
:: 1. 根 .venv 里补装控制台依赖（fastapi / uvicorn）
.venv\Scripts\pip.exe install -r requirements.txt -r requirements-server.txt

:: 2. 密钥（二选一）
copy config.local.example.yaml config.local.yaml
::    然后填写 ai.api_key（DeepSeek 或任意 OpenAI 兼容服务）、elsevier.api_key、unpaywall.email
::    或者启动后在「设置」页填写
```

Node.js 只在需要修改前端源码或重新构建时使用（Node 20.19+ / 22.12+）。
本包已带 `web/dist`，不装 Node 也能直接运行。

## 三、启动

```bat
start_console.bat
```

脚本会依次：检查 Python 环境 → 若缺 `web/dist` 则构建 → **用你的库重建网站快照** →
启动服务 `http://127.0.0.1:8765/` → 自动打开浏览器。
关闭标题为 `CCUS Console Server` 的窗口即停止服务。

等价的手动命令（在项目根执行）：

```bat
.venv\Scripts\python.exe tools\build_web_db.py
.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

开发前端时：

```bat
cd web
npm install
npm run dev        :: http://localhost:5173，会自动重建快照
```

## 四、自检清单

1. `GET http://127.0.0.1:8765/api/health` 返回 `{"ok": true}`；
2. 首页显示"测试记录"数量与 `test` 表行数一致；
3. 工作台「设置」页能测试通过 AI / Elsevier / Unpaywall 三项；
4. 「批量入库 · 预览」用 1 篇 PDF 跑通（需要 AI Key）。

## 五、后端脚本兼容性检查（报错时先查这里）

`server/tasks.py` 只调用现有脚本，要求它们具备以下接口：

| 脚本 | 要求 |
|---|---|
| `scripts/pdf_to_text.py` | `--pdf FILE --outdir DIR`，输出 `<stem>.txt` |
| `scripts/validate.py` | `--input --outdir`；产出 `valid.jsonl` / `valid_incomplete.jsonl` / `rejected.jsonl`（缺 `valid_incomplete` 说明版本过旧） |
| `scripts/import_jsonl.py` | `--input --config --batch-id` |
| `scripts/audit_log.py` | `--config --action --table --detail --operator` |
| `scripts/fetch_elsevier.py` | `--config`，读取 `elsevier.api_key` |
| `scripts/fetch_fulltext.py` | `--results --outdir --config` |
| `tools/postcheck.py` | `--batch`，退出码 0 表示通过 |
| `tools/export_gold_standard.py` | 无参数，输出到项目根 |
| `tools/verify_pdfs.py` | 需要 `tools/.venv` 中的 pypdf；可 `--doi` |
| `tools/fetch_sd_cdp.py` / `tools/fetch_pdf_cdp.py` | 需要 CDP 浏览器（127.0.0.1:9222）和机构网络权限 |

快速检查（在项目根）：

```bat
findstr /C:"valid_incomplete" scripts\validate.py
findstr /C:"batch-id" scripts\import_jsonl.py
findstr /C:"--batch" tools\postcheck.py
```

## 六、平台说明

本包默认 **Windows**：`start_console.bat`、`.venv\Scripts\python.exe`、
`server/tasks.py` 中的 `TOOLS_PY`。若部署在 Linux：

- 用等价命令启动 uvicorn；
- 把 `server/tasks.py` 的 `TOOLS_PY` 改为 `tools/.venv/bin/python`；
- CDP 下载脚本的 Python 路径同理。

## 七、安全

- `config.local.yaml` 含密钥：不入版本库，不随包外发；本包只带 `.example` 模板。
- 本包不含 `data/`、PDF、`extractions/` 和任何运行日志。
- 服务仅监听 `127.0.0.1`，不对外网开放；密钥只在本机读写，前端只拿到尾部掩码。
