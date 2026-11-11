const API = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8765';

export type ParamType = 'text' | 'int' | 'bool' | 'batch' | 'select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TaskParam {
  key: string;
  label: string;
  type: ParamType;
  default?: string | number | boolean;
  required?: boolean;
  min?: number;
  max?: number;
  hidden?: boolean;
  options?: SelectOption[];
}

export interface TaskSpec {
  id: string;
  title: string;
  group: string;
  desc: string;
  requires: string[];
  primary?: boolean;
  params: TaskParam[];
  ready: boolean;
  missing: string[];
}

export type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface LogLine {
  i: number;
  t: string;
  line: string;
}

export interface RunMeta {
  id: string;
  task_id: string;
  title: string;
  params: Record<string, unknown>;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  log_cursor: number;
}

export interface RunDetail extends RunMeta {
  logs: LogLine[];
}

export interface BatchRow {
  batch_id: string;
  records: number;
  valid: number;
  incomplete: number;
  rejected: number;
  mtime: string;
  has_preview: boolean;
}

export interface StatusData {
  snapshot: {
    tests: number | null;
    performance: number | null;
    l2: number | null;
    simulation: number | null;
    generated_at: string | null;
    sha: string;
    served_from?: string;
    stale?: boolean;
  };
  keys: { ai: boolean; ai_model: string; elsevier: boolean; unpaywall: boolean };
  recent_runs: RunMeta[];
  batches: BatchRow[];
  server_time: string;
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
}

export interface SettingsData {
  ai: {
    provider: string;
    base_url: string;
    model: string;
    api_key_mask: string;
    api_key_set: boolean;
  };
  elsevier: { api_key_mask: string; api_key_set: boolean };
  unpaywall: { email: string; email_set: boolean };
  providers: Provider[];
  local_config: string;
}

export interface TestResult {
  ok: boolean;
  [key: string]: unknown;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error('无法连接本地控制服务（127.0.0.1:8765），请确认它已启动');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail;
    throw new Error(detail || `请求失败（HTTP ${res.status}）`);
  }
  return data as T;
}

export const api = {
  status: () => req<StatusData>('/api/status'),
  tasks: () => req<{ tasks: TaskSpec[] }>('/api/tasks').then((r) => r.tasks),
  runTask: (taskId: string, params: Record<string, unknown>) =>
    req<RunMeta>(`/api/tasks/${taskId}/run`, {
      method: 'POST',
      body: JSON.stringify({ params }),
    }),
  runs: (limit = 20) => req<{ runs: RunMeta[] }>(`/api/runs?limit=${limit}`).then((r) => r.runs),
  run: (id: string, since = 0) => req<RunDetail>(`/api/runs/${id}?since=${since}`),
  cancel: (id: string) => req<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  batches: () => req<{ batches: BatchRow[] }>('/api/batches').then((r) => r.batches),
  settings: () => req<SettingsData>('/api/settings'),
  saveSettings: (payload: unknown) =>
    req<SettingsData>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testAi: (ai?: unknown) =>
    req<TestResult>('/api/settings/test/ai', {
      method: 'POST',
      body: JSON.stringify({ ai }),
    }),
  testElsevier: (apiKey?: string) =>
    req<TestResult>('/api/settings/test/elsevier', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
    }),
  testUnpaywall: (email?: string) =>
    req<TestResult>('/api/settings/test/unpaywall', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  models: (provider?: string) =>
    req<{ models: { id: string; owned_by?: string }[] }>(
      `/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`,
    ).then((r) => r.models),
};
