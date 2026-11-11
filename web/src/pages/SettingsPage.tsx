import { useEffect, useState } from 'react';
import { api, type Provider, type SettingsData } from '../api/client';
import { href } from '../data/routing';

type Msg = { kind: 'ok' | 'bad'; text: string } | null;

export function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState('deepseek');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [elsevierKey, setElsevierKey] = useState('');
  const [email, setEmail] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .settings()
      .then((d) => {
        setData(d);
        setProviders(d.providers);
        setProvider(d.ai.provider);
        setBaseUrl(d.ai.base_url);
        setModel(d.ai.model);
        setEmail(d.unpaywall.email);
      })
      .catch((e: unknown) => setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, []);

  const onProvider = (id: string) => {
    setProvider(id);
    const preset = providers.find((p) => p.id === id);
    if (preset?.base_url) setBaseUrl(preset.base_url);
  };

  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      const d = await api.saveSettings({
        ai: {
          provider,
          base_url: baseUrl,
          model,
          ...(aiKey.trim() ? { api_key: aiKey.trim() } : {}),
        },
        ...(elsevierKey.trim() ? { elsevier: { api_key: elsevierKey.trim() } } : {}),
        unpaywall: { email },
      });
      setData(d);
      setAiKey('');
      setElsevierKey('');
      setMsg({ kind: 'ok', text: '设置已保存到 config.local.yaml（不入版本库）' });
    } catch (e) {
      setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const testAi = async () => {
    setBusy('ai');
    setMsg(null);
    try {
      const r = await api.testAi({
        provider,
        base_url: baseUrl,
        model,
        ...(aiKey.trim() ? { api_key: aiKey.trim() } : {}),
      });
      setMsg({ kind: 'ok', text: `AI 连通：${String(r.model)} 回复「${String(r.reply)}」` });
    } catch (e) {
      setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const loadModels = async () => {
    setBusy('models');
    setMsg(null);
    try {
      const list = await api.models(provider);
      setModels(list.map((m) => m.id));
      setMsg({
        kind: 'ok',
        text: list.length ? `已拉取 ${list.length} 个模型` : '接口未返回模型列表，可手动填写模型名',
      });
    } catch (e) {
      setMsg({
        kind: 'bad',
        text: `${e instanceof Error ? e.message : String(e)}（如刚修改了 Key，请先保存再拉取）`,
      });
    } finally {
      setBusy(null);
    }
  };

  const testElsevier = async () => {
    setBusy('elsevier');
    setMsg(null);
    try {
      const r = await api.testElsevier(elsevierKey.trim() || undefined);
      setMsg({ kind: 'ok', text: `Elsevier 可用（HTTP ${String(r.status)}）` });
    } catch (e) {
      setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const testUnpaywall = async () => {
    setBusy('unpaywall');
    setMsg(null);
    try {
      const r = await api.testUnpaywall(email.trim() || undefined);
      setMsg({
        kind: 'ok',
        text: `Unpaywall 可用（示例 DOI ${String(r.doi)}，开放获取：${r.is_oa ? '是' : '否'}）`,
      });
    } catch (e) {
      setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <main className="console">
        <div className="boot">正在读取设置…</div>
      </main>
    );
  }

  return (
    <main className="console">
      <div className="console-head">
        <div>
          <a className="back-link" href={href.console}>
            ← 返回工作台
          </a>
          <h1>设置</h1>
          <p>
            密钥只保存在本机 <code>config.local.yaml</code>，不会写入前端代码或日志，页面上只显示尾号。
          </p>
        </div>
      </div>

      {msg && <div className={msg.kind === 'ok' ? 'ok-banner' : 'inline-error'}>{msg.text}</div>}

      <section className="console-section">
        <div className="section-head">
          <h2>AI 模型（结构化抽取用）</h2>
          <span className={data?.ai.api_key_set ? 'badge qc-l2' : 'badge warn'}>
            {data?.ai.api_key_set ? `已配置 ${data.ai.api_key_mask}` : '未配置'}
          </span>
        </div>
        <div className="settings-grid">
          <label className="param-row">
            <span>供应商</span>
            <select value={provider} onChange={(e) => onProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="param-row">
            <span>Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </label>
          <label className="param-row">
            <span>API Key</span>
            <input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder={data?.ai.api_key_set ? `已配置 ${data.ai.api_key_mask}（留空不修改）` : 'sk-…'}
            />
          </label>
          <label className="param-row">
            <span>模型</span>
            <div className="inline-field">
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
              <button type="button" className="btn ghost-dark small" disabled={busy === 'models'} onClick={loadModels}>
                拉取列表
              </button>
            </div>
          </label>
        </div>
        {models.length > 0 && (
          <div className="model-chips">
            {models.map((m) => (
              <button
                type="button"
                key={m}
                className={`chip${model === m ? ' active' : ''}`}
                onClick={() => setModel(m)}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn ghost-dark" disabled={busy === 'ai'} onClick={testAi}>
            {busy === 'ai' ? '测试中…' : '测试连接'}
          </button>
        </div>
      </section>

      <section className="console-section">
        <div className="section-head">
          <h2>检索与全文 API</h2>
          <span className={data?.elsevier.api_key_set ? 'badge qc-l2' : 'badge warn'}>
            Elsevier {data?.elsevier.api_key_set ? `已配置 ${data.elsevier.api_key_mask}` : '未配置'}
          </span>
        </div>
        <div className="settings-grid">
          <label className="param-row">
            <span>Elsevier API Key</span>
            <input
              type="password"
              value={elsevierKey}
              onChange={(e) => setElsevierKey(e.target.value)}
              placeholder={data?.elsevier.api_key_set ? '留空不修改' : '输入 Scopus API Key'}
            />
          </label>
          <label className="param-row">
            <span>Unpaywall 邮箱</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost-dark" disabled={busy === 'elsevier'} onClick={testElsevier}>
            {busy === 'elsevier' ? '测试中…' : '测试 Elsevier'}
          </button>
          <button type="button" className="btn ghost-dark" disabled={busy === 'unpaywall'} onClick={testUnpaywall}>
            {busy === 'unpaywall' ? '测试中…' : '测试 Unpaywall'}
          </button>
        </div>
      </section>

      <div className="form-actions sticky-actions">
        <button type="button" className="btn" disabled={busy === 'save'} onClick={save}>
          {busy === 'save' ? '保存中…' : '保存设置'}
        </button>
        <span className="muted">保存后立即生效，无需重启服务。</span>
      </div>
    </main>
  );
}
