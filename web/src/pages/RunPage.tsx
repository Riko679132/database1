import { useEffect, useRef, useState } from 'react';
import { api, type LogLine, type RunDetail } from '../api/client';
import { fmtNum } from '../data/format';
import { href } from '../data/routing';

interface PreviewRecord {
  amine?: string;
  amine_b?: string;
  wt_a?: number;
  wt_b?: number;
  total_amine_wt?: number;
  temperature_K?: number;
  co2_vol_pct?: number;
  co2_partial_kPa?: number;
  metrics?: number;
  qc_level?: string;
  loc?: string;
}

interface PreviewResult {
  batch_id: string;
  counts: { valid: number; incomplete: number; rejected: number };
  reasons?: Record<string, number>;
  records?: PreviewRecord[];
  rejected_rows?: { amine?: string; wt?: number; reason?: string }[];
  skipped?: { pdf: string; reason: string }[];
  ready_to_commit?: boolean;
}

interface CommitResult {
  batch_id: string;
  counts: { valid: number; incomplete: number; rejected: number };
  postcheck_ok: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

function isCommitResult(value: unknown): value is CommitResult {
  return typeof value === 'object' && value !== null && 'postcheck_ok' in value;
}

function resultNote(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'note' in value) {
    const note = (value as { note?: unknown }).note;
    return typeof note === 'string' && note ? note : null;
  }
  return null;
}

function isPreviewResult(value: unknown): value is PreviewResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'records' in value &&
    'batch_id' in value &&
    'counts' in value
  );
}

function CountsGrid({ counts, extra }: { counts: PreviewResult['counts']; extra?: React.ReactNode }) {
  return (
    <div className="result-grid">
      <div className="result-cell">
        <b>{counts.valid}</b>
        <span>有效（可导入）</span>
      </div>
      <div className="result-cell">
        <b>{counts.incomplete}</b>
        <span>缺字段（L3）</span>
      </div>
      <div className="result-cell">
        <b>{counts.rejected}</b>
        <span>拒收</span>
      </div>
      {extra}
    </div>
  );
}

function PreviewBlock({
  result,
  busy,
  onCommit,
}: {
  result: PreviewResult;
  busy: boolean;
  onCommit: (batchId: string) => void;
}) {
  const total = result.counts.valid + result.counts.incomplete;
  return (
    <div className="result-block">
      <CountsGrid
        counts={result.counts}
        extra={
          <div className="result-cell">
            <b className="mono-sm">{result.batch_id}</b>
            <span>批次号</span>
          </div>
        }
      />

      {result.reasons && Object.keys(result.reasons).length > 0 && (
        <div className="reason-row">
          <span className="muted">拒收原因：</span>
          {Object.entries(result.reasons).map(([key, count]) => (
            <span className="reason-chip" key={key}>
              {key} × {count}
            </span>
          ))}
        </div>
      )}

      {result.ready_to_commit ? (
        <div className="result-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => onCommit(result.batch_id)}>
            {busy ? '提交中…' : `确认入库（${total} 条）`}
          </button>
          <span className="muted">入库前自动备份数据库；校验拒收的记录不会导入。</span>
        </div>
      ) : (
        <p className="muted">本批没有可导入记录。</p>
      )}

      {result.records && result.records.length > 0 && (
        <div className="table-wrap result-table">
          <table className="results">
            <thead>
              <tr>
                <th>胺 / 配比</th>
                <th className="num">总胺 wt%</th>
                <th className="num">T (K)</th>
                <th className="num">CO₂ vol%</th>
                <th className="num">指标数</th>
                <th>QC</th>
                <th>定位</th>
              </tr>
            </thead>
            <tbody>
              {result.records.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="amine">
                      {r.amine}
                      {r.amine_b ? ` + ${r.amine_b}` : ''}
                    </div>
                    <div className="sub">
                      {fmtNum(r.wt_a, 2)}%
                      {r.wt_b != null ? ` + ${fmtNum(r.wt_b, 2)}%` : ''}
                    </div>
                  </td>
                  <td className="num">{fmtNum(r.total_amine_wt, 1)}</td>
                  <td className="num">{fmtNum(r.temperature_K, 2)}</td>
                  <td className="num">
                    {r.co2_vol_pct != null ? fmtNum(r.co2_vol_pct, 1) : fmtNum(r.co2_partial_kPa, 1)}
                  </td>
                  <td className="num">{r.metrics}</td>
                  <td>
                    <span className={`badge qc-${String(r.qc_level).toLowerCase()}`}>{r.qc_level}</span>
                  </td>
                  <td className="col-source">
                    <div className="sub" title={r.loc ?? ''}>
                      {r.loc ?? '—'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.rejected_rows && result.rejected_rows.length > 0 && (
        <details className="rejected-block">
          <summary>查看被拒收的记录（{result.rejected_rows.length}）</summary>
          <ul>
            {result.rejected_rows.map((r, i) => (
              <li key={i}>
                <b>{r.amine ?? '—'}</b>（{fmtNum(r.wt, 1)} wt%）— {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.skipped && result.skipped.length > 0 && (
        <details className="rejected-block">
          <summary>查看跳过的条目（{result.skipped.length}）</summary>
          <ul>
            {result.skipped.map((s, i) => (
              <li key={i}>
                <b>{s.pdf}</b> — {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RunPage({ id }: { id: string }) {
  const [meta, setMeta] = useState<RunDetail | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    cursor.current = 0;
    setLogs([]);
    setMeta(null);
    setError(null);

    const tick = async () => {
      try {
        const data = await api.run(id, cursor.current);
        if (stopped) return;
        cursor.current = data.log_cursor;
        setMeta(data);
        if (data.logs.length) setLogs((prev) => [...prev, ...data.logs]);
        if (data.status === 'running' || data.status === 'pending') {
          timer = window.setTimeout(tick, 900);
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const cancel = async () => {
    try {
      await api.cancel(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const commit = async (batchId: string) => {
    const ok = window.confirm(
      `确认把批次 ${batchId} 写入数据库？\n\n入库前会自动备份数据库；被拒收的记录不会导入。`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const run = await api.runTask('ingest_commit', { batch_id: batchId });
      window.location.hash = href.run(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const running = meta?.status === 'running' || meta?.status === 'pending';
  const result = meta?.result ?? null;

  return (
    <main className="console">
      <div className="console-head">
        <div>
          <a className="back-link" href={href.console}>
            ← 返回工作台
          </a>
          <h1>{meta?.title ?? '运行详情'}</h1>
          <p className="mono-sm">{meta ? `${meta.id} · ${meta.created_at.replace('T', ' ')}` : id}</p>
        </div>
        <div className="console-head-actions">
          <span className={`badge run-${meta?.status ?? 'running'}`}>
            {STATUS_TEXT[meta?.status ?? 'running'] ?? '运行中'}
          </span>
          {running && (
            <button type="button" className="btn ghost-dark" onClick={cancel}>
              取消
            </button>
          )}
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {meta?.error && <div className="inline-error">任务失败：{meta.error}</div>}

      <section className="console-section">
        <div className="section-head">
          <h2>运行日志</h2>
          <span className="muted">{logs.length} 行</span>
        </div>
        <div className="log-box" ref={logRef}>
          {logs.length ? (
            logs.map((l) => (
              <div className={`log-line${l.line.startsWith('===') ? ' log-step' : ''}`} key={l.i}>
                <span className="log-time">{l.t}</span>
                <span>{l.line}</span>
              </div>
            ))
          ) : (
            <div className="log-line log-time">等待输出…</div>
          )}
        </div>
      </section>

      {result && !running && (
        <section className="console-section">
          <div className="section-head">
            <h2>结果</h2>
            {meta?.finished_at && (
              <span className="muted">完成于 {meta.finished_at.replace('T', ' ')}</span>
            )}
          </div>

          {resultNote(result) && <div className="note-banner">{resultNote(result)}</div>}

          {isCommitResult(result) ? (
            <div className="result-block">
              <CountsGrid
                counts={result.counts}
                extra={
                  <div className="result-cell">
                    <b className={result.postcheck_ok ? 'ok-text' : 'bad-text'}>
                      {result.postcheck_ok ? 'PASS' : 'FAIL'}
                    </b>
                    <span>七项硬指标</span>
                  </div>
                }
              />
              <div className="result-actions">
                <a className="btn" href={href.search}>
                  去数据检索页查看
                </a>
                <span className="muted">批次 {result.batch_id} 已入库，展示站快照已更新</span>
              </div>
            </div>
          ) : isPreviewResult(result) ? (
            <PreviewBlock result={result} busy={busy} onCommit={commit} />
          ) : (
            <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
          )}
        </section>
      )}
    </main>
  );
}
