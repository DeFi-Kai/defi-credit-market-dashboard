import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'data', 'market-utilization.csv');
const LENDING_CATEGORIES = new Set([
  'Lending',
  'NFT Lending',
  'RWA Lending',
  'Uncollateralized Lending',
]);

const requestedStart = process.argv[2] || null;
if (requestedStart && !/^\d{4}-\d{2}-\d{2}$/.test(requestedStart)) {
  throw new Error('Pass the optional start date as YYYY-MM-DD.');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

function pointDate(point) {
  const timestamp = Number(point.date);
  if (!Number.isFinite(timestamp)) return null;
  const milliseconds = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(milliseconds).toISOString().slice(0, 10);
  return requestedStart && date < requestedStart ? null : date;
}

function pointValue(point) {
  const value = Number(point.totalLiquidityUSD);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function historyByDate(points) {
  return new Map(points
    .map((point) => ({ date: pointDate(point), value: pointValue(point) }))
    .filter((point) => point.date && point.value !== null)
    .map((point) => [point.date, point.value]));
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

const protocols = await fetchJson('https://api.llama.fi/protocols');
const venues = protocols
  .filter((protocol) => LENDING_CATEGORIES.has(protocol.category) && protocol.slug)
  .sort((a, b) => a.name.localeCompare(b.name));

const histories = await mapWithConcurrency(venues, 16, async (venue) => {
  try {
    const protocol = await fetchJson(`https://api.llama.fi/protocol/${venue.slug}`);
    return {
      borrowed: historyByDate(protocol.chainTvls?.borrowed?.tvl || []),
      tvl: historyByDate(protocol.tvl || protocol.chainTvls?.total?.tvl || []),
    };
  } catch (error) {
    console.warn(`Skipping ${venue.slug}: ${error.message}`);
    return null;
  }
});

const snapshots = new Map();
for (const history of histories) {
  if (!history) continue;
  const dates = new Set([...history.borrowed.keys(), ...history.tvl.keys()]);
  for (const date of dates) {
    const snapshot = snapshots.get(date) || { activeLoans: 0, tvl: 0, borrowedVenues: 0, tvlVenues: 0 };
    const borrowed = history.borrowed.get(date);
    const tvl = history.tvl.get(date);
    if (borrowed !== undefined) {
      snapshot.activeLoans += borrowed;
      snapshot.borrowedVenues += 1;
    }
    if (tvl !== undefined) {
      snapshot.tvl += tvl;
      snapshot.tvlVenues += 1;
    }
    snapshots.set(date, snapshot);
  }
}

const rows = [...snapshots.entries()]
  .filter(([, snapshot]) => snapshot.activeLoans > 0 && snapshot.tvl > 0 && snapshot.tvlVenues > 0)
  .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
  .map(([date, snapshot]) => [
    date,
    Math.round(snapshot.activeLoans),
    Math.round(snapshot.tvl),
    (snapshot.activeLoans / snapshot.tvl).toFixed(8),
    snapshot.borrowedVenues,
    snapshot.tvlVenues,
  ].join(','));

await fs.writeFile(outputPath, [
  'date,total_active_loans,total_tvl,utilization,borrowed_venues,tvl_venues',
  ...rows,
  '',
].join('\n'), 'utf8');

console.log(`Wrote ${rows.length} dates across ${venues.length} lending venues to ${outputPath}`);
