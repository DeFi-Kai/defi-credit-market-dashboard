const state = {
  fundamentals: [],
  fundamentalsHistory: [],
  marketShareHistory: [],
  allVenueStats: [],
  allVenueStatsDate: null,
  fundamentalsDate: null,
  scorecardProtocolId: null,
  scorecardTimeframe: '90D',
};

let profitPoolChart = null;
let scorecardChart = null;
let marketShareChart = null;

const els = {
  freshness: document.querySelector('#freshness'),
  profitPoolPanel: document.querySelector('.profit-pool-panel'),
  methodologyPanel: document.querySelector('.methodology-panel'),
  scorecardProtocol: document.querySelector('#scorecard-protocol'),
  scorecardTimeframe: document.querySelector('#scorecard-timeframe'),
  scorecardContext: document.querySelector('#scorecard-context'),
  scorecardTable: document.querySelector('#scorecard-table-body'),
  scorecardChart: document.querySelector('#scorecard-chart'),
  marketShareChart: document.querySelector('#market-share-chart'),
  marketShareNote: document.querySelector('#market-share-note'),
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
  totalEarnings: document.querySelector('#total-earnings'),
  totalEarningsDelta: document.querySelector('#total-earnings-delta'),
  totalEarningsDetail: document.querySelector('#total-earnings-detail'),
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
    text: chartColor('--text', '#252b36'),
    muted: chartColor('--muted', '#697386'),
    muted2: chartColor('--muted-2', '#8a94a6'),
    accent: chartColor('--accent', '#635bff'),
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
  const takeRate = revenue === null || activeLoans === null || activeLoans <= 0 ? null : revenue / activeLoans;
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
  els.themeToggle.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
  els.themeToggle.setAttribute('aria-label', `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} mode`);

  if (persist) {
    try {
      window.localStorage.setItem('defi-dashboard-theme', nextTheme);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }

  if (state.fundamentals.length > 0) {
    renderProfitPool();
    renderScorecard();
    renderMarketShare();
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
  const snapshotDate = state.allVenueStatsDate;
  const rows = state.allVenueStats.filter((row) => row.date === snapshotDate);
  const activeRows = rows.filter((row) => row.activeLoans !== null && row.activeLoans > 0);
  const totalActiveLoans = sumAvailable(rows, (row) => row.activeLoans);
  const totalActiveLoans90dAgo = sumAvailable(rows, (row) => row.activeLoans90dAgo);
  const totalRevenue = sumAvailable(rows, (row) => effectiveVenueMetric(row, 'revenueTtm', 'revenueAnnualized'));
  const totalRevenue90dAgo = sumAvailable(rows, (row) => row.revenue90dAgo);
  const totalEarnings = sumAvailable(rows, (row) => effectiveVenueMetric(row, 'earningsTtm', 'earningsAnnualized'));
  const totalEarnings90dAgo = sumAvailable(rows, (row) => row.earnings90dAgo);
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
  els.totalEarnings.textContent = formatUsd(totalEarnings);
  setKpiDelta(els.totalEarningsDelta, relativeDelta(totalEarnings, totalEarnings90dAgo));
  els.totalRevenueDetail.textContent = 'TTM where available; annualized otherwise';
  els.totalEarningsDetail.textContent = 'TTM where available; annualized otherwise';
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
  els.totalActiveLoans.textContent = '--';
  els.totalActiveLoansDetail.textContent = 'All-venue snapshot unavailable';
  setKpiDelta(els.totalActiveLoansDelta, null);
  els.totalRevenue.textContent = '--';
  setKpiDelta(els.totalRevenueDelta, null);
  els.totalEarnings.textContent = '--';
  setKpiDelta(els.totalEarningsDelta, null);
  els.totalRevenueDetail.textContent = 'All-venue snapshot unavailable';
  els.totalEarningsDetail.textContent = 'All-venue snapshot unavailable';
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
  marketShareChart?.resize();
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

function disposeMarketShareChart() {
  marketShareChart?.dispose();
  marketShareChart = null;
}

function renderProfitPool() {
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

const SCORECARD_TIMEFRAMES = { '30D': 30, '90D': 90, '1Y': 365 };
const SCORECARD_METRICS = [
  { key: 'activeLoans', label: 'Active Loans', type: 'usd', higherIsBetter: true },
  { key: 'marketShare', label: 'Market Share', type: 'percent', higherIsBetter: true },
  { key: 'loanGrowth', label: 'Loan Growth', type: 'percent', higherIsBetter: true },
  { key: 'revenue', label: 'Revenue', type: 'usd', higherIsBetter: true },
  { key: 'takeRate', label: 'Take Rate', type: 'percent', digits: 2, higherIsBetter: true },
  { key: 'earningsMargin', label: 'Earnings Margin', type: 'percent', higherIsBetter: true },
  { key: 'economicProfit', label: 'Economic Profit', type: 'usd', higherIsBetter: true },
  { key: 'profitPoolShare', label: 'Profit Pool Share', type: 'percent', higherIsBetter: true },
  { key: 'incentiveIntensity', label: 'Incentive Intensity', type: 'percent', higherIsBetter: false },
];
const SCORECARD_BENCHMARK_KEYS = new Set(['marketShare', 'loanGrowth', 'takeRate', 'earningsMargin', 'profitPoolShare']);

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
      takeRate: fundamental.takeRate,
      earningsMargin: earnings === null || revenue === null || revenue <= 0 ? null : earnings / revenue,
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

function scorecardPeriodDelta(metric, protocolId, context) {
  const current = context.currentMetrics.get(protocolId)?.[metric.key];
  let prior;
  if (metric.key === 'activeLoans' || metric.key === 'marketShare') {
    prior = context.priorMarketMetrics.get(protocolId)?.[metric.key];
  } else if (metric.key === 'loanGrowth') {
    prior = context.priorMarketMetrics.get(protocolId)?.loanGrowth;
  } else {
    prior = context.priorFundamentalsMetrics.get(protocolId)?.[metric.key];
  }
  if (current === null || current === undefined || prior === null || prior === undefined) return null;
  return current - prior;
}

function scorecardRank(metric, protocolId, metrics) {
  const ranked = [...metrics.entries()]
    .map(([id, values]) => ({ id, value: values[metric.key] }))
    .filter((item) => item.value !== null && item.value !== undefined)
    .sort((a, b) => metric.higherIsBetter ? b.value - a.value : a.value - b.value);
  const index = ranked.findIndex((item) => item.id === protocolId);
  return index === -1 ? '--' : `${index + 1}/${ranked.length}`;
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
  els.scorecardChart.replaceChildren();
  if (!window.echarts) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Could not load the ECharts library.';
    els.scorecardChart.appendChild(empty);
    return;
  }

  const chartMetrics = scorecardRows
    .filter((row) => SCORECARD_BENCHMARK_KEYS.has(row.metric.key) && row.protocolValue !== null && row.sectorMedian !== null)
    .map((row) => {
      const values = [...context.currentMetrics.values()].map((metrics) => metrics[row.metric.key]);
      return {
        ...row,
        protocolNormalized: scorecardNormalizedValue(row.protocolValue, values),
        medianNormalized: scorecardNormalizedValue(row.sectorMedian, values),
      };
    })
    .filter((row) => row.protocolNormalized !== null && row.medianNormalized !== null);

  if (chartMetrics.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pool-empty';
    empty.textContent = 'Benchmark data unavailable for the selected timeframe.';
    els.scorecardChart.appendChild(empty);
    return;
  }

  const colors = chartColors();
  els.scorecardChart.setAttribute('aria-label', `Horizontal benchmark bars comparing ${selectedName} with the sector median. Values are normalized within the direct-competitor cohort, where 100 is the highest cohort value rather than 100 percent.`);
  scorecardChart = window.echarts.init(els.scorecardChart, null, { renderer: 'canvas' });
  scorecardChart.setOption({
    animation: false,
    grid: { top: 48, right: 16, bottom: 38, left: 8, containLabel: true },
    legend: {
      top: 4,
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
          'Bars normalized within the cohort',
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
        data: chartMetrics.map((row) => ({ value: row.protocolNormalized, raw: row.protocolValue })),
        itemStyle: { color: colors.accent, borderRadius: [0, 3, 3, 0] },
      },
      {
        name: 'Sector median',
        type: 'bar',
        barMaxWidth: 15,
        data: chartMetrics.map((row) => ({ value: row.medianNormalized, raw: row.sectorMedian })),
        itemStyle: { color: colors.chartMedian, borderRadius: [0, 3, 3, 0] },
      },
    ],
  });
}

function renderScorecardProtocolOptions() {
  els.scorecardProtocol.replaceChildren();
  for (const fundamental of state.fundamentals) {
    const option = document.createElement('option');
    option.value = fundamental.id;
    option.textContent = fundamental.name;
    els.scorecardProtocol.appendChild(option);
  }
}

function renderScorecard() {
  disposeScorecardChart();
  els.scorecardTable.replaceChildren();
  renderScorecardProtocolOptions();

  if (state.fundamentals.length === 0) {
    els.scorecardContext.textContent = 'Scorecard data unavailable';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'scorecard-empty';
    cell.textContent = 'Scorecard data unavailable.';
    row.appendChild(cell);
    els.scorecardTable.appendChild(row);
    els.scorecardChart.replaceChildren();
    return;
  }

  const protocolIds = state.fundamentals.map((row) => row.id);
  if (!protocolIds.includes(state.scorecardProtocolId)) state.scorecardProtocolId = protocolIds[0];
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
  const context = { currentMetrics, priorMarketMetrics, priorFundamentalsMetrics };
  const selected = state.fundamentals.find((row) => row.id === state.scorecardProtocolId);
  const selectedName = selected?.name || state.scorecardProtocolId;

  for (const metric of SCORECARD_METRICS) {
    const protocolValue = currentMetrics.get(state.scorecardProtocolId)?.[metric.key] ?? null;
    const sectorMedian = median([...currentMetrics.values()].map((values) => values[metric.key]));
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = metric.label;
    row.appendChild(name);
    appendFundamentalsCell(row, scorecardFormatValue(protocolValue, metric));
    appendFundamentalsCell(row, scorecardFormatValue(sectorMedian, metric));
    appendFundamentalsCell(row, scorecardRank(metric, state.scorecardProtocolId, currentMetrics));
    const periodDelta = scorecardPeriodDelta(metric, state.scorecardProtocolId, context);
    appendFundamentalsCell(row, scorecardFormatDelta(periodDelta, metric), deltaClass(periodDelta));
    els.scorecardTable.appendChild(row);
  }

  els.scorecardContext.textContent = `${selectedName} | ${state.scorecardTimeframe} | ${protocolIds.length} direct competitors`;
  renderScorecardChart(SCORECARD_METRICS.map((metric) => ({
    metric,
    protocolValue: currentMetrics.get(state.scorecardProtocolId)?.[metric.key] ?? null,
    sectorMedian: median([...currentMetrics.values()].map((values) => values[metric.key])),
  })), context, selectedName);
}

function renderMarketShare() {
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

function appendFundamentalsCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.appendChild(cell);
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
    name.textContent = fundamental.name;
    row.appendChild(name);
    appendFundamentalsCell(row, formatUsd(fundamental.activeLoans));
    appendFundamentalsCell(
      row,
      totalActiveLoans > 0 && fundamental.activeLoans !== null ? formatPercent(fundamental.activeLoans / totalActiveLoans, 1) : '--',
    );
    appendFundamentalsCell(row, formatUsd(fundamental.revenue));
    appendFundamentalsCell(row, formatUsd(fundamental.earnings));
    appendFundamentalsCell(row, formatPercent(fundamental.takeRate, 2));
    const currentMarketRow = currentMarketSnapshot?.rowsByProtocol.get(fundamental.id);
    for (const days of [90]) {
      const priorSnapshot = findMarketShareSnapshot(dateDaysAgo(currentMarketSnapshot?.date, days));
      const priorMarketRow = priorSnapshot?.rowsByProtocol.get(fundamental.id);
      const loanDelta = currentMarketRow && priorMarketRow ? currentMarketRow.activeLoans - priorMarketRow.activeLoans : null;
      appendFundamentalsCell(row, formatDeltaUsd(loanDelta), deltaClass(loanDelta));
    }
    const priorShareSnapshot = findMarketShareSnapshot(dateDaysAgo(currentMarketSnapshot?.date, 90));
    const priorShare = snapshotMarketShare(priorShareSnapshot?.rowsByProtocol.get(fundamental.id), priorShareSnapshot);
    const currentShare = snapshotMarketShare(currentMarketRow, currentMarketSnapshot);
    const shareDelta = currentShare === null || priorShare === null ? null : currentShare - priorShare;
    appendFundamentalsCell(row, formatPercent(shareDelta, 1, true), deltaClass(shareDelta));
    els.fundamentalsTable.appendChild(row);
  }

  renderProfitPool();
  renderScorecard();
  renderMarketShare();
}

function renderFundamentalsError() {
  disposeProfitPoolChart();
  disposeScorecardChart();
  disposeMarketShareChart();
  els.fundamentalsDate.textContent = 'Snapshot unavailable';
  els.fundamentalsSource.textContent = 'Could not load data/fundamentals.csv';
  els.scorecardContext.textContent = 'Scorecard unavailable';
  els.profitPool.replaceChildren();
  const message = document.createElement('div');
  message.className = 'pool-empty';
  message.textContent = 'Could not load the monthly fundamentals snapshot.';
  els.profitPool.appendChild(message);
  els.scorecardTable.replaceChildren();
  const scorecardRow = document.createElement('tr');
  const scorecardMessage = document.createElement('td');
  scorecardMessage.colSpan = 5;
  scorecardMessage.className = 'scorecard-empty';
  scorecardMessage.textContent = 'Could not load the competitive scorecard.';
  scorecardRow.appendChild(scorecardMessage);
  els.scorecardTable.appendChild(scorecardRow);
  els.scorecardChart.replaceChildren();
  const scorecardChartMessage = document.createElement('div');
  scorecardChartMessage.className = 'pool-empty';
  scorecardChartMessage.textContent = 'Could not load the sector benchmark chart.';
  els.scorecardChart.appendChild(scorecardChartMessage);
  els.marketShareChart.replaceChildren();
  const marketShareMessage = document.createElement('div');
  marketShareMessage.className = 'pool-empty';
  marketShareMessage.textContent = 'Could not load active loan market-share history.';
  els.marketShareChart.appendChild(marketShareMessage);
  els.marketShareNote.hidden = true;
  syncMethodologyHeight();
}

function bindThemeToggle() {
  applyTheme(document.documentElement.dataset.theme, false);
  els.themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

function bindScorecardControls() {
  els.scorecardProtocol.addEventListener('change', () => {
    state.scorecardProtocolId = els.scorecardProtocol.value;
    renderScorecard();
  });

  els.scorecardTimeframe.addEventListener('change', () => {
    state.scorecardTimeframe = els.scorecardTimeframe.value;
    renderScorecard();
  });
}

async function init() {
  try {
    const [fundamentalsResponse, marketShareResponse, lendingVenuesResponse] = await Promise.all([
      fetch('./data/fundamentals.csv', { cache: 'no-store' }),
      fetch('./data/active-loan-market-share.csv', { cache: 'no-store' }),
      fetch('./data/lending-venue-stats.csv', { cache: 'no-store' }),
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
init();
