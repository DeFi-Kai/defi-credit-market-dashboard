const state = {
  fundamentals: [],
  fundamentalsHistory: [],
  marketShareHistory: [],
  marketUtilizationHistory: [],
  scorecardDriverHistory: [],
  allVenueStats: [],
  allVenueStatsDate: null,
  fundamentalsDate: null,
  scorecardProtocolId: null,
  scorecardTimeframe: '90D',
  fundamentalsSortKey: null,
  fundamentalsSortDirection: 'asc',
};

const SELECTED_PROTOCOL_KEY = 'defi-dashboard-selected-protocol';

function readSelectedProtocol() {
  try {
    return window.localStorage.getItem(SELECTED_PROTOCOL_KEY);
  } catch {
    return null;
  }
}

function publishSelectedProtocol(protocolId) {
  try {
    window.localStorage.setItem(SELECTED_PROTOCOL_KEY, protocolId);
  } catch {
    // The in-memory selection still synchronizes the two panels for this session.
  }
  window.dispatchEvent(new CustomEvent('protocol-selection-changed', { detail: { protocolId } }));
}

let profitPoolChart = null;
let scorecardChart = null;
let scorecardBorrowShareChart = null;
let marketShareChart = null;
let marketUtilizationChart = null;
const scorecardDriverCharts = { scale: null, price: null, capture: null };

const els = {
  freshness: document.querySelector('#freshness'),
  profitPoolPanel: document.querySelector('.profit-pool-panel'),
  methodologyPanel: document.querySelector('.methodology-panel'),
  scorecardProtocol: document.querySelector('#scorecard-protocol'),
  scorecardTimeframe: document.querySelector('#scorecard-timeframe'),
  scorecardContext: document.querySelector('#scorecard-context'),
  scorecardHero: document.querySelector('#scorecard-hero'),
  scorecardBorrowShareChart: document.querySelector('#scorecard-borrow-share-chart'),
  scorecardChart: document.querySelector('#scorecard-chart'),
  scorecardScaleChart: document.querySelector('#scorecard-scale-chart'),
  scorecardPriceChart: document.querySelector('#scorecard-price-chart'),
  scorecardCaptureChart: document.querySelector('#scorecard-capture-chart'),
  scorecardScaleCurrent: document.querySelector('#scorecard-scale-current'),
  scorecardScaleRank: document.querySelector('#scorecard-scale-rank'),
  scorecardPriceCurrent: document.querySelector('#scorecard-price-current'),
  scorecardPriceRank: document.querySelector('#scorecard-price-rank'),
  scorecardCaptureCurrent: document.querySelector('#scorecard-capture-current'),
  scorecardCaptureRank: document.querySelector('#scorecard-capture-rank'),
  marketShareChart: document.querySelector('#market-share-chart'),
  marketShareNote: document.querySelector('#market-share-note'),
  marketUtilizationChart: document.querySelector('#market-utilization-chart'),
  fundamentalsDate: document.querySelector('#fundamentals-date'),
  fundamentalsSource: document.querySelector('#fundamentals-source'),
  fundamentalsTable: document.querySelector('#fundamentals-table-body'),
  profitPool: document.querySelector('#profit-pool'),
  totalActiveLoans: document.querySelector('#total-active-loans'),
  totalActiveLoansDelta: document.querySelector('#total-active-loans-delta'),
  totalActiveLoansDetail: document.querySelector('#total-active-loans-detail'),
  totalRevenue: document.querySelector('#total-revenue'),
  totalRevenueDelta: document.querySelector('#total-revenue-delta'),
  totalRevenueDetail: document.querySelector('#total-revenue-detail'),
  topThreeShare: document.querySelector('#top-three-share'),
  topThreeShareDelta: document.querySelector('#top-three-share-delta'),
  topThreeShareList: document.querySelector('#top-three-share-list'),
  themeToggle: document.querySelector('#theme-toggle'),
};

function chartColor(variable, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function chartColors() {
  return {
    text: chartColor('--text', '#242424'),
    muted: chartColor('--muted', '#6f6f6f'),
    muted2: chartColor('--muted-2', '#969696'),
    accent: chartColor('--accent', '#1677f2'),
    chartGrid: chartColor('--chart-grid', 'rgba(116, 128, 151, 0.16)'),
    chartAxis: chartColor('--chart-axis', '#c4ccd9'),
    chartBorder: chartColor('--chart-border', 'rgba(113, 125, 148, 0.34)'),
    chartMedian: chartColor('--chart-median', '#aeb7c7'),
  };
}

const snapshotDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatSnapshotDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : snapshotDateFormatter.format(date);
}

const fundamentalsProtocolNames = {
  aave: 'Aave',
  morpho: 'Morpho',
  'spark-lend': 'SparkLend',
  kamino: 'Kamino',
  'jupiter-lend': 'Jupiter Lend',
  fluid: 'Fluid',
  euler: 'Euler',
  compound: 'Compound',
};

const scorecardProtocolColors = {
  aave: '#1677f2',
  morpho: '#8d63d2',
  'spark-lend': '#e08a33',
  kamino: '#2b9d77',
  'jupiter-lend': '#d35c7a',
  fluid: '#2799b8',
  euler: '#6875c7',
  compound: '#b18a2c',
};

const takeTypeColors = {
  'defensible-premium': '#478bc4',
  'ancillary-take': '#c9a61d',
  'capture-sacrificed-for-scale': '#c84b5d',
  'reserve-factor-dependent': '#92a0af',
};

function parseNumber(value) {
  if (value === undefined || value === null || value.trim() === '') return null;
  const number = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function splitCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += character;
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  return values;
}

function parseFundamentalsCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = splitCsvLine(header);

  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const values = splitCsvLine(line);
      return Object.fromEntries(columns.map((column, index) => [column, values[index] || '']));
    });
}

function deriveLendingVenueStats(row) {
  return {
    date: row.date,
    id: row.protocol,
    name: row.name || row.protocol,
    category: row.category,
    activeLoans: parseNumber(row.active_loans),
    revenueTtm: parseNumber(row.revenue_ttm),
    revenueAnnualized: parseNumber(row.revenue_annualized),
    earningsTtm: parseNumber(row.earnings_ttm),
    earningsAnnualized: parseNumber(row.earnings_annualized),
    activeLoans90dAgo: parseNumber(row.active_loans_90d_ago),
    revenue90dAgo: parseNumber(row.revenue_90d_ago),
    earnings90dAgo: parseNumber(row.earnings_90d_ago),
  };
}

function deriveFundamentals(row) {
  const activeLoans = parseNumber(row.active_loans);
  const revenue = parseNumber(row.revenue_ttm);
  const earnings = parseNumber(row.earnings_ttm);
  const incentives = parseNumber(row.incentives_ttm);
  const capitalRiskRate = parseNumber(row.capital_risk_rate) ?? 0.025;
  const capitalRiskAdjustment = parseNumber(row.capital_risk_adjustment) ?? 0;
  const capitalAtRisk = activeLoans === null ? null : (activeLoans * capitalRiskRate) + capitalRiskAdjustment;
  const takeRate = earnings === null || revenue === null || revenue <= 0 ? null : earnings / revenue;
  const earningsMargin = revenue === null || activeLoans === null || activeLoans <= 0 ? null : revenue / activeLoans;
  const netEarnings = earnings === null || incentives === null ? null : earnings - incentives;
  const roic = netEarnings === null || capitalAtRisk === null || capitalAtRisk === 0 ? null : netEarnings / capitalAtRisk;
  const profitSpread = roic === null ? null : roic - 0.15;
  const economicProfit = netEarnings === null || capitalAtRisk === null ? null : netEarnings - (0.15 * capitalAtRisk);

  return {
    id: row.protocol,
    name: fundamentalsProtocolNames[row.protocol] || row.protocol,
    date: row.date,
    takeType: row.take_type,
    activeLoans,
    revenue,
    earnings,
    incentives,
    capitalAtRisk,
    takeRate,
    earningsMargin,
    roic,
    profitSpread,
    economicProfit,
  };
}

function formatUsd(value) {
  if (value === null || value === undefined) return '--';
  const absolute = Math.abs(value);
  const prefix = value < 0 ? '-' : '';
  if (absolute >= 1e9) return `${prefix}$${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${prefix}$${(absolute / 1e6).toFixed(1)}M`;
  if (absolute >= 1e3) return `${prefix}$${(absolute / 1e3).toFixed(0)}K`;
  return `${prefix}$${absolute.toFixed(0)}`;
}

function formatPercent(value, digits = 1, signed = false) {
  if (value === null || value === undefined) return '--';
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(digits)}%`;
}

function formatSnapshotMonth(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  els.themeToggle?.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
  els.themeToggle?.setAttribute('aria-label', `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} mode`);

  if (persist) {
    try {
      window.localStorage.setItem('defi-dashboard-theme', nextTheme);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }

  if (state.fundamentals.length > 0) {
    if (els.profitPool) renderProfitPool();
    if (els.scorecardProtocol) renderScorecard();
    if (els.marketShareChart) renderMarketShare();
  }
}

function effectiveVenueMetric(row, ttmKey, annualizedKey) {
  return row[ttmKey] ?? row[annualizedKey];
}

function sumAvailable(rows, valueFor) {
  const values = rows.map(valueFor).filter((value) => value !== null && value !== undefined);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function relativeDelta(current, prior) {
  return current === null || prior === null || prior === undefined || prior === 0 ? null : (current - prior) / prior;
}

function formatKpiPointsDelta(value) {
  if (value === null || value === undefined) return '--';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(1)} pp`;
}

function setKpiDelta(element, value, formatter = formatPercent) {
  element.textContent = value === null || value === undefined ? '--' : `${formatter(value, 1, true)} 90D`;
  element.classList.toggle('is-positive', value !== null && value > 0);
  element.classList.toggle('is-negative', value !== null && value < 0);
}

function renderMarketSummary() {
  if (!els.totalActiveLoans) return;
  const snapshotDate = state.allVenueStatsDate;
  const rows = state.allVenueStats.filter((row) => row.date === snapshotDate);
  const activeRows = rows.filter((row) => row.activeLoans !== null && row.activeLoans > 0);
  const totalActiveLoans = sumAvailable(rows, (row) => row.activeLoans);
  const totalActiveLoans90dAgo = sumAvailable(rows, (row) => row.activeLoans90dAgo);
  const totalRevenue = sumAvailable(rows, (row) => effectiveVenueMetric(row, 'revenueTtm', 'revenueAnnualized'));
  const totalRevenue90dAgo = sumAvailable(rows, (row) => row.revenue90dAgo);
  const topThree = [...activeRows]
    .sort((a, b) => b.activeLoans - a.activeLoans)
    .slice(0, 3)
    .map((row) => ({ ...row, share: totalActiveLoans > 0 ? row.activeLoans / totalActiveLoans : null }));
  const topThreeShare = topThree.reduce((sum, row) => sum + (row.share || 0), 0);
  const priorActiveRows = rows.filter((row) => row.activeLoans90dAgo !== null && row.activeLoans90dAgo > 0);
  const totalActiveLoans90dAgoForShare = priorActiveRows.reduce((sum, row) => sum + row.activeLoans90dAgo, 0);
  const priorTopThreeShare = totalActiveLoans90dAgoForShare > 0
    ? priorActiveRows
      .sort((a, b) => b.activeLoans90dAgo - a.activeLoans90dAgo)
      .slice(0, 3)
      .reduce((sum, row) => sum + (row.activeLoans90dAgo / totalActiveLoans90dAgoForShare), 0)
    : null;

  els.totalActiveLoans.textContent = formatUsd(totalActiveLoans);
  els.totalActiveLoansDetail.textContent = `${rows.length} lending venues | ${formatSnapshotDate(snapshotDate)} snapshot`;
  setKpiDelta(els.totalActiveLoansDelta, relativeDelta(totalActiveLoans, totalActiveLoans90dAgo));
  els.totalRevenue.textContent = formatUsd(totalRevenue);
  setKpiDelta(els.totalRevenueDelta, relativeDelta(totalRevenue, totalRevenue90dAgo));
  els.totalRevenueDetail.textContent = 'TTM where available; annualized otherwise';
  els.topThreeShare.textContent = formatPercent(topThreeShare, 1);
  setKpiDelta(els.topThreeShareDelta, priorTopThreeShare === null ? null : topThreeShare - priorTopThreeShare, formatKpiPointsDelta);
  els.topThreeShareList.replaceChildren();

  for (const row of topThree) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = row.name;
    const share = document.createElement('strong');
    share.textContent = formatPercent(row.share, 1);
    item.append(name, share);
    els.topThreeShareList.appendChild(item);
  }
}

function renderMarketSummaryError() {
  if (!els.totalActiveLoans) return;
  els.totalActiveLoans.textContent = '--';
  els.totalActiveLoansDetail.textContent = 'All-venue snapshot unavailable';
  setKpiDelta(els.totalActiveLoansDelta, null);
  els.totalRevenue.textContent = '--';
  setKpiDelta(els.totalRevenueDelta, null);
  els.totalRevenueDetail.textContent = 'All-venue snapshot unavailable';
  els.topThreeShare.textContent = '--';
  setKpiDelta(els.topThreeShareDelta, null, formatKpiPointsDelta);
  els.topThreeShareList.replaceChildren();
}

let methodologyResizeFrame = null;

function syncMethodologyHeight() {
  if (!els.profitPoolPanel || !els.methodologyPanel) return;

  if (window.matchMedia('(max-width: 960px)').matches) {
    els.methodologyPanel.style.removeProperty('height');
    els.methodologyPanel.style.removeProperty('max-height');
    return;
  }

  els.methodologyPanel.style.height = '0px';
  els.methodologyPanel.style.maxHeight = '0px';
  if (methodologyResizeFrame) cancelAnimationFrame(methodologyResizeFrame);
  methodologyResizeFrame = requestAnimationFrame(() => {
    methodologyResizeFrame = null;
    if (window.matchMedia('(max-width: 960px)').matches) {
      els.methodologyPanel.style.removeProperty('height');
      els.methodologyPanel.style.removeProperty('max-height');
      return;
    }
    const height = els.profitPoolPanel.getBoundingClientRect().height;
    els.methodologyPanel.style.height = `${height}px`;
    els.methodologyPanel.style.maxHeight = `${height}px`;
  });
}

window.addEventListener('resize', () => {
  profitPoolChart?.resize();
  scorecardChart?.resize();
  scorecardBorrowShareChart?.resize();
  marketShareChart?.resize();
  marketUtilizationChart?.resize();
  Object.values(scorecardDriverCharts).forEach((chart) => chart?.resize());
  syncMethodologyHeight();
});

function disposeProfitPoolChart() {
  profitPoolChart?.dispose();
  profitPoolChart = null;
}

function disposeScorecardChart() {
  scorecardChart?.dispose();
  scorecardChart = null;
}

function disposeScorecardBorrowShareChart() {
  scorecardBorrowShareChart?.dispose();
  scorecardBorrowShareChart = null;
}

function disposeMarketShareChart() {
  marketShareChart?.dispose();
  marketShareChart = null;
}

function disposeMarketUtilizationChart() {
  marketUtilizationChart?.dispose();
  marketUtilizationChart = null;
}

function disposeScorecardDriverCharts() {
  Object.keys(scorecardDriverCharts).forEach((key) => {
    scorecardDriverCharts[key]?.dispose();
    scorecardDriverCharts[key] = null;
  });
}

function renderProfitPool() {
  if (!els.profitPool) return;
  disposeProfitPoolChart();
  els.profitPool.replaceChildren();
  const completeRows = state.fundamentals
    .filter((row) => row.profitSpread !== null && row.economicProfit !== null && row.capitalAtRisk > 0)
    .sort((a, b) => b.profitSpread - a.profitSpread);
  const pendingCount = state.fundamentals.length - completeRows.length;

  if (completeRows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    const title = document.createElement('strong');
    title.textContent = 'Profit pool awaits TTM incentives';
    const copy = document.createElement('p');
    copy.textContent = `${pendingCount} protocol${pendingCount === 1 ? '' : 's'} loaded. Add each incentives_ttm value in data/fundamentals.csv to calculate ROIC and economic profit.`;
    empty.append(title, copy);
    els.profitPool.appendChild(empty);
    syncMethodologyHeight();
    return;
  }

  if (!window.echarts) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Could not load the ECharts library.';
    els.profitPool.appendChild(empty);
    syncMethodologyHeight();
    return;
  }

  const totalCapital = completeRows.reduce((sum, row) => sum + row.capitalAtRisk, 0);
  const maxSpread = Math.max(0.2, ...completeRows.map((row) => Math.abs(row.profitSpread)));
  const colors = chartColors();
  const chartContainer = document.createElement('div');
  chartContainer.className = 'profit-pool-chart';
  chartContainer.setAttribute('role', 'img');
  chartContainer.setAttribute('aria-label', 'Profit pool. Bar width represents capital at risk, bar height represents return on invested capital less the 15 percent cost of capital, and bar area represents economic profit.');
  els.profitPool.appendChild(chartContainer);

  let cursor = 0;
  const chartData = completeRows.map((row) => {
    const start = cursor;
    cursor += row.capitalAtRisk;
    return {
      name: row.name,
      value: [start, cursor, row.profitSpread, row.economicProfit, row.capitalAtRisk],
      itemStyle: {
        color: takeTypeColors[row.takeType] || colors.accent,
        borderColor: colors.chartBorder,
        borderWidth: 1,
      },
    };
  });

  profitPoolChart = window.echarts.init(chartContainer, null, { renderer: 'canvas' });
  profitPoolChart.setOption({
    animation: false,
    grid: { top: 46, right: 44, bottom: 104, left: 76, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const [, , spread, economicProfit, capitalAtRisk] = params.value;
        return [
          params.name,
          `Spread: ${formatPercent(spread, 0, true)}`,
          `Economic profit: ${formatUsd(economicProfit)}`,
          `Capital at risk: ${formatUsd(capitalAtRisk)}`,
        ].join('<br>');
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: totalCapital,
      axisLine: { lineStyle: { color: colors.chartAxis } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, formatter: (value) => formatUsd(value) },
      splitLine: { show: false },
      name: 'CAPITAL AT RISK (CUMULATIVE)',
      nameLocation: 'middle',
      nameGap: 78,
      nameTextStyle: { color: colors.muted2, fontSize: 12, fontWeight: 700, letterSpacing: 1.3 },
    },
    yAxis: {
      type: 'value',
      min: -maxSpread,
      max: maxSpread,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, formatter: (value) => formatPercent(value, 0, true) },
      splitLine: { lineStyle: { color: colors.chartGrid } },
      name: 'ROIC - 15% COST OF CAPITAL',
      nameLocation: 'end',
      nameGap: 14,
      nameTextStyle: { color: colors.muted2, fontSize: 12, fontWeight: 700, letterSpacing: 1.3 },
    },
    series: [{
      type: 'custom',
      coordinateSystem: 'cartesian2d',
      clip: false,
      encode: { x: [0, 1], y: 2 },
      data: chartData,
      renderItem: (params, api) => {
        const xStart = api.value(0);
        const xEnd = api.value(1);
        const start = api.coord([xStart, 0]);
        const end = api.coord([xEnd, api.value(2)]);
        const rect = window.echarts.graphic.clipRectByRect({
          x: start[0] + 1,
          y: Math.min(start[1], end[1]),
          width: Math.max(1, end[0] - start[0] - 2),
          height: Math.max(2, Math.abs(start[1] - end[1])),
        }, params.coordSys);

        if (!rect) return null;

        const center = start[0] + ((end[0] - start[0]) / 2);
        const plotBottom = params.coordSys.y + params.coordSys.height;
        const isNarrow = rect.width < 112;
        const labelY = plotBottom + 16;

        return {
          type: 'group',
          children: [
            { type: 'rect', shape: rect, style: api.style() },
            {
              type: 'text',
              style: {
                text: params.name,
                x: center,
                y: labelY,
                fill: colors.text,
                font: `${isNarrow ? '600 11px' : '750 13px'} Inter, ui-sans-serif, system-ui, sans-serif`,
                textAlign: 'center',
                textVerticalAlign: 'top',
                width: isNarrow ? 102 : undefined,
                overflow: isNarrow ? 'break' : undefined,
              },
            },
          ],
        };
      },
      markLine: {
        symbol: 'none',
        silent: true,
        lineStyle: { color: colors.chartAxis, width: 1.5 },
        label: { show: true, formatter: '15% hurdle', color: colors.text, position: 'insideEndTop', fontWeight: 700 },
        data: [{ yAxis: 0 }],
      },
    }],
  });

  if (pendingCount > 0) {
    const pending = document.createElement('p');
    pending.className = 'pool-pending';
    pending.textContent = `${pendingCount} protocol${pendingCount === 1 ? '' : 's'} omitted pending a TTM incentives input.`;
    els.profitPool.appendChild(pending);
  }

  syncMethodologyHeight();
}

const SCORECARD_TIMEFRAMES = { '60D': 60, '90D': 90, '1Y': 365 };
const SCORECARD_METRICS = [
  { key: 'activeLoans', label: 'Active Loans', type: 'usd', higherIsBetter: true },
  { key: 'marketShare', label: 'Market Share', type: 'percent', higherIsBetter: true },
  { key: 'loanGrowth', label: 'Loan Growth', type: 'percent', higherIsBetter: true },
  { key: 'revenue', label: 'Revenue', type: 'usd', higherIsBetter: true },
  { key: 'earnings', label: 'Earnings', type: 'usd', higherIsBetter: true },
  { key: 'takeRate', label: 'Take Rate', type: 'percent', digits: 2, higherIsBetter: true },
  { key: 'earningsMargin', label: 'Earnings Margin', type: 'percent', higherIsBetter: true },
  { key: 'economicProfit', label: 'Economic Profit', type: 'usd', higherIsBetter: true },
  { key: 'profitPoolShare', label: 'Profit Pool Share', type: 'percent', higherIsBetter: true },
  { key: 'incentiveIntensity', label: 'Incentive Intensity', type: 'percent', higherIsBetter: false },
];
const SCORECARD_BENCHMARK_METRICS = [
  { ...SCORECARD_METRICS.find((metric) => metric.key === 'activeLoans'), label: 'Scale', detail: 'Active loans' },
  { key: 'grossBorrowYield', label: 'Price', detail: 'Borrow yield', type: 'percent', higherIsBetter: true },
  { ...SCORECARD_METRICS.find((metric) => metric.key === 'takeRate'), label: 'Capture', detail: 'Take rate' },
];
const SCORECARD_BENCHMARK_KEYS = new Set(SCORECARD_BENCHMARK_METRICS.map((metric) => metric.key));
const SCORECARD_HERO_METRICS = ['loanGrowth', 'marketShare'].map((key) => ({
  ...SCORECARD_METRICS.find((metric) => metric.key === key),
  label: key === 'loanGrowth' ? 'Active Loan Growth' : 'Market Share Growth',
}));
const SCORECARD_DRIVER_CONFIG = {
  scale: {
    label: 'Scale',
    type: 'usd',
    empty: 'Active-loan history unavailable.',
  },
  price: {
    label: 'Price',
    type: 'percent',
    empty: 'Add monthly borrow-interest and gross-profit rows to data/scorecard-drivers.csv.',
  },
  capture: {
    label: 'Take rate',
    type: 'percent',
    empty: 'Add monthly gross-profit and borrow-interest rows to data/scorecard-drivers.csv.',
  },
};

function median(values) {
  const sorted = values.filter((value) => value !== null && value !== undefined).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function findFundamentalsSnapshot(targetDate) {
  if (!targetDate) return null;
  const date = [...new Set(state.fundamentalsHistory.map((row) => row.date))]
    .filter((date) => date <= targetDate)
    .sort()
    .at(-1);
  if (!date) return null;
  return {
    date,
    rowsByProtocol: new Map(state.fundamentalsHistory
      .filter((row) => row.date === date)
      .map((row) => [row.id, row])),
  };
}

function scorecardLoanGrowth(protocolId, currentSnapshot, baselineSnapshot) {
  const current = currentSnapshot?.rowsByProtocol.get(protocolId);
  const baseline = baselineSnapshot?.rowsByProtocol.get(protocolId);
  if (!current || !baseline || baseline.activeLoans <= 0) return null;
  return (current.activeLoans - baseline.activeLoans) / baseline.activeLoans;
}

function scorecardMetricsFor(fundamentalsSnapshot, marketSnapshot, growthBaselineSnapshot) {
  if (!fundamentalsSnapshot) return new Map();
  const fundamentals = [...fundamentalsSnapshot.rowsByProtocol.values()];
  const fallbackActiveLoans = fundamentals.reduce((sum, row) => sum + (row.activeLoans || 0), 0);
  const activeLoansTotal = marketSnapshot?.totalActiveLoans > 0 ? marketSnapshot.totalActiveLoans : fallbackActiveLoans;
  const positiveEconomicProfit = fundamentals.reduce((sum, row) => sum + Math.max(0, row.economicProfit || 0), 0);

  return new Map(fundamentals.map((fundamental) => {
    const marketRow = marketSnapshot?.rowsByProtocol.get(fundamental.id);
    const activeLoans = marketRow?.activeLoans ?? fundamental.activeLoans;
    const marketShare = snapshotMarketShare(marketRow, marketSnapshot)
      ?? (activeLoansTotal > 0 && activeLoans !== null ? activeLoans / activeLoansTotal : null);
    const revenue = fundamental.revenue;
    const earnings = fundamental.earnings;
    return [fundamental.id, {
      activeLoans,
      marketShare,
      loanGrowth: scorecardLoanGrowth(fundamental.id, marketSnapshot, growthBaselineSnapshot),
      revenue,
      earnings,
      takeRate: fundamental.takeRate,
      earningsMargin: fundamental.earningsMargin,
      economicProfit: fundamental.economicProfit,
      profitPoolShare: positiveEconomicProfit > 0 && fundamental.economicProfit !== null
        ? Math.max(0, fundamental.economicProfit) / positiveEconomicProfit
        : null,
      incentiveIntensity: fundamental.incentives === null || revenue === null || revenue <= 0
        ? null
        : fundamental.incentives / revenue,
    }];
  }));
}

function scorecardApiMetrics() {
  const protocolPatterns = {
    aave: /^aave(?:-|$)/,
    morpho: /^morpho(?:-|$)/,
    'spark-lend': /^(?:spark|sparklend)(?:-|$)/,
    kamino: /^kamino(?:-|$)/,
    'jupiter-lend': /^jupiter-lend(?:-|$)/,
    fluid: /^fluid(?:-|$)/,
    euler: /^euler(?:-|$)/,
    compound: /^compound(?:-|$)/,
  };
  const rowsByProtocol = new Map();

  for (const [protocolId, pattern] of Object.entries(protocolPatterns)) {
    const rows = state.allVenueStats.filter((row) => row.date === state.allVenueStatsDate && pattern.test(row.id));
    if (rows.length === 0) continue;
    const revenue = sumAvailable(rows, (row) => row.revenue90dAgo);
    const earnings = sumAvailable(rows, (row) => row.earnings90dAgo);
    const activeLoans = sumAvailable(rows, (row) => row.activeLoans90dAgo);
    rowsByProtocol.set(protocolId, {
      revenue,
      earnings,
      takeRate: revenue > 0 && earnings !== null ? earnings / revenue : null,
      earningsMargin: activeLoans > 0 && revenue !== null ? revenue / activeLoans : null,
    });
  }

  return rowsByProtocol;
}

function scorecardGrossBorrowYieldMetrics() {
  const history = trailingDriverHistory(monthlyDriverHistory(), 'price', SCORECARD_TIMEFRAMES[state.scorecardTimeframe], monthlyScaleHistory());
  const latestMonth = [...history.keys()].sort().at(-1);
  return new Map(state.fundamentals.map((row) => [row.id, history.get(latestMonth)?.get(row.id) ?? null]));
}

function scorecardFormatValue(value, metric) {
  if (value === null || value === undefined) return '--';
  return metric.type === 'usd' ? formatUsd(value) : formatPercent(value, metric.digits ?? 1);
}

function scorecardFormatDelta(value, metric) {
  if (value === null || value === undefined) return '--';
  if (metric.type === 'usd') return formatDeltaUsd(value);
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(1)} pp`;
}

function scorecardPriorMetrics(metric, context) {
  if (metric.key === 'activeLoans' || metric.key === 'marketShare') {
    return context.priorMarketMetrics;
  }
  if (metric.key === 'loanGrowth') {
    return context.priorMarketMetrics;
  }
  if (['revenue', 'earnings', 'takeRate', 'earningsMargin'].includes(metric.key)) {
    return context.priorApiMetrics;
  }
  return context.priorFundamentalsMetrics;
}

function scorecardPeriodDelta(metric, protocolId, context) {
  const current = context.currentMetrics.get(protocolId)?.[metric.key];
  const prior = scorecardPriorMetrics(metric, context).get(protocolId)?.[metric.key];
  if (current === null || current === undefined || prior === null || prior === undefined) return null;
  return current - prior;
}

function scorecardHeroGrowth(metric, protocolId, context) {
  const current = context.currentMetrics.get(protocolId)?.[metric.key];
  const prior = scorecardPriorMetrics(metric, context).get(protocolId)?.[metric.key];
  if (current === null || current === undefined || prior === null || prior === undefined) return null;
  if (metric.key === 'marketShare') return current - prior;
  return prior === 0 ? null : (current - prior) / Math.abs(prior);
}

function scorecardMarketGrowth(context) {
  const current = sumAvailable([...context.currentMetrics.values()], (metrics) => metrics.activeLoans);
  const prior = sumAvailable([...context.priorMarketMetrics.values()], (metrics) => metrics.activeLoans);
  return relativeDelta(current, prior);
}

function scorecardFormatHeroGrowth(value, metric) {
  if (value === null || value === undefined) return '--';
  return metric.key === 'marketShare'
    ? scorecardFormatDelta(value, metric)
    : formatPercent(value, 1, true);
}

function scorecardRankDetails(metric, protocolId, metrics) {
  const ranked = [...metrics.entries()]
    .map(([id, values]) => ({ id, value: values[metric.key] }))
    .filter((item) => item.value !== null && item.value !== undefined)
    .sort((a, b) => metric.higherIsBetter ? b.value - a.value : a.value - b.value);
  const index = ranked.findIndex((item) => item.id === protocolId);
  return index === -1 ? null : { position: index + 1, total: ranked.length };
}

function scorecardRankChange(metric, protocolId, context) {
  const current = scorecardRankDetails(metric, protocolId, context.currentMetrics);
  const prior = scorecardRankDetails(metric, protocolId, scorecardPriorMetrics(metric, context));
  if (!current || !prior) return null;
  return prior.position - current.position;
}

function scorecardHeroTrend(metricKey, protocolId, days) {
  const endDate = state.fundamentalsDate || [...new Set(state.marketShareHistory.map((row) => row.date))].sort().at(-1);
  const endSnapshot = findMarketShareSnapshot(endDate);
  const trendEndDate = endSnapshot?.date || endDate;
  const baselineSnapshot = findMarketShareSnapshot(dateDaysAgo(trendEndDate, days));
  const cutoff = dateDaysAgo(trendEndDate, days);
  const dates = [...new Set(state.marketShareHistory.map((row) => row.date))]
    .filter((date) => date && date >= cutoff && date <= trendEndDate)
    .sort();
  return dates.map((date) => {
    const currentSnapshot = findMarketShareSnapshot(date);
    const currentRow = currentSnapshot?.rowsByProtocol.get(protocolId);
    const baselineRow = baselineSnapshot?.rowsByProtocol.get(protocolId);
    if (!currentRow || !baselineRow) return null;
    if (metricKey === 'loanGrowth') {
      return { date, value: baselineRow.activeLoans > 0 ? (currentRow.activeLoans - baselineRow.activeLoans) / baselineRow.activeLoans : null };
    }
    const currentShare = snapshotMarketShare(currentRow, currentSnapshot);
    const baselineShare = snapshotMarketShare(baselineRow, baselineSnapshot);
    return { date, value: currentShare === null || baselineShare === null ? null : currentShare - baselineShare };
  }).filter((point) => point?.value !== null && point?.value !== undefined);
}

function formatScorecardHeroAxisValue(value, metricKey) {
  const signed = value > 0 ? '+' : '';
  return metricKey === 'marketShare'
    ? `${signed}${(value * 100).toFixed(0)} pp`
    : `${signed}${(value * 100).toFixed(0)}%`;
}

function formatScorecardHeroDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function renderScorecardHeroSparkline(metricKey, protocolId, days) {
  const wrapper = document.createElement('div');
  wrapper.className = 'scorecard-hero-sparkline';
  const points = scorecardHeroTrend(metricKey, protocolId, days);
  if (points.length === 0) {
    wrapper.className += ' is-empty';
    wrapper.textContent = 'Trend unavailable';
    return wrapper;
  }
  const latestValue = points.at(-1).value;
  wrapper.classList.add(latestValue > 0 ? 'is-positive' : latestValue < 0 ? 'is-negative' : 'is-neutral');

  const maximum = Math.max(...points.map((point) => Math.abs(point.value)), metricKey === 'marketShare' ? 0.01 : 0.1);
  const domain = metricKey === 'marketShare'
    ? Math.ceil(maximum * 100) / 100
    : Math.ceil(maximum * 10) / 10;
  const yLabels = document.createElement('div');
  yLabels.className = 'scorecard-hero-sparkline-axis';
  for (const value of [domain, 0, -domain]) {
    const label = document.createElement('span');
    label.textContent = formatScorecardHeroAxisValue(value, metricKey);
    yLabels.appendChild(label);
  }

  const chart = document.createElement('div');
  chart.className = 'scorecard-hero-sparkline-chart';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 72');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const y of [0, 36, 72]) {
    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gridLine.setAttribute('x1', '0');
    gridLine.setAttribute('x2', '300');
    gridLine.setAttribute('y1', String(y));
    gridLine.setAttribute('y2', String(y));
    gridLine.setAttribute('class', 'scorecard-hero-sparkline-grid');
    svg.appendChild(gridLine);
  }
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 150 : (index / (points.length - 1)) * 300;
    const y = 36 - ((point.value / domain) * 36);
    return `${x},${Math.max(0, Math.min(72, y))}`;
  });
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('points', `0,36 ${coordinates.join(' ')} 300,36`);
  area.setAttribute('class', 'scorecard-hero-sparkline-area');
  svg.appendChild(area);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', coordinates.join(' '));
  line.setAttribute('class', 'scorecard-hero-sparkline-line');
  svg.appendChild(line);
  chart.appendChild(svg);

  const dates = document.createElement('div');
  dates.className = 'scorecard-hero-sparkline-dates';
  const firstDate = document.createElement('span');
  firstDate.textContent = formatScorecardHeroDate(points[0].date);
  const lastDate = document.createElement('span');
  lastDate.textContent = formatScorecardHeroDate(points.at(-1).date);
  dates.append(firstDate, lastDate);
  chart.appendChild(dates);

  wrapper.append(yLabels, chart);
  return wrapper;
}

function renderScorecardHero(context) {
  if (!els.scorecardHero) return;
  els.scorecardHero.replaceChildren();

  if (state.fundamentals.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scorecard-empty';
    empty.textContent = 'Scorecard data unavailable.';
    els.scorecardHero.appendChild(empty);
    return;
  }

  const heroRankMetric = { key: 'growth', higherIsBetter: true };
  const heroGrowthMetrics = new Map([...context.currentMetrics.keys()].map((protocolId) => [protocolId, {
    activeLoanGrowth: context.currentMetrics.get(protocolId)?.loanGrowth ?? null,
    marketShareGrowth: scorecardHeroGrowth(SCORECARD_METRICS.find((metric) => metric.key === 'marketShare'), protocolId, context),
  }]));
  const days = SCORECARD_TIMEFRAMES[state.scorecardTimeframe];
  for (const metric of SCORECARD_HERO_METRICS) {
    const card = document.createElement('article');
    card.className = 'scorecard-hero-metric';

    const copy = document.createElement('div');
    copy.className = 'scorecard-hero-copy';
    const label = document.createElement('p');
    label.className = 'eyebrow';
    label.textContent = metric.label;
    copy.appendChild(label);

    const value = document.createElement('strong');
    value.className = 'scorecard-hero-value';
    const growthKey = metric.key === 'loanGrowth' ? 'activeLoanGrowth' : 'marketShareGrowth';
    const growthValue = heroGrowthMetrics.get(state.scorecardProtocolId)?.[growthKey];
    value.textContent = scorecardFormatHeroGrowth(growthValue, metric);
    copy.appendChild(value);

    const meta = document.createElement('div');
    meta.className = 'scorecard-hero-meta';

    const rank = scorecardRankDetails({ ...heroRankMetric, key: growthKey }, state.scorecardProtocolId, heroGrowthMetrics);
    const rankLabel = document.createElement('span');
    rankLabel.textContent = rank ? `Rank ${rank.position} / ${rank.total}` : 'Rank --';
    meta.appendChild(rankLabel);

    const periodDelta = growthValue;
    const deltaLabel = document.createElement('span');
    deltaLabel.className = deltaClass(periodDelta);
    const formattedDelta = metric.key === 'marketShare'
      ? scorecardFormatDelta(periodDelta, metric)
      : formatPercent(periodDelta, 1, true);
    deltaLabel.textContent = `Period delta ${formattedDelta}`;
    meta.appendChild(deltaLabel);
    copy.appendChild(meta);

    card.append(copy, renderScorecardHeroSparkline(metric.key, state.scorecardProtocolId, days));
    els.scorecardHero.appendChild(card);
  }

  const marketGrowth = scorecardMarketGrowth(context);
  const marketCard = document.createElement('article');
  marketCard.className = 'scorecard-hero-metric scorecard-hero-market-metric';
  const marketCopy = document.createElement('div');
  const marketLabel = document.createElement('p');
  marketLabel.className = 'eyebrow';
  marketLabel.textContent = 'Market Growth';
  marketCopy.appendChild(marketLabel);
  const marketValue = document.createElement('strong');
  marketValue.className = 'scorecard-hero-value';
  marketValue.textContent = formatPercent(marketGrowth, 1, true);
  marketCopy.appendChild(marketValue);
  const marketMeta = document.createElement('div');
  marketMeta.className = 'scorecard-hero-meta';
  const marketScope = document.createElement('span');
  marketScope.textContent = `All ${context.currentMetrics.size} protocols | Period change`;
  marketMeta.appendChild(marketScope);
  marketCopy.appendChild(marketMeta);
  marketCard.appendChild(marketCopy);
  els.scorecardHero.appendChild(marketCard);
}

function scorecardNormalizedValue(value, values) {
  if (value === null || value === undefined) return null;
  const comparable = values.filter((item) => item !== null && item !== undefined);
  if (comparable.length === 0) return null;
  const minimum = Math.min(...comparable);
  const maximum = Math.max(...comparable);
  return minimum === maximum ? 50 : ((value - minimum) / (maximum - minimum)) * 100;
}

function renderScorecardChart(scorecardRows, context, selectedName) {
  if (!els.scorecardChart) return;
  disposeScorecardChart();
  els.scorecardChart.replaceChildren();
  const chartMetrics = scorecardRows
    .filter((row) => SCORECARD_BENCHMARK_KEYS.has(row.metric.key) && row.protocolValue !== null && row.sectorMedian !== null)
    .map((row) => ({
      ...row,
      values: [...context.currentMetrics.values()]
        .map((metrics) => metrics[row.metric.key])
        .filter((value) => value !== null && value !== undefined),
    }))
    .filter((row) => row.values.length > 0);

  if (chartMetrics.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Benchmark data unavailable for the selected timeframe.';
    els.scorecardChart.appendChild(empty);
    return;
  }

  if (!window.echarts) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Could not load the ECharts library.';
    els.scorecardChart.appendChild(empty);
    return;
  }

  const colors = chartColors();
  els.scorecardChart.setAttribute('aria-label', `Horizontal benchmark bars comparing ${selectedName} with the sector median across scale, price, and capture. Values are normalized within the direct-competitor cohort.`);
  scorecardChart = window.echarts.init(els.scorecardChart, null, { renderer: 'canvas' });
  scorecardChart.setOption({
    animation: false,
    grid: { top: 42, right: 16, bottom: 38, left: 8, containLabel: true },
    legend: {
      top: 2,
      left: 18,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: colors.muted, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: false,
      appendToBody: true,
      formatter: (params) => {
        const metric = chartMetrics[params[0]?.dataIndex];
        return [
          metric.metric.label,
          ...params.map((item) => `${item.marker}${item.seriesName}: ${scorecardFormatValue(item.data.raw, metric.metric)}`),
          'Values normalized within the cohort',
        ].join('<br>');
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      axisLine: { lineStyle: { color: colors.chartAxis } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, formatter: '{value}' },
      splitLine: { lineStyle: { color: colors.chartGrid } },
      name: 'NORMALIZED WITHIN COHORT',
      nameLocation: 'end',
      nameGap: 28,
      nameTextStyle: { color: colors.muted2, fontSize: 9, fontWeight: 700, letterSpacing: 0.8 },
    },
    yAxis: {
      type: 'category',
      data: chartMetrics.map((row) => row.metric.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 11 },
    },
    series: [
      {
        name: selectedName,
        type: 'bar',
        barMaxWidth: 15,
        data: chartMetrics.map((row) => ({ value: scorecardNormalizedValue(row.protocolValue, row.values), raw: row.protocolValue })),
        itemStyle: { color: colors.accent, borderRadius: [0, 3, 3, 0] },
      },
      {
        name: 'Sector median',
        type: 'bar',
        barMaxWidth: 15,
        data: chartMetrics.map((row) => ({ value: scorecardNormalizedValue(row.sectorMedian, row.values), raw: row.sectorMedian })),
        itemStyle: { color: colors.chartMedian, borderRadius: [0, 3, 3, 0] },
      },
    ],
  });
}

function monthKey(value) {
  return value?.slice(0, 7) || null;
}

function monthDate(value) {
  const date = new Date(`${value}-01T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDriverValue(value, type) {
  return type === 'usd' ? formatUsd(value) : formatPercent(value, 1);
}

function ordinal(value) {
  const suffix = value % 100 >= 11 && value % 100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
  return `${value}${suffix}`;
}

function monthlyScaleHistory() {
  const groups = new Map();
  for (const row of state.marketShareHistory) {
    const month = monthKey(row.date);
    if (!month || row.activeLoans === null) continue;
    const key = `${month}|${row.id}`;
    const group = groups.get(key) || { month, id: row.id, total: 0, count: 0 };
    group.total += row.activeLoans;
    group.count += 1;
    groups.set(key, group);
  }

  const months = new Map();
  for (const group of groups.values()) {
    if (!months.has(group.month)) months.set(group.month, new Map());
    months.get(group.month).set(group.id, group.total / group.count);
  }
  return months;
}

function monthlyDriverHistory() {
  const groups = new Map();
  for (const row of state.scorecardDriverHistory) {
    const month = monthKey(row.date);
    if (!month) continue;
    const key = `${month}|${row.id}`;
    const group = groups.get(key) || { month, id: row.id, borrowInterest: 0, averageActiveLoans: 0, grossProfit: 0 };
    group.borrowInterest += row.borrowInterest || 0;
    group.averageActiveLoans += row.averageActiveLoans || 0;
    group.grossProfit += row.grossProfit || 0;
    groups.set(key, group);
  }

  const months = new Map();
  for (const group of groups.values()) {
    if (!months.has(group.month)) months.set(group.month, new Map());
    months.get(group.month).set(group.id, {
      borrowInterest: group.borrowInterest,
      averageActiveLoans: group.averageActiveLoans,
      grossProfit: group.grossProfit,
    });
  }
  return months;
}

function renderScorecardBorrowShareChart(selectedId, selectedName) {
  if (!els.scorecardBorrowShareChart) return;
  disposeScorecardBorrowShareChart();
  els.scorecardBorrowShareChart.replaceChildren();

  const protocolIds = state.fundamentals.map((row) => row.id);
  const latestMarketDate = findMarketShareSnapshot(state.fundamentalsDate)?.date
    || [...new Set(state.marketShareHistory.map((row) => row.date).filter(Boolean))].sort().at(-1);
  const cutoffDate = dateDaysAgo(latestMarketDate, SCORECARD_TIMEFRAMES[state.scorecardTimeframe]);
  const rowsByDate = new Map();
  for (const row of state.marketShareHistory) {
    if (!row.date || row.date < cutoffDate || row.date > latestMarketDate || !protocolIds.includes(row.id)) continue;
    if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, new Map());
    rowsByDate.get(row.date).set(row.id, row);
  }
  const snapshots = [...rowsByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, rows]) => {
      const totalActiveLoans = protocolIds.reduce((sum, id) => sum + Math.max(0, rows.get(id)?.activeLoans || 0), 0);
      if (totalActiveLoans <= 0) return null;
      return {
        date,
        totalActiveLoans,
        shares: new Map(protocolIds.map((id) => [id, Math.max(0, rows.get(id)?.activeLoans || 0) / totalActiveLoans])),
      };
    })
    .filter(Boolean);

  if (snapshots.length === 0 || protocolIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Borrow-share history unavailable.';
    els.scorecardBorrowShareChart.appendChild(empty);
    return;
  }

  if (!window.echarts) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Could not load the ECharts library.';
    els.scorecardBorrowShareChart.appendChild(empty);
    return;
  }

  const colors = chartColors();
  const orderedProtocolIds = protocolIds
    .filter((id) => id !== selectedId)
    .concat(protocolIds.includes(selectedId) ? [selectedId] : []);
  const series = orderedProtocolIds.map((id) => {
    const selected = id === selectedId;
    const protocolColor = scorecardProtocolColors[id] || colors.accent;
    return {
      name: fundamentalsProtocolNames[id] || id,
      type: 'line',
      stack: 'borrow-share',
      smooth: 0.12,
      showSymbol: false,
      symbol: 'none',
      connectNulls: false,
      z: selected ? 10 : 2,
      emphasis: { focus: 'series' },
      lineStyle: { color: protocolColor, width: selected ? 2.2 : 0.8, opacity: selected ? 1 : 0.9 },
      areaStyle: { color: protocolColor, opacity: selected ? 0.9 : 0.58 },
      itemStyle: { color: protocolColor },
      data: snapshots.map((snapshot) => [snapshot.date, snapshot.shares.get(id) || 0]),
    };
  });

  els.scorecardBorrowShareChart.setAttribute('aria-label', `100 percent normalized stacked area chart of share of borrows by protocol, with ${selectedName} highlighted.`);
  scorecardBorrowShareChart = window.echarts.init(els.scorecardBorrowShareChart, null, { renderer: 'canvas' });
  scorecardBorrowShareChart.setOption({
    animation: false,
    legend: {
      type: 'scroll',
      orient: 'horizontal',
      top: 4,
      height: 22,
      left: 12,
      right: 12,
      itemWidth: 10,
      itemHeight: 7,
      textStyle: { color: colors.muted, fontSize: 10 },
    },
    grid: { top: 56, right: 14, bottom: 54, left: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      formatter: (params) => {
        const date = params[0]?.axisValue;
        const snapshot = snapshots.find((item) => item.date === date);
        return [
          formatSnapshotDate(date),
          `Total borrowed TVL: ${formatUsd(snapshot?.totalActiveLoans)}`,
          ...params
            .filter((item) => item.value?.[1] !== null && item.value?.[1] !== undefined)
            .sort((a, b) => b.value[1] - a.value[1])
            .map((item) => `${item.marker}${item.seriesName}: ${formatPercent(item.value[1], 1)}`),
        ].join('<br>');
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: snapshots.map((snapshot) => snapshot.date),
      axisLine: { lineStyle: { color: colors.chartAxis } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, fontSize: 10, formatter: (value) => formatSnapshotDate(value), hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      interval: 0.25,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, fontSize: 10, formatter: (value) => formatPercent(value, 0) },
      splitLine: { lineStyle: { color: colors.chartGrid } },
      name: 'SHARE OF TOTAL BORROWS',
      nameLocation: 'end',
      nameGap: 16,
      nameTextStyle: { color: colors.muted2, fontSize: 10, fontWeight: 700, letterSpacing: 1 },
    },
    series,
  });
}

function trailingDriverHistory(months, metric, days, scaleHistory = null) {
  const sortedMonths = [...months.keys()].sort();
  const output = new Map();
  for (const month of sortedMonths) {
    const end = monthDate(month);
    if (!end) continue;
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (metric === 'price' || metric === 'capture' ? 92 : days));
    const trailing = sortedMonths.filter((candidate) => {
      const date = monthDate(candidate);
      return date && date >= start && date <= end;
    });
    const values = new Map();
    const ids = new Set(trailing.flatMap((candidate) => [...(months.get(candidate)?.keys() || [])]));
    for (const id of ids) {
      if (metric === 'scale') {
        values.set(id, months.get(month)?.get(id) ?? null);
        continue;
      }
      const rows = trailing.map((candidate) => months.get(candidate)?.get(id)).filter(Boolean);
      const borrowInterest = rows.reduce((sum, row) => sum + row.borrowInterest, 0);
      const averageActiveLoans = trailing
        .map((candidate) => scaleHistory?.get(candidate)?.get(id))
        .filter((value) => value !== null && value !== undefined)
        .reduce((sum, value) => sum + value, 0);
      const grossProfit = rows.reduce((sum, row) => sum + row.grossProfit, 0);
      values.set(id, metric === 'price'
        ? (borrowInterest > 0 && averageActiveLoans > 0 ? (borrowInterest / averageActiveLoans) * 12 : null)
        : (borrowInterest > 0 ? grossProfit / borrowInterest : null));
    }
    output.set(month, values);
  }
  return output;
}

function renderScorecardDriverChart(metric, history, protocolIds, selectedId, selectedName) {
  const config = SCORECARD_DRIVER_CONFIG[metric];
  const suffix = metric[0].toUpperCase() + metric.slice(1);
  const chartElement = els[`scorecard${suffix}Chart`];
  const currentElement = els[`scorecard${suffix}Current`];
  const rankElement = els[`scorecard${suffix}Rank`];
  if (!chartElement || !currentElement || !rankElement) return;
  chartElement.replaceChildren();
  currentElement.textContent = '';
  rankElement.textContent = '';

  const availableMonths = [...history.keys()].sort();
  const latestMonth = availableMonths.at(-1);
  const latestDate = monthDate(latestMonth);
  const cutoff = latestDate ? new Date(latestDate) : null;
  cutoff?.setUTCDate(cutoff.getUTCDate() - SCORECARD_TIMEFRAMES[state.scorecardTimeframe]);
  const months = availableMonths.filter((month) => {
    const date = monthDate(month);
    return date && (!cutoff || date >= cutoff);
  });
  const hasData = months.some((month) => [...(history.get(month)?.values() || [])].some((value) => value !== null));

  if (!hasData) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = config.empty;
    chartElement.appendChild(empty);
    return;
  }

  const latestValue = history.get(latestMonth)?.get(selectedId);
  currentElement.textContent = latestValue === null || latestValue === undefined ? '' : formatDriverValue(latestValue, config.type);
  const rankedProtocols = protocolIds
    .map((id) => ({ id, value: history.get(latestMonth)?.get(id) }))
    .filter((row) => row.value !== null && row.value !== undefined)
    .sort((a, b) => b.value - a.value);
  const rank = rankedProtocols.findIndex((row) => row.id === selectedId);
  rankElement.textContent = rank === -1 ? '' : ordinal(rank + 1);
  if (!window.echarts) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Could not load the ECharts library.';
    chartElement.appendChild(empty);
    return;
  }

  const colors = {
    ...chartColors(),
    ...(document.documentElement.dataset.theme === 'dark'
      ? {
        accent: '#0f67d5',
        muted: '#697386',
        muted2: '#8a94a6',
        chartGrid: 'rgba(116, 128, 151, 0.16)',
        chartAxis: '#c4ccd9',
      }
      : {}),
    chartMedian: '#9ccff3',
  };
  const peerColor = colors.chartAxis;
  const valuesByMonth = months.map((month) => {
    const values = [...(history.get(month)?.values() || [])].filter((value) => value !== null);
    return { month, median: median(values) };
  });
  const series = protocolIds.map((id) => ({
    name: fundamentalsProtocolNames[id] || id,
    type: 'line',
    showSymbol: false,
    connectNulls: false,
    z: id === selectedId ? 5 : 2,
    emphasis: { focus: 'series' },
    lineStyle: {
      color: id === selectedId ? colors.accent : peerColor,
      width: id === selectedId ? 2.8 : 1.1,
      opacity: id === selectedId ? 1 : 0.42,
    },
    itemStyle: { color: id === selectedId ? colors.accent : peerColor },
    data: months.map((month) => [month, history.get(month)?.get(id) ?? null]),
  }));
  series.push({
    name: 'Cohort median',
    type: 'line',
    showSymbol: false,
    data: valuesByMonth.map(({ month, median: value }) => [month, value]),
    lineStyle: { color: colors.chartMedian, width: 1, type: 'dashed' },
    itemStyle: { color: colors.chartMedian },
    z: 3,
  });

  chartElement.setAttribute('aria-label', `${config.label} history for ${selectedName} and the direct-competitor cohort.`);
  scorecardDriverCharts[metric] = window.echarts.init(chartElement, null, { renderer: 'canvas' });
  scorecardDriverCharts[metric].setOption({
    animation: false,
    legend: {
      type: 'scroll',
      top: 0,
      left: 12,
      right: 12,
      itemWidth: 9,
      itemHeight: 6,
      textStyle: { color: colors.muted, fontSize: 9 },
    },
    grid: { top: 30, right: 12, bottom: 30, left: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      formatter: (params) => [
        formatSnapshotMonth(`${params[0]?.axisValue}-01`),
        ...params
          .filter((item) => item.value?.[1] !== null && item.value?.[1] !== undefined)
          .sort((a, b) => b.value[1] - a.value[1])
          .map((item) => `${item.marker}${item.seriesName}: ${formatDriverValue(item.value[1], config.type)}`),
      ].join('<br>'),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: months,
      axisLine: { lineStyle: { color: colors.chartAxis } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, fontSize: 10, formatter: (value) => value.slice(2) },
    },
    yAxis: {
      type: 'value',
      min: (value) => value.min >= 0 ? 0 : undefined,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, fontSize: 10, formatter: (value) => config.type === 'usd' ? formatUsd(value) : `${(value * 100).toFixed(0)}%` },
      splitLine: { lineStyle: { color: colors.chartGrid } },
    },
    series,
  });
}

function renderScorecardDriverCharts() {
  disposeScorecardDriverCharts();
  const protocolIds = state.fundamentals.map((row) => row.id);
  const selected = state.fundamentals.find((row) => row.id === state.scorecardProtocolId);
  const selectedName = selected?.name || state.scorecardProtocolId || 'selected protocol';
  const scaleHistory = monthlyScaleHistory();
  const scale = trailingDriverHistory(scaleHistory, 'scale', SCORECARD_TIMEFRAMES[state.scorecardTimeframe]);
  const driverRows = monthlyDriverHistory();
  const price = trailingDriverHistory(driverRows, 'price', SCORECARD_TIMEFRAMES[state.scorecardTimeframe], scaleHistory);
  const capture = trailingDriverHistory(driverRows, 'capture', SCORECARD_TIMEFRAMES[state.scorecardTimeframe]);
  renderScorecardDriverChart('scale', scale, protocolIds, state.scorecardProtocolId, selectedName);
  renderScorecardDriverChart('price', price, protocolIds, state.scorecardProtocolId, selectedName);
  renderScorecardDriverChart('capture', capture, protocolIds, state.scorecardProtocolId, selectedName);
}

function renderScorecardProtocolOptions() {
  if (!els.scorecardProtocol) return;
  els.scorecardProtocol.replaceChildren();
  for (const fundamental of state.fundamentals) {
    const option = document.createElement('option');
    option.value = fundamental.id;
    option.textContent = fundamental.name;
    els.scorecardProtocol.appendChild(option);
  }
}

function renderScorecard() {
  if (!els.scorecardProtocol) return;
  disposeScorecardChart();
  disposeScorecardBorrowShareChart();
  disposeScorecardDriverCharts();
  els.scorecardHero?.replaceChildren();
  renderScorecardProtocolOptions();

  if (state.fundamentals.length === 0) {
    els.scorecardContext?.replaceChildren();
    renderScorecardHero({ currentMetrics: new Map() });
    els.scorecardBorrowShareChart?.replaceChildren();
    els.scorecardChart?.replaceChildren();
    renderScorecardDriverCharts();
    return;
  }

  const protocolIds = state.fundamentals.map((row) => row.id);
  if (!state.scorecardProtocolId) state.scorecardProtocolId = readSelectedProtocol();
  if (!protocolIds.includes(state.scorecardProtocolId)) state.scorecardProtocolId = protocolIds[0];
  publishSelectedProtocol(state.scorecardProtocolId);
  els.scorecardProtocol.value = state.scorecardProtocolId;
  els.scorecardTimeframe.value = state.scorecardTimeframe;

  const days = SCORECARD_TIMEFRAMES[state.scorecardTimeframe];
  const currentFundamentals = findFundamentalsSnapshot(state.fundamentalsDate);
  const currentMarket = findMarketShareSnapshot(state.fundamentalsDate);
  const marketDate = currentMarket?.date || state.fundamentalsDate;
  const priorMarket = findMarketShareSnapshot(dateDaysAgo(marketDate, days));
  const priorPriorMarket = findMarketShareSnapshot(dateDaysAgo(marketDate, days * 2));
  const priorFundamentals = findFundamentalsSnapshot(dateDaysAgo(state.fundamentalsDate, days));
  const currentMetrics = scorecardMetricsFor(currentFundamentals, currentMarket, priorMarket);
  const priorMarketMetrics = scorecardMetricsFor(currentFundamentals, priorMarket, priorPriorMarket);
  const priorFundamentalsMetrics = scorecardMetricsFor(priorFundamentals, priorMarket, priorPriorMarket);
  const priorApiMetrics = scorecardApiMetrics();
  const context = { currentMetrics, priorMarketMetrics, priorFundamentalsMetrics, priorApiMetrics };
  const selected = state.fundamentals.find((row) => row.id === state.scorecardProtocolId);
  const selectedName = selected?.name || state.scorecardProtocolId;

  if (els.scorecardContext) {
    els.scorecardContext.textContent = `${selectedName} | ${state.scorecardTimeframe} | ${protocolIds.length} direct competitors`;
  }
  renderScorecardHero(context);
  renderScorecardBorrowShareChart(state.scorecardProtocolId, selectedName);
  const grossBorrowYieldMetrics = scorecardGrossBorrowYieldMetrics();
  const benchmarkMetrics = new Map([...currentMetrics.entries()].map(([protocolId, values]) => [protocolId, {
    ...values,
    grossBorrowYield: grossBorrowYieldMetrics.get(protocolId),
  }]));
  const benchmarkContext = { ...context, currentMetrics: benchmarkMetrics };
  renderScorecardChart(SCORECARD_BENCHMARK_METRICS.map((metric) => ({
    metric,
    protocolValue: benchmarkMetrics.get(state.scorecardProtocolId)?.[metric.key] ?? null,
    sectorMedian: median([...benchmarkMetrics.values()].map((values) => values[metric.key])),
  })), benchmarkContext, selectedName);
  renderScorecardDriverCharts();
}

function renderMarketUtilization() {
  if (!els.marketUtilizationChart) return;
  disposeMarketUtilizationChart();
  els.marketUtilizationChart.replaceChildren();

  const latestDate = [...new Set(state.marketUtilizationHistory.map((row) => row.date).filter(Boolean))].sort().at(-1);
  const cutoffDate = dateDaysAgo(latestDate, 730);
  const snapshots = state.marketUtilizationHistory
    .filter((row) => row.date && row.date >= cutoffDate && row.utilization !== null && row.utilization >= 0);
  if (snapshots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Market utilization history unavailable.';
    els.marketUtilizationChart.appendChild(empty);
    return;
  }

  if (!window.echarts) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Could not load the ECharts library.';
    els.marketUtilizationChart.appendChild(empty);
    return;
  }

  const colors = chartColors();
  const snapshotsByDate = new Map(snapshots.map((snapshot) => [snapshot.date, snapshot]));
  els.marketUtilizationChart.setAttribute('aria-label', 'Daily aggregate borrow utilization, calculated as total borrowed TVL divided by total protocol TVL across lending venues.');
  marketUtilizationChart = window.echarts.init(els.marketUtilizationChart, null, { renderer: 'canvas' });
  marketUtilizationChart.setOption({
    animation: false,
    grid: { top: 18, right: 26, bottom: 54, left: 18, containLabel: true },
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      formatter: (params) => {
        const date = params[0]?.axisValue;
        const snapshot = snapshotsByDate.get(date);
        return [
          formatSnapshotDate(date),
          `Utilization: ${formatPercent(snapshot?.utilization, 1)}`,
          `Borrowed TVL: ${formatUsd(snapshot?.totalActiveLoans)}`,
          `Total TVL: ${formatUsd(snapshot?.totalTvl)}`,
          `Coverage: ${snapshot?.borrowedVenues || 0} borrowed / ${snapshot?.tvlVenues || 0} TVL venues`,
        ].join('<br>');
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: snapshots.map((snapshot) => snapshot.date),
      axisLine: { lineStyle: { color: colors.chartAxis } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, fontSize: 10, formatter: (value) => formatSnapshotDate(value), hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: (value) => Math.max(1, Math.ceil(value.max * 10) / 10),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.muted2, fontSize: 10, formatter: (value) => formatPercent(value, 0) },
      splitLine: { lineStyle: { color: colors.chartGrid } },
      name: 'BORROWED TVL / TOTAL TVL',
      nameLocation: 'end',
      nameGap: 16,
      nameTextStyle: { color: colors.muted2, fontSize: 10, fontWeight: 700, letterSpacing: 1 },
    },
    series: [{
      name: 'Borrow utilization',
      type: 'line',
      showSymbol: false,
      connectNulls: false,
      smooth: 0.12,
      lineStyle: { color: colors.accent, width: 2 },
      itemStyle: { color: colors.accent },
      data: snapshots.map((snapshot) => [snapshot.date, snapshot.utilization]),
    }],
  });
}

function renderMarketShare() {
  if (!els.marketShareChart) return;
  disposeMarketShareChart();
  els.marketShareChart.replaceChildren();
  els.marketShareNote.hidden = true;

  const renderEmpty = (message) => {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = message;
    els.marketShareChart.appendChild(empty);
  };
  const savedHistory = state.marketShareHistory.filter((row) => row.date && row.activeLoans > 0);
  const fallbackHistory = state.fundamentalsHistory.filter((row) => row.date && row.activeLoans > 0);
  const history = savedHistory.length > 0 ? savedHistory : fallbackHistory;

  if (history.length === 0) {
    renderEmpty('Active loan history unavailable.');
    return;
  }

  if (!window.echarts) {
    renderEmpty('Could not load the ECharts library.');
    return;
  }

  const protocolRows = new Map();
  for (const row of history) {
    if (!protocolRows.has(row.id)) protocolRows.set(row.id, row);
  }
  const latestByProtocol = new Map(state.fundamentals.map((row) => [row.id, row]));
  const historicalByProtocol = new Map(state.fundamentalsHistory.map((row) => [row.id, row]));
  const protocolIds = [...protocolRows.keys()].sort((a, b) => {
    const activeLoansA = latestByProtocol.get(a)?.activeLoans || protocolRows.get(a)?.activeLoans || 0;
    const activeLoansB = latestByProtocol.get(b)?.activeLoans || protocolRows.get(b)?.activeLoans || 0;
    return activeLoansB - activeLoansA;
  });
  const dates = [...new Set(history.map((row) => row.date))].sort();
  const snapshots = dates
    .map((date) => {
      const rowsByProtocol = new Map(history.filter((row) => row.date === date).map((row) => [row.id, row]));
      const totalActiveLoans = [...rowsByProtocol.values()].reduce((sum, row) => sum + row.activeLoans, 0);
      return { date, rowsByProtocol, totalActiveLoans };
    })
    .filter((snapshot) => snapshot.totalActiveLoans > 0);
  const theme = chartColors();
  const colors = protocolIds.map((id) => takeTypeColors[latestByProtocol.get(id)?.takeType || historicalByProtocol.get(id)?.takeType || protocolRows.get(id).takeType] || theme.accent);

  marketShareChart = window.echarts.init(els.marketShareChart, null, { renderer: 'canvas' });
  marketShareChart.setOption({
    animation: false,
    color: colors,
    legend: {
      type: 'scroll',
      top: 4,
      left: 76,
      right: 28,
      itemWidth: 10,
      itemHeight: 8,
      pageIconColor: theme.accent,
      pageTextStyle: { color: theme.muted2 },
      textStyle: { color: theme.muted, fontSize: 11 },
    },
    grid: { top: 52, right: 32, bottom: 64, left: 76, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: theme.chartAxis } },
      formatter: (params) => {
        const date = params[0]?.axisValue;
        const snapshot = snapshots.find((item) => item.date === date);
        const lines = params
          .filter((item) => item.value > 0)
          .sort((a, b) => b.value - a.value)
          .map((item) => `${item.marker}${item.seriesName}: ${formatPercent(item.value, 1)}`);
        return [`${formatSnapshotMonth(date)} | Total: ${formatUsd(snapshot?.totalActiveLoans || 0)}`, ...lines].join('<br>');
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: snapshots.map((snapshot) => snapshot.date),
      axisLine: { lineStyle: { color: theme.chartAxis } },
      axisTick: { show: false },
      axisLabel: { color: theme.muted2, formatter: (value) => formatSnapshotMonth(value), hideOverlap: true },
      splitLine: { show: false },
      name: 'SNAPSHOT DATE',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: theme.muted2, fontSize: 11, fontWeight: 700, letterSpacing: 1.2 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      interval: 0.25,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.muted2, formatter: (value) => formatPercent(value, 0) },
      splitLine: { lineStyle: { color: theme.chartGrid } },
      name: 'SHARE OF ACTIVE LOANS',
      nameLocation: 'end',
      nameGap: 16,
      nameTextStyle: { color: theme.muted2, fontSize: 11, fontWeight: 700, letterSpacing: 1.2 },
    },
    series: protocolIds.map((id) => ({
      name: fundamentalsProtocolNames[id] || id,
      type: 'line',
      stack: 'active-loan-share',
      smooth: 0.12,
      showSymbol: false,
      symbol: 'none',
      lineStyle: { width: 1 },
      areaStyle: { opacity: 0.82 },
      emphasis: { focus: 'series' },
      data: snapshots.map((snapshot) => {
        const row = snapshot.rowsByProtocol.get(id);
        return row?.marketShare ?? (row ? row.activeLoans / snapshot.totalActiveLoans : 0);
      }),
    })),
  });

  if (snapshots.length < 2) {
    els.marketShareNote.textContent = 'Only one monthly snapshot is currently loaded. Add additional dated rows to data/fundamentals.csv to show market-share movement over time.';
    els.marketShareNote.hidden = false;
  }
}

function appendFundamentalsCell(row, value, className = '', columnKey = '', sortValue = null) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  if (columnKey) cell.dataset.column = columnKey;
  if (sortValue !== null && sortValue !== undefined) cell.dataset.sortValue = String(sortValue);
  cell.textContent = value;
  row.appendChild(cell);
}

function fundamentalsSortValue(row, columnKey) {
  return [...row.children].find((cell) => cell.dataset.column === columnKey)?.dataset.sortValue ?? null;
}

function updateFundamentalsSortIndicators() {
  const table = els.fundamentalsTable?.closest('table');
  if (!table) return;
  table.querySelectorAll('thead th[data-column]').forEach((header) => {
    const active = header.dataset.column === state.fundamentalsSortKey;
    header.setAttribute('aria-sort', active ? state.fundamentalsSortDirection === 'asc' ? 'ascending' : 'descending' : 'none');
  });
}

function applyFundamentalsSort() {
  if (!els.fundamentalsTable || !state.fundamentalsSortKey) {
    updateFundamentalsSortIndicators();
    return;
  }
  const direction = state.fundamentalsSortDirection === 'desc' ? -1 : 1;
  const columnKey = state.fundamentalsSortKey;
  const rows = [...els.fundamentalsTable.rows];
  rows.sort((rowA, rowB) => {
    const valueA = fundamentalsSortValue(rowA, columnKey);
    const valueB = fundamentalsSortValue(rowB, columnKey);
    if (valueA === null && valueB === null) return 0;
    if (valueA === null) return 1;
    if (valueB === null) return -1;
    if (columnKey === 'protocol') return direction * valueA.localeCompare(valueB, undefined, { numeric: true, sensitivity: 'base' });
    return direction * (Number(valueA) - Number(valueB));
  });
  els.fundamentalsTable.append(...rows);
  updateFundamentalsSortIndicators();
}

function dateDaysAgo(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function findMarketShareSnapshot(targetDate) {
  if (!targetDate) return null;
  const date = [...new Set(state.marketShareHistory.map((row) => row.date))]
    .filter((date) => date <= targetDate)
    .sort()
    .at(-1);
  if (!date) return null;

  const rowsByProtocol = new Map(state.marketShareHistory
    .filter((row) => row.date === date)
    .map((row) => [row.id, row]));
  const totalActiveLoans = [...rowsByProtocol.values()].reduce((sum, row) => sum + row.activeLoans, 0);
  return { date, rowsByProtocol, totalActiveLoans };
}

function snapshotMarketShare(row, snapshot) {
  return row?.marketShare ?? (row && snapshot?.totalActiveLoans > 0 ? row.activeLoans / snapshot.totalActiveLoans : null);
}

function formatDeltaUsd(value) {
  if (value === null || value === undefined) return '--';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function deltaClass(value) {
  if (value === null || value === undefined || value === 0) return '';
  return value > 0 ? 'is-positive' : 'is-negative';
}

function renderFundamentals() {
  if (!els.fundamentalsTable) {
    renderScorecard();
    return;
  }
  const snapshotDate = state.fundamentalsDate;
  const currentMarketSnapshot = findMarketShareSnapshot(snapshotDate);
  els.fundamentalsDate.textContent = snapshotDate
    ? `${formatSnapshotMonth(snapshotDate)} snapshot`
    : 'Snapshot unavailable';
  els.fundamentalsSource.textContent = snapshotDate
    ? `As of ${formatSnapshotDate(snapshotDate)} | TTM figures in USD | loan deltas use borrowed TVL`
    : 'Fundamentals unavailable';

  els.fundamentalsTable.replaceChildren();
  const totalActiveLoans = state.fundamentals.reduce((sum, row) => sum + (row.activeLoans || 0), 0);
  for (const fundamental of state.fundamentals) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.dataset.column = 'protocol';
    name.dataset.sortValue = fundamental.name;
    name.textContent = fundamental.name;
    row.appendChild(name);
    appendFundamentalsCell(row, formatUsd(fundamental.activeLoans), '', 'activeLoans', fundamental.activeLoans);
    appendFundamentalsCell(
      row,
      totalActiveLoans > 0 && fundamental.activeLoans !== null ? formatPercent(fundamental.activeLoans / totalActiveLoans, 1) : '--',
      '',
      'loanShare',
      totalActiveLoans > 0 && fundamental.activeLoans !== null ? fundamental.activeLoans / totalActiveLoans : null,
    );
    appendFundamentalsCell(row, formatUsd(fundamental.revenue), '', 'revenue', fundamental.revenue);
    appendFundamentalsCell(row, formatUsd(fundamental.earnings), '', 'earnings', fundamental.earnings);
    appendFundamentalsCell(row, formatPercent(fundamental.takeRate, 2), '', 'takeRate', fundamental.takeRate);
    const currentMarketRow = currentMarketSnapshot?.rowsByProtocol.get(fundamental.id);
    for (const days of [90]) {
      const priorSnapshot = findMarketShareSnapshot(dateDaysAgo(currentMarketSnapshot?.date, days));
      const priorMarketRow = priorSnapshot?.rowsByProtocol.get(fundamental.id);
      const loanDelta = currentMarketRow && priorMarketRow ? currentMarketRow.activeLoans - priorMarketRow.activeLoans : null;
      appendFundamentalsCell(row, formatDeltaUsd(loanDelta), deltaClass(loanDelta), 'loanDelta', loanDelta);
    }
    const priorShareSnapshot = findMarketShareSnapshot(dateDaysAgo(currentMarketSnapshot?.date, 90));
    const priorShare = snapshotMarketShare(priorShareSnapshot?.rowsByProtocol.get(fundamental.id), priorShareSnapshot);
    const currentShare = snapshotMarketShare(currentMarketRow, currentMarketSnapshot);
    const shareDelta = currentShare === null || priorShare === null ? null : currentShare - priorShare;
    appendFundamentalsCell(row, formatPercent(shareDelta, 1, true), deltaClass(shareDelta), 'shareDelta', shareDelta);
    els.fundamentalsTable.appendChild(row);
  }
  applyFundamentalsSort();

  if (els.profitPool) renderProfitPool();
  if (els.scorecardProtocol) renderScorecard();
  if (els.marketShareChart) renderMarketShare();
  if (els.marketUtilizationChart) renderMarketUtilization();
}

function renderFundamentalsError() {
  disposeProfitPoolChart();
  disposeScorecardChart();
  disposeScorecardBorrowShareChart();
  disposeMarketShareChart();
  disposeMarketUtilizationChart();
  if (els.fundamentalsDate) els.fundamentalsDate.textContent = 'Snapshot unavailable';
  if (els.fundamentalsSource) els.fundamentalsSource.textContent = 'Could not load data/fundamentals.csv';
  if (els.profitPool) {
    els.profitPool.replaceChildren();
    const message = document.createElement('div');
    message.className = 'pool-empty';
    message.textContent = 'Could not load the monthly fundamentals snapshot.';
    els.profitPool.appendChild(message);
  }
  if (els.scorecardHero) {
    if (els.scorecardContext) els.scorecardContext.textContent = 'Scorecard unavailable';
    els.scorecardHero.replaceChildren();
    const scorecardMessage = document.createElement('div');
    scorecardMessage.className = 'scorecard-empty';
    scorecardMessage.textContent = 'Could not load the competitive scorecard.';
    els.scorecardHero.appendChild(scorecardMessage);
    els.scorecardBorrowShareChart?.replaceChildren();
    const borrowShareChartMessage = document.createElement('div');
    borrowShareChartMessage.className = 'pool-empty';
    borrowShareChartMessage.textContent = 'Could not load the borrow-share history chart.';
    els.scorecardBorrowShareChart?.appendChild(borrowShareChartMessage);
    els.scorecardChart?.replaceChildren();
    const scorecardChartMessage = document.createElement('div');
    scorecardChartMessage.className = 'pool-empty';
    scorecardChartMessage.textContent = 'Could not load the sector benchmark chart.';
    els.scorecardChart?.appendChild(scorecardChartMessage);
    disposeScorecardDriverCharts();
    [els.scorecardScaleChart, els.scorecardPriceChart, els.scorecardCaptureChart].forEach((element) => element?.replaceChildren());
  }
  if (els.marketShareChart) {
    els.marketShareChart.replaceChildren();
    const marketShareMessage = document.createElement('div');
    marketShareMessage.className = 'pool-empty';
    marketShareMessage.textContent = 'Could not load active loan market-share history.';
    els.marketShareChart.appendChild(marketShareMessage);
    els.marketShareNote.hidden = true;
  }
  if (els.marketUtilizationChart) {
    els.marketUtilizationChart.replaceChildren();
    const utilizationMessage = document.createElement('div');
    utilizationMessage.className = 'pool-empty';
    utilizationMessage.textContent = 'Could not load market utilization history.';
    els.marketUtilizationChart.appendChild(utilizationMessage);
  }
  syncMethodologyHeight();
}

function bindThemeToggle() {
  applyTheme(document.documentElement.dataset.theme, false);
  if (!els.themeToggle) return;
  els.themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

function bindScorecardControls() {
  if (!els.scorecardProtocol || !els.scorecardTimeframe) return;
  els.scorecardProtocol.addEventListener('change', () => {
    state.scorecardProtocolId = els.scorecardProtocol.value;
    publishSelectedProtocol(state.scorecardProtocolId);
    renderScorecard();
  });

  els.scorecardTimeframe.addEventListener('change', () => {
    state.scorecardTimeframe = els.scorecardTimeframe.value;
    renderScorecard();
  });
}

function bindFundamentalsSorting() {
  const table = els.fundamentalsTable?.closest('table');
  if (!table) return;
  table.querySelectorAll('.table-sort[data-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextKey = button.dataset.sortKey;
      if (state.fundamentalsSortKey === nextKey) {
        state.fundamentalsSortDirection = state.fundamentalsSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.fundamentalsSortKey = nextKey;
        state.fundamentalsSortDirection = 'asc';
      }
      applyFundamentalsSort();
    });
  });
}

async function init() {
  try {
    const [fundamentalsResponse, marketShareResponse, lendingVenuesResponse, scorecardDriversResponse, marketUtilizationResponse] = await Promise.all([
      fetch('./data/fundamentals.csv', { cache: 'no-store' }),
      fetch('./data/active-loan-market-share.csv', { cache: 'no-store' }),
      fetch('./data/lending-venue-stats.csv', { cache: 'no-store' }),
      fetch('./data/scorecard-drivers.csv', { cache: 'no-store' }),
      fetch('./data/market-utilization.csv', { cache: 'no-store' }),
    ]);

    if (marketShareResponse.ok) {
      const marketShareRows = parseFundamentalsCsv(await marketShareResponse.text());
      state.marketShareHistory = marketShareRows
        .map((row) => ({
          id: row.protocol,
          date: row.date,
          activeLoans: parseNumber(row.active_loans),
          marketShare: parseNumber(row.market_share),
        }))
        .filter((row) => row.date && row.activeLoans !== null && row.activeLoans > 0);
    }

    if (scorecardDriversResponse.ok) {
      const rows = parseFundamentalsCsv(await scorecardDriversResponse.text());
      state.scorecardDriverHistory = rows
        .map((row) => ({
          id: row.protocol,
          date: row.date,
          borrowInterest: parseNumber(row.borrow_interest_usd),
          averageActiveLoans: parseNumber(row.average_active_loans_usd),
          grossProfit: parseNumber(row.gross_profit_usd),
        }))
        .filter((row) => row.date && row.id);
    }

    if (marketUtilizationResponse.ok) {
      const rows = parseFundamentalsCsv(await marketUtilizationResponse.text());
      state.marketUtilizationHistory = rows
        .map((row) => ({
          date: row.date,
          totalActiveLoans: parseNumber(row.total_active_loans),
          totalTvl: parseNumber(row.total_tvl),
          utilization: parseNumber(row.utilization),
          borrowedVenues: parseNumber(row.borrowed_venues),
          tvlVenues: parseNumber(row.tvl_venues),
        }))
        .filter((row) => row.date && row.totalActiveLoans !== null && row.totalTvl !== null && row.utilization !== null);
    }

    if (lendingVenuesResponse.ok) {
      const rows = parseFundamentalsCsv(await lendingVenuesResponse.text());
      state.allVenueStats = rows.map(deriveLendingVenueStats);
      state.allVenueStatsDate = state.allVenueStats.map((row) => row.date).filter(Boolean).sort().at(-1) || null;
      if (state.allVenueStatsDate) {
        renderMarketSummary();
      } else {
        renderMarketSummaryError();
      }
    } else {
      renderMarketSummaryError();
    }

    if (fundamentalsResponse.ok) {
      const rows = parseFundamentalsCsv(await fundamentalsResponse.text());
      const latestDate = rows.map((row) => row.date).filter(Boolean).sort().at(-1);
      state.fundamentalsDate = latestDate || null;
      state.fundamentalsHistory = rows.map(deriveFundamentals);
      state.fundamentals = state.fundamentalsHistory.filter((row) => row.date === latestDate);
      renderFundamentals();
    } else {
      renderFundamentalsError();
    }

    els.freshness.textContent = state.allVenueStatsDate
      ? `Snapshot ${formatSnapshotDate(state.allVenueStatsDate)}`
      : 'Snapshot unavailable';
  } catch (error) {
    console.error(error);
    els.freshness.textContent = 'Market data unavailable';
    renderMarketSummaryError();
    renderFundamentalsError();
  }
}

bindThemeToggle();
bindScorecardControls();
bindFundamentalsSorting();
init();
