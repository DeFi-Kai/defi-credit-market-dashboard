const PROTOCOLS = [
  { id: 'aave', slug: 'aave', capitalRiskAdjustment: 155000000, takeType: 'defensible-premium' },
  { id: 'morpho', slug: 'morpho', capitalRiskAdjustment: 0, takeType: 'capture-sacrificed-for-scale' },
  { id: 'spark-lend', slug: 'spark', capitalRiskAdjustment: 39300000, takeType: 'ancillary-take' },
  { id: 'kamino', slug: 'kamino', capitalRiskAdjustment: 0, takeType: 'defensible-premium' },
  { id: 'jupiter-lend', slug: 'jupiter-lend', capitalRiskAdjustment: 0, takeType: 'reserve-factor-dependent' },
  { id: 'fluid', slug: 'fluid', capitalRiskAdjustment: 0, takeType: 'reserve-factor-dependent' },
  { id: 'euler', slug: 'euler', capitalRiskAdjustment: 0, takeType: 'ancillary-take' },
  { id: 'compound', slug: 'compound-finance', capitalRiskAdjustment: 0, takeType: 'reserve-factor-dependent' },
];

const requestedDate = process.argv[2];
const snapshotDate = requestedDate || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  throw new Error('Pass the optional snapshot date as YYYY-MM-DD.');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

function trailingAverageBorrowed(history, currentBorrowed) {
  const latestYear = history.slice(-365);
  if (latestYear.length === 0) return currentBorrowed || null;
  const total = latestYear.reduce((sum, point) => sum + point.totalLiquidityUSD, 0);
  return Math.round(total / latestYear.length);
}

async function buildRow(protocol) {
  const [protocolData, feesData, revenueData] = await Promise.all([
    fetchJson(`https://api.llama.fi/protocol/${protocol.slug}`),
    fetchJson(`https://api.llama.fi/summary/fees/${protocol.slug}?dataType=dailyFees`),
    fetchJson(`https://api.llama.fi/summary/fees/${protocol.slug}?dataType=dailyRevenue`),
  ]);

  const currentBorrowed = protocolData.currentChainTvls?.borrowed || null;
  const borrowedHistory = protocolData.chainTvls?.borrowed?.tvl || [];

  return [
    snapshotDate,
    protocol.id,
    trailingAverageBorrowed(borrowedHistory, currentBorrowed) || '',
    Math.round(feesData.total1y || 0),
    Math.round(revenueData.total1y || 0),
    '0',
    '0.025',
    protocol.capitalRiskAdjustment,
    protocol.takeType,
  ].join(',');
}

const rows = await Promise.all(PROTOCOLS.map(buildRow));
console.log('date,protocol,active_loans,revenue_ttm,earnings_ttm,incentives_ttm,capital_risk_rate,capital_risk_adjustment,take_type');
console.log(rows.join('\n'));
