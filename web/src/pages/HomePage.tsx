import { fmtStamp, metricLabel } from '../data/format';
import type { Facets, SnapshotMeta } from '../data/types';

interface Props {
  meta: SnapshotMeta;
  facets: Facets;
}

const MODEL_TABLES = [
  { name: 'source', title: '文献来源', desc: 'DOI、标题、作者、期刊、年份，每条记录可回溯原文。' },
  { name: 'compound', title: '化合物', desc: '名称、InChIKey、CAS、SMILES、分子量，结构由 CAS/InChIKey 反查。' },
  { name: 'recipe', title: '配方', desc: '单胺或双组分复配，各组分 wt%，质量守恒约束。' },
  { name: 'test', title: '测试点', desc: '单个工况下的测定：温度、CO₂ 浓度/分压、压力、负载、QC 等级。' },
  { name: 'performance', title: '性能指标', desc: '平衡溶解度、循环容量、再生能耗等，保留单位与原文值。' },
  { name: 'source_location', title: '原文定位', desc: '表号、页码、章节，支撑 L2 记录的可复算性。' },
];

const QC_ROWS = [
  ['L1', '作者提供的原始数据点（SI 表格 / 数据集）', '可直接复算', '金标准'],
  ['L2', '全文完整单点：温度、CO₂ 浓度、初始负载齐全且配方闭合', '可复算', '金标准'],
  ['L3', '缺必填字段，或建模 / 仿真数据', '仅作参考', '不入金标准'],
  ['L4', '硬违规（配方身份、浓度越界、质量不守恒等）', '校验拒收', '不入库'],
];

export function HomePage({ meta, facets }: Props) {
  const metrics = Object.entries(meta.metrics).sort((a, b) => b[1].count - a[1].count);
  const maxCount = metrics[0]?.[1].count ?? 1;
  const years =
    meta.year_min != null && meta.year_max != null ? `${meta.year_min}–${meta.year_max}` : '—';

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-main">
          <div className="eyebrow">水相胺 · CO₂ 捕集</div>
          <h1>
            从文献到可复算的
            <br />
            胺吸收剂性能数据集
          </h1>
          <p>
            逐条抽取同行评议文献中的水相胺配方、工况与性能数据，标注原文定位与质量等级，
            支持按胺种、浓度、温度、压力、负载、指标值等多维检索。
          </p>
          <div className="hero-actions">
            <a className="btn" href="#/search">
              进入数据检索
            </a>
            <a className="btn ghost" href="#scope">
              了解数据范围
            </a>
          </div>
        </div>

        <div className="hero-stats">
          <div className="stat">
            <b>{meta.test_count}</b>
            <span>测试记录</span>
          </div>
          <div className="stat">
            <b>{meta.literature_l2}</b>
            <span>L2 金标准</span>
          </div>
          <div className="stat">
            <b>{meta.performance_count}</b>
            <span>性能指标</span>
          </div>
          <div className="stat">
            <b>{meta.source_count}</b>
            <span>文献来源</span>
          </div>
          <div className="stat-wide">
            覆盖 {facets.amines.map((a) => a.name).join(' / ')} · 发表年份 {years}
          </div>
        </div>
      </section>

      <section className="home-section" id="scope">
        <h2>数据范围</h2>
        <p className="section-lead">
          只收录与本研究边界一致的水相胺体系，边界外的文献不入库；实验数据与仿真数据分源存放，永不混用。
        </p>
        <div className="scope-grid">
          <div className="scope-card ok">
            <h3>收录</h3>
            <ul>
              <li>水相单胺、双组分复配胺</li>
              <li>总胺浓度 20–50 wt%（仿真数据可按原文突破上限）</li>
              <li>吸收 / 解吸 / 平衡 / 再生等性能指标</li>
              <li>文献实验（literature）与建模仿真（simulation）分源标注</li>
            </ul>
          </div>
          <div className="scope-card no">
            <h3>排除</h3>
            <ul>
              <li>含添加剂、盐、两相、浆料体系</li>
              <li>非胺吸收剂（吸附剂、膜、离子液体等）</li>
              <li>无原文定位、无法溯源的二手数值</li>
              <li>仅给 mol/L 且无溶液密度、无法精确换算 wt% 的配方</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="home-section">
        <h2>质量分级</h2>
        <p className="section-lead">
          每条测试记录都带 QC 等级。检索默认只看 L2 金标准，可按需放宽到 L3 或纳入仿真数据。
        </p>
        <table className="qc-table">
          <thead>
            <tr>
              <th>等级</th>
              <th>判据</th>
              <th>复算性</th>
              <th>用途</th>
            </tr>
          </thead>
          <tbody>
            {QC_ROWS.map(([level, rule, reproducible, usage]) => (
              <tr key={level}>
                <td>
                  <span className={`badge qc-${level.toLowerCase()}`}>{level}</span>
                </td>
                <td>{rule}</td>
                <td>{reproducible}</td>
                <td>{usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="home-section">
        <h2>数据结构</h2>
        <p className="section-lead">
          关系型六表模型：一个测试点由「配方 + 工况 + 指标」确定，并挂接到文献与原文位置。
        </p>
        <div className="model-grid">
          {MODEL_TABLES.map((t) => (
            <div className="model-card" key={t.name}>
              <code>{t.name}</code>
              <h3>{t.title}</h3>
              <p>{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section">
        <h2>指标覆盖</h2>
        <p className="section-lead">当前快照中各性能指标的记录条数，括号内为原文单位。</p>
        <div className="bars">
          {metrics.map(([name, info]) => (
            <div className="bar-row" key={name}>
              <span className="bar-label" title={name}>
                {metricLabel(name)}
              </span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(info.count / maxCount) * 100}%` }} />
              </div>
              <span className="bar-count">{info.count}</span>
              <span className="bar-unit" title={info.unit ?? ''}>
                {info.unit ?? '—'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section">
        <h2>数据来源与更新</h2>
        <div className="snapshot-grid">
          <div>
            <h4>快照时间</h4>
            <p>{fmtStamp(meta.generated_at)}</p>
          </div>
          <div>
            <h4>快照指纹</h4>
            <p>
              <code>{meta.source_sha256.slice(0, 16)}…</code>
            </p>
          </div>
          <div>
            <h4>更新方式</h4>
            <p>数据库更新后重建只读快照并发布，页面指纹随之变化，可与库内一致性核对。</p>
          </div>
        </div>
        <p className="section-lead">
          页面为只读展示，数据写入口径由入库校验脚本统一把关；仿真记录强制 L3，并在检索页以红色标签标出。
        </p>
      </section>
    </main>
  );
}
