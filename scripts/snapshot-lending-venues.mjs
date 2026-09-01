import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'data', 'lending-venue-stats.csv');
const LENDING_CATEGORIES = new Set([
  'Lending',
  'NFT Lending',
  'RWA Lending',
  'Uncollateralized Lending',
]);

const requestedDate = process.argv[2] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
  throw new Error('Pass the optional snapshot date as YYYY-MM-DD.');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function currentBorrowed(protocol) {
  const aggregate = finiteNumber(protocol.chainTvls?.borrowed);
  if (aggregate !== null) return aggregate;

  return Object.entries(protocol.chainTvls || {})
    .filter(([key]) => key.endsWith('-borrowed'))
    .reduce((sum, [, value]) => sum + (finiteNumber(value) || 0), 0);
}

function metricBySlug(rows) {
  return new Map(rows.filter((row) => row.slug).map((row) => [row.slug, row]));
}

function metricValue(row) {
  return {
    ttm: finiteNumber(row?.total1y),
    annualized: finiteNumber(row?.annualized1y),
  };
}

function dateDaysAgo(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function pointDate(point) {
  const rawValue = Array.isArray(point) ? point[0] : point?.date;
  const timestamp = Number(rawValue);
  if (typeof rawValue === 'string' && !Number.isFinite(timestamp)) {
    const date = new Date(rawValue);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (!Number.isFinite(timestamp)) return null;
  const milliseconds = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function pointValue(point) {
  return finiteNumber(Array.isArray(point) ? point[1] : point?.totalLiquidityUSD);
}

function valueAtOrBefore(points, targetDate) {
  const target = Date.parse(`${targetDate}T23:59:59Z`);
  return points
    .map((point) => ({ date: pointDate(point), value: pointValue(point) }))
    .filter((point) => point.date && point.value !== null && Date.parse(`${point.date}T12:00:00Z`) <= target)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.value ?? null;
}

function trailingMetricAt(row, targetDate) {
  const target = Date.parse(`${targetDate}T23:59:59Z`);
  const start = target - (364 * 86400000);
  const points = (row?.totalDataChart || [])
    .map((point) => ({ date: pointDate(point), value: pointValue(point) }))
    .filter((point) => {
      if (!point.date || point.value === null) return false;
      const time = Date.parse(`${point.date}T12:00:00Z`);
      return time >= start && time <= target;
    });
  if (points.length === 0) return null;

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const observedDays = new Set(points.map((point) => point.date)).size;
  return observedDays >= 330 ? total : total * (365 / observedDays);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function csvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

const [protocols, fees, earningsResponse] = await Promise.all([
  fetchJson('https://api.llama.fi/protocols'),
  fetchJson('https://api.llama.fi/overview/fees?dataType=dailyFees'),
  fetchJson('https://api.llama.fi/overview/fees?dataType=dailyRevenue'),
]);

const feeBySlug = metricBySlug(fees.protocols || []);
const earningsBySlug = metricBySlug(earningsResponse.protocols || []);
const venues = protocols
  .filter((protocol) => LENDING_CATEGORIES.has(protocol.category) && protocol.slug)
  .sort((a, b) => a.name.localeCompare(b.name));
const priorDate = dateDaysAgo(requestedDate, 90);
const borrowedHistory = await mapWithConcurrency(venues, 16, async (protocol) => {
  const requests = [fetchJson(`https://api.llama.fi/protocol/${protocol.slug}`)];
  if (feeBySlug.has(protocol.slug)) requests.push(fetchJson(`https://api.llama.fi/summary/fees/${protocol.slug}?dataType=dailyFees`));
  if (earningsBySlug.has(protocol.slug)) requests.push(fetchJson(`https://api.llama.fi/summary/fees/${protocol.slug}?dataType=dailyRevenue`));
  const responses = await Promise.allSettled(requests);
  const protocolResponse = responses[0]?.status === 'fulfilled' ? responses[0].value : null;
  const feeResponse = feeBySlug.has(protocol.slug)
    ? responses[1]?.status === 'fulfilled' ? responses[1].value : null
    : null;
  const earningsResponse = earningsBySlug.has(protocol.slug)
    ? responses[feeBySlug.has(protocol.slug) ? 2 : 1]?.status === 'fulfilled'
      ? responses[feeBySlug.has(protocol.slug) ? 2 : 1].value
      : null
    : null;
  return [protocol.slug, {
    borrowed: protocolResponse?.chainTvls?.borrowed?.tvl || [],
    fees: feeResponse?.totalDataChart || [],
    earnings: earningsResponse?.totalDataChart || [],
  }];
});
const borrowedHistoryBySlug = new Map(borrowedHistory);

const rows = venues.map((protocol) => {
  const fee = metricValue(feeBySlug.get(protocol.slug));
  const earnings = metricValue(earningsBySlug.get(protocol.slug));
  const history = borrowedHistoryBySlug.get(protocol.slug);
  const priorBorrowed = valueAtOrBefore(history?.borrowed, priorDate);
  const priorRevenue = trailingMetricAt({ totalDataChart: history?.fees }, priorDate);
  const priorEarnings = trailingMetricAt({ totalDataChart: history?.earnings }, priorDate);
  return [
    requestedDate,
    protocol.slug,
    protocol.name,
    protocol.category,
    currentBorrowed(protocol),
    fee.ttm,
    fee.annualized,
    earnings.ttm,
    earnings.annualized,
    priorBorrowed,
    priorRevenue,
    priorEarnings,
  ].map(csvValue).join(',');
});

await fs.writeFile(outputPath, [
  'date,protocol,name,category,active_loans,revenue_ttm,revenue_annualized,earnings_ttm,earnings_annualized,active_loans_90d_ago,revenue_90d_ago,earnings_90d_ago',
  ...rows,
  '',
].join('\n'), 'utf8');

console.log(`Wrote ${rows.length} lending venue rows to ${outputPath}`);
