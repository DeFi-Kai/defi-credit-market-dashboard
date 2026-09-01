import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'data', 'active-loan-market-share.csv');

const PROTOCOLS = [
  { id: 'aave', slug: 'aave' },
  { id: 'morpho', slug: 'morpho' },
  { id: 'spark-lend', slug: 'spark' },
  { id: 'kamino', slug: 'kamino' },
  { id: 'jupiter-lend', slug: 'jupiter-lend' },
  { id: 'fluid', slug: 'fluid' },
  { id: 'euler', slug: 'euler' },
  { id: 'compound', slug: 'compound-finance' },
];

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

const histories = await Promise.all(PROTOCOLS.map(async (protocol) => {
  const payload = await fetchJson(`https://api.llama.fi/protocol/${protocol.slug}`);
  const points = payload.chainTvls?.borrowed?.tvl || [];
  return {
    protocol,
    points: points
      .map((point) => ({ date: pointDate(point), activeLoans: Number(point.totalLiquidityUSD) }))
      .filter((point) => point.date && Number.isFinite(point.activeLoans) && point.activeLoans >= 0),
  };
}));

const snapshots = new Map();
for (const { protocol, points } of histories) {
  for (const point of points) {
    if (!snapshots.has(point.date)) snapshots.set(point.date, new Map());
    snapshots.get(point.date).set(protocol.id, point.activeLoans);
  }
}

const rows = [];
for (const date of [...snapshots.keys()].sort()) {
  const protocols = snapshots.get(date);
  const totalActiveLoans = [...protocols.values()].reduce((sum, activeLoans) => sum + activeLoans, 0);
  if (totalActiveLoans <= 0) continue;

  const availableProtocols = PROTOCOLS.filter((protocol) => protocols.has(protocol.id));
  const shareUnits = availableProtocols.map((protocol) => Math.round((protocols.get(protocol.id) / totalActiveLoans) * 1e8));
  shareUnits[shareUnits.length - 1] += 1e8 - shareUnits.reduce((sum, units) => sum + units, 0);

  for (const [index, protocol] of availableProtocols.entries()) {
    const activeLoans = protocols.get(protocol.id);
    rows.push([
      date,
      protocol.id,
      Math.round(activeLoans),
      (shareUnits[index] / 1e8).toFixed(8),
    ].join(','));
  }
}

await fs.writeFile(outputPath, [
  'date,protocol,active_loans,market_share',
  ...rows,
  '',
].join('\n'), 'utf8');

console.log(`Wrote ${rows.length} rows across ${snapshots.size} dates to ${outputPath}`);
