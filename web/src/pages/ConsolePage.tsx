import { useCallback, useEffect, useState } from 'react';
import { api, type BatchRow, type RunMeta, type StatusData, type TaskSpec } from '../api/client';
import { ParamField } from '../components/console/ParamField';
import { fmtStamp } from '../data/format';
import { href } from '../data/routing';

const GROUPS = ['采集', '入库', '质控', '展示'];

function defaults(task: TaskSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of task.params) {
    out[p.key] = p.default ?? (p.type === 'bool' ? false : p.type === 'int' ? 1 : '');
  }
  return out;
}

function statusBadge(status: RunMeta['status']) {
  const cls =
    status === 'success'
      ? 'run-success'
      : status === 'failed'
        ? 'run-failed'
        : status === 'cancelled'
          ? 'run-cancelled'
          : 'run-running';
  const text = { success: '成功', failed: '失败', cancelled: '已取消', running: '运行中', pending: '等待' }[
    status
  ];
  return <span className={`badge ${cls}`}>{text}</span>;
}

export function ConsolePage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [tasks, setTasks] = useState<TaskSpec[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, t, b] = await Promise.all([api.status(), api.tasks(), api.batches()]);
      setStatus(s);
      setTasks(t);
      setBatches(b);
      setValues((prev) => {
        const next = { ...prev };
        for (const task of t) {
          if (!next[task.id]) next[task.id] = defaults(task);
        }
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const start = async (task: TaskSpec) => {
    setStarting(task.id);
    setToast(null);
    try {
      const run = await api.runTask(task.id, values[task.id] ?? {});
      window.location.hash = href.run(run.id);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  };

  const setParam = (taskId: string, key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? {}), [key]: value } }));
  };

  const snapshot = status?.snapshot;
  const keys = status?.keys;
  const latest = status?.batches?.[0];

  return (
    <main className="console">
      <div className="console-head">
        <div>
          <h1>数据工作台</h1>
          <p>点选预设任务，本机执行，日志实时回传。所有任务只调用项目脚本，不提供任意命令入口。</p>
        </div>
        <div className="console-head-actions">
          <a className="btn ghost-dark" href={href.settings}>
            设置
          </a>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {toast && <div className="inline-error">{toast}</div>}

      <section className="status-strip">
        <div className="stat-card">
          <span className="stat-label">数据库快照</span>
          <b>{snapshot?.tests ?? '—'}</b>
          <small>
            测试记录 · {snapshot?.performance ?? '—'} 条指标 · L2 {snapshot?.l2 ?? '—'}
          </small>
          <small>更新于 {snapshot?.generated_at ? fmtStamp(snapshot.generated_at) : '—'}</small>
          {snapshot?.stale && (
            <small className="stale-warn">数据库已更新，展示快照落后 → 运行「更新展示站快照」</small>
          )}
        </div>
        <div className="stat-card">
          <span className="stat-label">密钥状态</span>
          <ul className="key-list">
            <li>
              <i className={keys?.ai ? 'dot ok' : 'dot bad'} />
              AI 模型 {keys?.ai ? `（${keys.ai_model}）` : '未配置'}
            </li>
            <li>
              <i className={keys?.elsevier ? 'dot ok' : 'dot bad'} />
              Elsevier {keys?.elsevier ? '已配置' : '未配置'}
            </li>
            <li>
              <i className={keys?.unpaywall ? 'dot ok' : 'dot bad'} />
              Unpaywall {keys?.unpaywall ? '已配置' : '未配置'}
            </li>
          </ul>
        </div>
        <div className="stat-card">
          <span className="stat-label">最近批次</span>
          {latest ? (
            <>
              <b className="batch-id">{latest.batch_id}</b>
              <small>
                valid {latest.valid} · L3 {latest.incomplete} · 拒收 {latest.rejected}
              </small>
              <small>{latest.mtime}</small>
            </>
          ) : (
            <small>暂无批次</small>
          )}
        </div>
        <div className="stat-card">
          <span className="stat-label">本地服务</span>
          <b className="mono-sm">{status?.server_time ?? '连接中…'}</b>
          <small>127.0.0.1:8765</small>
          <small>数据检索页：单独查看已入库数据</small>
        </div>
      </section>

      {GROUPS.map((group) => {
        const items = tasks.filter((t) => t.group === group);
        if (!items.length) return null;
        return (
          <section className="task-group" key={group}>
            <h2>{group}</h2>
            <div className="task-grid">
              {items.map((task) => (
                <article
                  className={`task-card${task.primary ? ' primary' : ''}${task.ready ? '' : ' blocked'}`}
                  key={task.id}
                >
                  <header>
                    <h3>{task.title}</h3>
                    {!task.ready && (
                      <span className="badge warn">缺少 {task.missing.join(' / ')} 配置</span>
                    )}
                  </header>
                  <p>{task.desc}</p>
                  {task.params.length > 0 && (
                    <div className="task-params">
                      {task.params.map((p) => (
                        <ParamField
                          key={p.key}
                          spec={p}
                          value={values[task.id]?.[p.key]}
                          batches={batches}
                          onChange={(v) => setParam(task.id, p.key, v)}
                        />
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={!task.ready || starting === task.id}
                    onClick={() => start(task)}
                  >
                    {starting === task.id ? '启动中…' : '运行'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <section className="console-section">
        <div className="section-head">
          <h2>最近运行</h2>
          <button type="button" className="link-btn" onClick={refresh}>
            刷新
          </button>
        </div>
        {status?.recent_runs?.length ? (
          <table className="run-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>任务</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {status.recent_runs.map((run) => (
                <tr key={run.id}>
                  <td className="mono-sm">{run.created_at.replace('T', ' ')}</td>
                  <td>{run.title}</td>
                  <td>{statusBadge(run.status)}</td>
                  <td>
                    <a href={href.run(run.id)}>查看日志</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">还没有运行记录，先点一个任务试试。</p>
        )}
      </section>
    </main>
  );
}
