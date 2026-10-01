// seo-dashboard build script
// Owner: L1 调度师 (32789)
// Date: 2026-09-29
// Status: MVP - reads existing CSVs, emits self-contained HTML (zero CDN).
//
// Reads from : F:\OpenClaw\workspace\seo-data\*.csv
// Writes to  : F:\OpenClaw\workspace\seo-dashboard\dist\index.html
//
// CSV schemas:
//   baidu-keyword-rank-YYYY-MM-DD.csv : date,keyword,category,rank,clicks,impressions
//   gsc-inspection-YYYY-MM-DD.csv    : date,url,coverage_state,index_status,last_crawl_time,mobile_usability
//
// Red lines:
//   * No network calls (zero CDN, zero API)
//   * No src/ touching (主站 jinman-com-cn)
//   * No Co-authored-by (commit message later clean)
//   * No PowerShell / wrangler / curl
//   * No USD paid API

import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------------
// 1. Locate CSV files
// -----------------------------------------------------------------------------
const DATA_DIR = 'F:/OpenClaw/workspace/seo-data';
const DIST_DIR = join(__dirname, 'dist');
const TEMPLATE = join(__dirname, 'src', 'template.html');

if (!existsSync(DATA_DIR)) {
  console.error(`FATAL: data dir not found: ${DATA_DIR}`);
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error(`FATAL: template not found: ${TEMPLATE}`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// 2. CSV parser (handles BOM, quoted fields with commas, CRLF/LF)
// -----------------------------------------------------------------------------
function parseCsv(raw) {
  // strip BOM
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuote = false; }
        else { cur += c; }
      } else {
        if (c === ',') { out.push(cur); cur = ''; }
        else if (c === '"') { inQuote = true; }
        else { cur += c; }
      }
    }
    out.push(cur);
    return out;
  };

  const header = parseLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (fields[j] ?? '').trim();
    rows.push(row);
  }
  return rows;
}

// -----------------------------------------------------------------------------
// 3. Load all CSV files (latest first)
// -----------------------------------------------------------------------------
function loadCsvGroup(prefix) {
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.csv'))
    .sort()
    .reverse(); // newest first
  const daily = [];
  for (const f of files) {
    const date = f.match(/-(\d{4}-\d{2}-\d{2})\.csv$/)?.[1];
    if (!date) continue;
    const raw = readFileSync(join(DATA_DIR, f), 'utf8');
    const rows = parseCsv(raw);
    daily.push({ date, file: f, rows });
  }
  return daily;
}

const baiduDaily = loadCsvGroup('baidu-keyword-rank-');
const gscDaily = loadCsvGroup('gsc-inspection-');

// -----------------------------------------------------------------------------
// 4. Compute metrics
// -----------------------------------------------------------------------------

// GSC metrics
// CSV schema reminder:
//   coverage_state    : human-readable e.g. "Submitted and indexed", "Excluded by noindex"
//   index_status      : PASS / FAIL / ERR / NEUTRAL  (the canonical verdict)
//   mobile_usability  : PASS / FAIL / ERR / VERDICT_UNSPECIFIED
// We bucket by index_status (canonical) and mobile_usability (canonical).
// Canonical verdict logic (priority order):
//   1. coverage_state === "Submitted and indexed"            -> indexed
//   2. coverage_state matches one of the discovery states   -> discovered/crawled/unknown
//   3. coverage_state matches canonical/excluded             -> canonical/excluded
//   4. index_status === "PASS"                              -> indexed
//   5. index_status === "FAIL"                              -> fail
//   6. index_status === "ERR" or empty                      -> api_err
//   7. index_status === "NEUTRAL"                           -> neutral
//   8. everything else                                      -> other
const gscMetrics = (() => {
  const COVERAGE_BUCKETS = {
    indexed: 0,
    discovered: 0,
    crawled: 0,
    unknown: 0,
    canonical: 0,
    excluded: 0,
    fail: 0,
    api_err: 0,
    neutral: 0,
    other: 0,
  };
  const mobileBuckets = { PASS: 0, FAIL: 0, ERR: 0, other: 0 };
  const byDate = {};
  let totalUrls = 0;
  const failedUrls = [];

  function classify(coverage, idxStatus) {
    if (coverage === 'Submitted and indexed') return 'indexed';
    if (coverage === 'Discovered - currently not indexed') return 'discovered';
    if (coverage === 'Crawled - currently not indexed') return 'crawled';
    if (coverage === 'URL is unknown to Google') return 'unknown';
    if (coverage === 'Alternate page with proper canonical tag') return 'canonical';
    if (coverage.toLowerCase().includes('excluded')) return 'excluded';
    if (idxStatus === 'PASS') return 'indexed';
    if (idxStatus === 'FAIL') return 'fail';
    if (idxStatus === 'ERR' || idxStatus === '') return 'api_err';
    if (idxStatus === 'NEUTRAL') return 'neutral';
    return 'other';
  }

  for (const day of gscDaily) {
    byDate[day.date] = {
      total: day.rows.length,
      indexed: 0, discovered: 0, crawled: 0, unknown: 0,
      canonical: 0, excluded: 0, fail: 0, api_err: 0, neutral: 0, other: 0,
    };
    for (const r of day.rows) {
      totalUrls++;
      const cov = (r.coverage_state ?? '').trim();
      const idx = (r.index_status ?? '').trim();
      const mob = (r.mobile_usability ?? '').trim();
      const verdict = classify(cov, idx);

      byDate[day.date][verdict]++;
      COVERAGE_BUCKETS[verdict]++;

      if (mob === 'PASS' || mob === 'MOBILE_FRIENDLY') mobileBuckets.PASS++;
      else if (mob === 'FAIL' || mob === 'NOT_MOBILE_FRIENDLY') mobileBuckets.FAIL++;
      else if (mob === 'ERR' || mob === '') mobileBuckets.ERR++;
      else mobileBuckets.other++;

      // collect attention URLs: FAIL / API_ERR / mobile FAIL
      const isFail = verdict === 'fail' || verdict === 'api_err';
      const isMobFail = mob === 'FAIL' || mob === 'ERR';
      if (isFail || isMobFail) {
        failedUrls.push({
          date: day.date,
          url: r.url,
          coverage: cov,
          index: idx,
          mobile: mob,
          verdict,
        });
      }
    }
  }

  const dates = Object.keys(byDate).sort();
  const trend = dates.map((d) => ({
    date: d,
    indexed: byDate[d].indexed,
    discovered: byDate[d].discovered,
    crawled: byDate[d].crawled,
    unknown: byDate[d].unknown,
    fail: byDate[d].fail,
    api_err: byDate[d].api_err,
    total: byDate[d].total,
    // legacy aliases (kept for chart helpers that read pass/fail/err)
    pass: byDate[d].indexed,
    err: byDate[d].api_err,
  }));

  const latest = dates[dates.length - 1];
  const latestStats = latest ? byDate[latest] : null;
  const overallPassRate = totalUrls > 0
    ? Math.round((COVERAGE_BUCKETS.indexed / totalUrls) * 1000) / 10
    : 0;

  return {
    totalUrls,
    idxBuckets: COVERAGE_BUCKETS, // keep name for downstream chart/legend compat
    mobileBuckets,
    trend,
    dates,
    latest,
    latestStats,
    overallPassRate,
    failedUrls: failedUrls.slice(0, 30),
  };
})();

// Baidu metrics
const baiduMetrics = (() => {
  const byDate = {};
  let totalRows = 0;
  let totalClicks = 0;
  let totalImpr = 0;
  const rankedRows = []; // rank is numeric
  const errRows = [];

  for (const day of baiduDaily) {
    byDate[day.date] = { total: 0, ranked: 0, err: 0, clicks: 0, impressions: 0 };
    for (const r of day.rows) {
      totalRows++;
      const clicks = parseInt(r.clicks ?? '0', 10) || 0;
      const impr = parseInt(r.impressions ?? '0', 10) || 0;
      const rankStr = (r.rank ?? '').trim();
      const rankNum = parseInt(rankStr, 10);
      byDate[day.date].total++;
      byDate[day.date].clicks += clicks;
      byDate[day.date].impressions += impr;
      if (rankStr === 'ERR' || isNaN(rankNum)) {
        byDate[day.date].err++;
        errRows.push({ date: day.date, keyword: r.keyword, category: r.category });
      } else {
        byDate[day.date].ranked++;
        rankedRows.push({
          date: day.date,
          keyword: r.keyword,
          category: r.category,
          rank: rankNum,
          clicks,
          impressions: impr,
        });
      }
      totalClicks += clicks;
      totalImpr += impr;
    }
  }

  const dates = Object.keys(byDate).sort();
  const trend = dates.map((d) => ({
    date: d,
    total: byDate[d].total,
    ranked: byDate[d].ranked,
    err: byDate[d].err,
    clicks: byDate[d].clicks,
    impressions: byDate[d].impressions,
  }));

  const top = rankedRows
    .filter((r) => r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  const latest = dates[dates.length - 1];
  const latestStats = latest ? byDate[latest] : null;

  return {
    totalRows,
    totalClicks,
    totalImpr,
    trend,
    dates,
    latest,
    latestStats,
    top,
    errRows: errRows.slice(0, 20),
  };
})();

// -----------------------------------------------------------------------------
// 5. SVG chart helpers (pure inline, no CDN)
// -----------------------------------------------------------------------------

// Pie/donut: returns SVG string for a single ring
function svgDonut(buckets, colors, size = 160, stroke = 28) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${(size - stroke) / 2}"
        fill="none" stroke="#e5e7eb" stroke-width="${stroke}" />
      <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="middle"
        font-size="14" fill="#9ca3af">无数据</text>
    </svg>`;
  }
  const radius = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  let acc = 0;
  const segments = Object.entries(buckets)
    .filter(([_, v]) => v > 0)
    .map(([k, v]) => {
      const fraction = v / total;
      const dasharray = `${fraction * circumference} ${circumference}`;
      const dashoffset = -acc * circumference;
      acc += fraction;
      const color = colors[k] ?? '#9ca3af';
      return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
        stroke="${color}" stroke-width="${stroke}"
        stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})" />`;
    })
    .join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="${stroke}" />
    ${segments}
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
      font-size="${size / 6}" font-weight="600" fill="#111827">${total}</text>
  </svg>`;
}

function svgLegend(buckets, colors, labels) {
  return `<ul class="legend">${Object.entries(buckets)
    .map(([k, v]) => {
      const color = colors[k] ?? '#9ca3af';
      const label = labels[k] ?? k;
      return `<li><span class="swatch" style="background:${color}"></span>${label} <strong>${v}</strong></li>`;
    })
    .join('')}</ul>`;
}

// Trend chart: stacked bars (PASS / FAIL / ERR) + line overlay
function svgTrendBars(trend, w = 640, h = 220, padding = { l: 50, r: 16, t: 20, b: 40 }) {
  if (!trend || trend.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#9ca3af">暂无趋势数据</text>
    </svg>`;
  }
  const innerW = w - padding.l - padding.r;
  const innerH = h - padding.t - padding.b;
  const maxTotal = Math.max(...trend.map((t) => t.total || 0), 1);
  const barW = Math.max(8, (innerW / trend.length) * 0.7);
  const slot = innerW / trend.length;

  const bars = trend.map((t, i) => {
    const x = padding.l + i * slot + (slot - barW) / 2;
    const totalH = (t.total / maxTotal) * innerH;
    const passH = (t.pass / maxTotal) * innerH;
    const failH = (t.fail / maxTotal) * innerH;
    const errH = (t.err / maxTotal) * innerH;
    let yCursor = padding.t + (innerH - totalH);
    const segs = [];
    if (passH > 0) { segs.push(`<rect x="${x}" y="${yCursor}" width="${barW}" height="${passH}" fill="#10b981" />`); yCursor += passH; }
    if (failH > 0) { segs.push(`<rect x="${x}" y="${yCursor}" width="${barW}" height="${failH}" fill="#ef4444" />`); yCursor += failH; }
    if (errH > 0) { segs.push(`<rect x="${x}" y="${yCursor}" width="${barW}" height="${errH}" fill="#9ca3af" />`); yCursor += errH; }
    // x-axis label
    const labelX = padding.l + i * slot + slot / 2;
    const label = t.date.slice(5); // MM-DD
    return { segs: segs.join(''), label, labelX };
  }).map((b) => `${b.segs}<text x="${b.labelX}" y="${h - 18}" text-anchor="middle" font-size="11" fill="#6b7280">${b.label}</text>`).join('');

  // y-axis ticks (0, 25%, 50%, 75%, 100% of maxTotal)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const v = Math.round(maxTotal * p);
    const y = padding.t + innerH - p * innerH;
    return `<line x1="${padding.l}" y1="${y}" x2="${w - padding.r}" y2="${y}" stroke="#f3f4f6" stroke-width="1" />
      <text x="${padding.l - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    ${ticks}
    ${bars}
  </svg>`;
}

// Baidu trend: line chart of clicks/impressions over dates
function svgTrendLine(trend, metric, color, w = 640, h = 180, padding = { l: 50, r: 16, t: 16, b: 36 }) {
  if (!trend || trend.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" xmlns="http://www.w3.org/2000/svg">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#9ca3af">暂无数据</text>
    </svg>`;
  }
  const innerW = w - padding.l - padding.r;
  const innerH = h - padding.t - padding.b;
  const max = Math.max(...trend.map((t) => t[metric] || 0), 1);
  const slot = innerW / Math.max(1, trend.length - 1);
  const points = trend.map((t, i) => {
    const x = padding.l + i * slot;
    const y = padding.t + innerH - (t[metric] / max) * innerH;
    return [x, y];
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const dots = points.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${color}" />`).join('');
  const labels = trend.map((t, i) => {
    const x = padding.l + i * slot;
    return `<text x="${x}" y="${h - 12}" text-anchor="middle" font-size="11" fill="#6b7280">${t.date.slice(5)}</text>`;
  }).join('');
  const ticks = [0, 0.5, 1].map((p) => {
    const v = Math.round(max * p);
    const y = padding.t + innerH - p * innerH;
    return `<text x="${padding.l - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    ${ticks}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" />
    ${dots}
    ${labels}
  </svg>`;
}

// -----------------------------------------------------------------------------
// 6. Render HTML
// -----------------------------------------------------------------------------
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const COV_COLORS = {
  indexed: '#10b981',     // green - successfully indexed
  discovered: '#3b82f6',  // blue - found but not indexed
  crawled: '#60a5fa',     // light blue - crawled but not indexed
  unknown: '#f59e0b',     // amber - Google doesn't know
  canonical: '#8b5cf6',   // purple - alternate with canonical
  excluded: '#a3a3a3',    // gray - excluded (noindex/etc)
  fail: '#ef4444',        // red - indexing failed
  api_err: '#9ca3af',     // dark gray - API error
  neutral: '#d4d4d8',     // light gray - verdict NEUTRAL
  other: '#6b7280',       // dim gray - unclassified
};
const COV_LABELS = {
  indexed: '已索引',
  discovered: '已发现未索引',
  crawled: '已抓取未索引',
  unknown: 'Google 未知',
  canonical: '规范页',
  excluded: '被排除',
  fail: '索引失败',
  api_err: 'API 错误',
  neutral: '未生效',
  other: '其它',
};
const MOB_COLORS = { PASS: '#10b981', FAIL: '#f59e0b', ERR: '#9ca3af', other: '#6b7280' };
const MOB_LABELS = { PASS: '移动友好', FAIL: '移动不友好', ERR: 'API 错误', other: '未指定' };

const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const todayBj = new Date().toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false,
}).replace(/\//g, '-');

const dataSources = [
  ...baiduDaily.map((d) => `baidu-keyword-rank-${d.date}.csv (${d.rows.length} 行)`),
  ...gscDaily.map((d) => `gsc-inspection-${d.date}.csv (${d.rows.length} 行)`),
];

// Build chart fragments
const gscCoverageChart = svgDonut(gscMetrics.idxBuckets, COV_COLORS);
const gscCoverageLegend = svgLegend(gscMetrics.idxBuckets, COV_COLORS, COV_LABELS);
const gscMobileChart = svgDonut(gscMetrics.mobileBuckets, MOB_COLORS);
const gscMobileLegend = svgLegend(gscMetrics.mobileBuckets, MOB_COLORS, MOB_LABELS);
const gscTrendChart = svgTrendBars(gscMetrics.trend);
const baiduClicksChart = svgTrendLine(baiduMetrics.trend, 'clicks', '#3b82f6');
const baiduImprChart = svgTrendLine(baiduMetrics.trend, 'impressions', '#8b5cf6');

// Tables
const failedUrlsRows = gscMetrics.failedUrls.length === 0
  ? '<tr><td colspan="5" class="muted">无失败/错误 URL</td></tr>'
  : gscMetrics.failedUrls.map((u) => `
    <tr>
      <td><code>${escapeHtml(u.date)}</code></td>
      <td class="url"><code>${escapeHtml(u.url)}</code></td>
      <td><span class="tag ${u.coverage === 'FAIL' ? 'tag-fail' : u.coverage === 'ERR' ? 'tag-err' : 'tag-ok'}">${escapeHtml(u.coverage)}</span></td>
      <td><span class="tag ${u.index === 'FAIL' ? 'tag-fail' : u.index === 'ERR' ? 'tag-err' : 'tag-ok'}">${escapeHtml(u.index)}</span></td>
      <td><span class="tag ${u.mobile === 'FAIL' ? 'tag-fail' : u.mobile === 'ERR' ? 'tag-err' : 'tag-ok'}">${escapeHtml(u.mobile)}</span></td>
    </tr>`).join('');

const topKeywordsRows = baiduMetrics.top.length === 0
  ? '<tr><td colspan="4" class="muted">暂无百度数据（cron 还没接，需 PowerShell 灌 token）</td></tr>'
  : baiduMetrics.top.map((k) => `
    <tr>
      <td>${escapeHtml(k.keyword)}</td>
      <td><span class="tag tag-cat">${escapeHtml(k.category || '?')}</span></td>
      <td class="num">${k.clicks}</td>
      <td class="num">${k.impressions}</td>
    </tr>`).join('');

const baiduErrRows = baiduMetrics.errRows.length === 0
  ? '<tr><td colspan="3" class="muted">无 ERR 关键词</td></tr>'
  : baiduMetrics.errRows.map((k) => `
    <tr>
      <td><code>${escapeHtml(k.date)}</code></td>
      <td>${escapeHtml(k.keyword)}</td>
      <td><span class="tag tag-cat">${escapeHtml(k.category || '?')}</span></td>
    </tr>`).join('');

// Latest-day stats
const latestGsc = gscMetrics.latest
  ? `${gscMetrics.latest} · 总 ${gscMetrics.latestStats.total} / 已索引 ${gscMetrics.latestStats.indexed} / 失败 ${gscMetrics.latestStats.fail} / API 错误 ${gscMetrics.latestStats.api_err}`
  : '无 GSC 数据';
const latestBaidu = baiduMetrics.latest
  ? `${baiduMetrics.latest} · 总 ${baiduMetrics.latestStats.total} 词 / 有排名 ${baiduMetrics.latestStats.ranked} / ERR ${baiduMetrics.latestStats.err}`
  : '无百度数据';

// Page CSS (inline, scoped, dark-friendly)
const PAGE_CSS = `
  :root {
    --bg: #f9fafb; --card: #ffffff; --text: #111827; --muted: #6b7280;
    --border: #e5e7eb; --ok: #10b981; --warn: #f59e0b; --err: #ef4444; --info: #3b82f6;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    margin-bottom: 24px; gap: 12px; }
  h1 { font-size: 24px; margin: 0; }
  h2 { font-size: 18px; margin: 0 0 12px 0; color: var(--text); }
  .stamp { font-size: 12px; color: var(--muted); }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px; margin-bottom: 24px; }
  .kpi { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px; }
  .kpi .label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .kpi .value { font-size: 28px; font-weight: 700; }
  .kpi .detail { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 16px; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px; }
  .card-full { grid-column: 1 / -1; }
  .chart-wrap { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .chart-svg { max-width: 100%; height: auto; display: block; }
  .legend { list-style: none; padding: 0; margin: 0; font-size: 13px; }
  .legend li { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .legend li strong { margin-left: auto; font-weight: 600; }
  .swatch { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
  th { background: #f3f4f6; font-weight: 600; color: var(--muted); font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.5px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.url { word-break: break-all; }
  td.url code, td code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px;
    font-size: 12px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px;
    font-weight: 600; }
  .tag-ok { background: #d1fae5; color: #065f46; }
  .tag-fail { background: #fee2e2; color: #991b1b; }
  .tag-err { background: #e5e7eb; color: #4b5563; }
  .tag-cat { background: #ede9fe; color: #5b21b6; }
  .muted { color: var(--muted); text-align: center; padding: 16px; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
    font-size: 12px; color: var(--muted); }
  footer code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
  .alert { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px;
    padding: 12px 16px; margin-bottom: 16px; font-size: 13px; }
  .alert strong { color: #92400e; }
`;

// Build template vars
const TPL_VARS = {
  TITLE: 'SEO 控制台 · jinman-plastics.com.cn',
  CSS: PAGE_CSS,
  GENERATED_AT: escapeHtml(todayBj),
  KPI_GSC_TOTAL: gscMetrics.totalUrls,
  KPI_GSC_PASSRATE: gscMetrics.overallPassRate + '%',
  KPI_GSC_FAILED: gscMetrics.failedUrls.length,
  KPI_GSC_LATEST: escapeHtml(latestGsc),
  KPI_BAIDU_TOTAL: baiduMetrics.totalRows,
  KPI_BAIDU_CLICKS: baiduMetrics.totalClicks,
  KPI_BAIDU_IMPR: baiduMetrics.totalImpr,
  KPI_BAIDU_LATEST: escapeHtml(latestBaidu),
  GSC_COV_CHART: gscCoverageChart,
  GSC_COV_LEGEND: gscCoverageLegend,
  GSC_MOB_CHART: gscMobileChart,
  GSC_MOB_LEGEND: gscMobileLegend,
  GSC_TREND_CHART: gscTrendChart,
  BAIDU_CLICKS_CHART: baiduClicksChart,
  BAIDU_IMPR_CHART: baiduImprChart,
  FAILED_URLS_ROWS: failedUrlsRows,
  TOP_KEYWORDS_ROWS: topKeywordsRows,
  BAIDU_ERR_ROWS: baiduErrRows,
  DATA_SOURCES: dataSources.length
    ? dataSources.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('')
    : '<li class="muted">无数据</li>',
  NOW_STAMP: escapeHtml(now),
};

let html = readFileSync(TEMPLATE, 'utf8');
for (const [k, v] of Object.entries(TPL_VARS)) {
  html = html.split(`{{${k}}}`).join(v);
}

// -----------------------------------------------------------------------------
// 7. Write output
// -----------------------------------------------------------------------------
if (!existsSync(DIST_DIR)) {
  // eslint-disable-next-line no-undef
  const fs = await import('node:fs');
  fs.mkdirSync(DIST_DIR, { recursive: true });
}
const outPath = join(DIST_DIR, 'index.html');
writeFileSync(outPath, html, 'utf8');
const size = statSync(outPath).size;
console.log(`[build] OK → ${outPath} (${size} bytes)`);
console.log(`[build] GSC: ${gscMetrics.totalUrls} URLs / ${gscMetrics.dates.length} days`);
console.log(`[build] Baidu: ${baiduMetrics.totalRows} keywords / ${baiduMetrics.dates.length} days`);