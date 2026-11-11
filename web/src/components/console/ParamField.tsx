import type { BatchRow, TaskParam } from '../../api/client';

interface Props {
  spec: TaskParam;
  value: unknown;
  batches: BatchRow[];
  onChange: (value: unknown) => void;
}

export function ParamField({ spec, value, batches, onChange }: Props) {
  if (spec.hidden) return null;

  if (spec.type === 'bool') {
    return (
      <label className="check-row">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{spec.label}</span>
      </label>
    );
  }

  if (spec.type === 'select') {
    return (
      <label className="param-row">
        <span>{spec.label}</span>
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (spec.type === 'batch') {
    const options = batches.filter((b) => b.has_preview && b.valid + b.incomplete > 0);
    return (
      <label className="param-row">
        <span>
          {spec.label}
          {spec.required && <i className="req">*</i>}
        </span>
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">选择批次…</option>
          {options.map((b) => (
            <option key={b.batch_id} value={b.batch_id}>
              {b.batch_id}（valid {b.valid} / L3 {b.incomplete} / 拒 {b.rejected}）
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (spec.type === 'int') {
    return (
      <label className="param-row">
        <span>{spec.label}</span>
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </label>
    );
  }

  return (
    <label className="param-row">
      <span>{spec.label}</span>
      <input
        type="text"
        value={String(value ?? '')}
        placeholder={String(spec.default ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
