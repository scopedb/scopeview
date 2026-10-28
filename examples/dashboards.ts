import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import {
  buildChartDataset,
  createChartSpec,
  fieldRef,
  type ChartDataType,
  type ChartDocument,
  type ResultSet,
  type TraceDocument,
  type ProfileDocument
} from '../src/index.js';
import type { ChartConfig } from '../src/families/metrics/spec.js';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../src/element.js';

type Dashboard = 'operations' | 'growth' | 'revenue';
type ChartElement = ScopeChartElement | ScopeTraceElement | ScopeFlameElement;
type Row = (string | null)[];
interface Metric {
  label: string;
  value: string;
  unit?: string;
  change: string;
  positive: boolean;
  note?: string;
  spark: number[];
}

const day = 86_400_000;
const snapshotEnd = Date.UTC(2026, 9, 2);
const dates = Array.from({ length: 60 }, (_, i) =>
  new Date(snapshotEnd - (60 - i) * day).toISOString()
);
const paths: Record<string, string> = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  growth: '<path d="m3 17 6-6 4 3 7-9M14 5h6v6"/>',
  wallet: '<path d="M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7"/><path d="M20 12h-5v4h5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  cursor: '<path d="m5 3 14 9-7 1-3 7-4-17Z"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M7 15h2M13 15h2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
};
const settings: Record<
  Dashboard,
  { name: string; eyebrow: string; title: string; description: string }
> = {
  operations: {
    name: 'System pulse',
    eyebrow: '01 / OBSERVABILITY',
    title: 'A pulse on your platform.',
    description: 'Every request, every service. One clear picture.'
  },
  growth: {
    name: 'Product growth',
    eyebrow: '02 / PRODUCT ANALYTICS',
    title: 'Small signals. Real growth.',
    description: 'Understand what brings people in, and what keeps them coming back.'
  },
  revenue: {
    name: 'Revenue studio',
    eyebrow: '03 / COMMERCE',
    title: 'Good business, in view.',
    description: 'Follow the sales, the stories, and the details that add up.'
  }
};
const periodByDashboard: Record<Dashboard, number> = { operations: 7, growth: 30, revenue: 30 };
const period = document.querySelector<HTMLSelectElement>('#period')!;
const panels = document.querySelector<HTMLElement>('#panels')!;
const metrics = document.querySelector<HTMLElement>('#metrics')!;
const exports: { title: string; data: ResultSet }[] = [];
let dashboard: Dashboard = 'operations';
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => sum(values) / values.length;
const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = (value: number) =>
  value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const integer = (value: number) => Math.round(value).toLocaleString('en-US');
const change = (value: number, previous: number) => {
  const delta = (value / previous - 1) * 100;
  return `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}%`;
};
const pointChange = (value: number, previous: number) => {
  const delta = value - previous;
  if (Math.abs(delta) < 0.0005) return 'No change';
  return `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(Math.abs(delta) < 0.01 ? 3 : 2)} pp`;
};
const windowValues = (values: number[], previous = false) => {
  const count = periodByDashboard[dashboard];
  return previous ? values.slice(-2 * count, -count) : values.slice(-count);
};
const selectedDates = () => dates.slice(-periodByDashboard[dashboard]);

function icons() {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((node) => {
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[node.dataset.icon!] ?? ''}</svg>`;
  });
}

const legends = new WeakMap<ChartDocument, boolean>();
function chart(
  fields: [string, ChartDataType][],
  rows: Row[],
  config: ChartConfig,
  colors: Record<string, string> = {},
  legend = false
): ChartDocument {
  const data: ResultSet = {
    fields: fields.map(([name, data_type]) => ({ name, data_type })),
    rows
  };
  const document: ChartDocument = {
    version: 1,
    data,
    spec: createChartSpec(buildChartDataset(data), config),
    options: { colors, stack: false }
  };
  if (fields[0][1] === 'timestamp') {
    const field = fieldRef(buildChartDataset(data), 'result-column-0');
    document.semantics = {
      time:
        config.displayType === 'bar'
          ? { kind: 'buckets', field, intervalMs: day, coverage: 'complete' }
          : { kind: 'points', field }
    };
  }
  legends.set(document, legend);
  return document;
}

function series(
  names: string[],
  values: number[][],
  displayType: 'line' | 'area' | 'bar',
  colors: string[],
  legend = true
) {
  return chart(
    [['Day', 'timestamp'], ...names.map((name): [string, ChartDataType] => [name, 'number'])],
    selectedDates().map((date, i) => [date, ...values.map((value) => String(value[i]))]),
    {
      displayType,
      mapping: {
        kind: 'axis',
        x: 'result-column-0',
        y: names.map((_, i) => `result-column-${i + 1}` as `result-column-${number}`)
      }
    },
    Object.fromEntries(names.map((name, i) => [name, colors[i]])),
    legend
  );
}

function distribution(
  names: string[],
  values: number[],
  displayType: 'pie' | 'top-list' | 'bar',
  colors: string[]
) {
  return chart(
    [
      ['Category', 'string'],
      ['Total', 'number']
    ],
    names.map((name, i) => [name, String(values[i])]),
    displayType === 'bar'
      ? { displayType, mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] } }
      : {
          displayType,
          mapping: { kind: 'distribution', category: 'result-column-0', value: 'result-column-1' }
        },
    displayType === 'bar'
      ? { Total: colors[0] }
      : Object.fromEntries(names.map((name, i) => [name, colors[i]]))
  );
}

function skin(element: ChartElement) {
  const css = getComputedStyle(document.documentElement);
  for (const [token, variable] of Object.entries({
    '--color-surface': '--surface',
    '--color-text-primary': '--text',
    '--color-text-secondary': '--muted',
    '--color-text-tertiary': '--muted',
    '--color-text-brand': '--accent',
    '--color-border': '--border',
    '--color-border-light': '--border-soft',
    '--color-chart-label': '--muted',
    '--color-chart-grid': '--border-soft',
    '--color-text-danger': '--negative'
  }))
    element.style.setProperty(token, css.getPropertyValue(variable).trim());
  element.style.colorScheme = dashboard === 'operations' ? 'dark' : 'light';
  element.style.setProperty(
    '--color-chart-axis',
    dashboard === 'operations' ? '#425455' : '#c4cbd5'
  );
  element.style.setProperty(
    '--color-surface-hover',
    dashboard === 'operations' ? '#233134' : '#f1f3f7'
  );
  element.style.setProperty(
    '--color-surface-pressed',
    dashboard === 'operations' ? '#2b3c3f' : '#e9edf4'
  );
}

function mount(id: string, title: string, document: ChartDocument) {
  const element = window.document.querySelector<ScopeChartElement>(`#${id}`)!;
  skin(element);
  element.setAttribute('aria-label', title);
  element.configure({ axes: 'minimal', toolbar: false, legend: legends.get(document) ?? false });
  element.document = document;
  if (document.options?.presentation !== 'sparkline') exports.push({ title, data: document.data });
}

function metricCards(items: Metric[], color: string) {
  metrics.innerHTML = items
    .map(
      (metric, i) =>
        `<article class="kpi"><p class="kpi-label">${metric.label}<span class="kpi-index">0${i + 1}</span></p><p class="kpi-value">${metric.value}${metric.unit ? ` <small>${metric.unit}</small>` : ''}</p><p class="kpi-change"><strong class="${metric.positive ? '' : 'negative'}">${metric.change}</strong><span>${metric.note ?? 'vs. previous period'}</span></p><scope-chart id="spark-${i}" aria-hidden="true"></scope-chart></article>`
    )
    .join('');
  items.forEach((item, i) => {
    const document = series([item.label], [item.spark], 'area', [color], false);
    document.options!.presentation = 'sparkline';
    mount(`spark-${i}`, item.label, document);
  });
}

function heading(title: string, subtitle: string, tag = '') {
  return `<div class="panel-heading"><div><h2>${title}</h2><p class="panel-subtitle">${subtitle}</p></div>${tag ? `<span class="panel-tag">${tag}</span>` : ''}</div>`;
}
function panelStat(value: string, label: string) {
  return `<div class="panel-stat"><strong>${value}</strong><span>${label}</span></div>`;
}
function footer(left: string, right: string) {
  return `<div class="panel-footer"><span>${left}</span><span>${right}</span></div>`;
}
function split(total: number, shares: number[]) {
  const values = shares.map((share) => Math.round(total * share));
  values[values.length - 1] += total - sum(values);
  return values;
}

// Stable daily source snapshots. Changing the range selects rows, never randomizes them.
const queryRequests = dates.map((_, i) =>
  Math.round(1_420_000 + i * 19_000 + Math.sin(i * 0.8) * 180_000 + Math.cos(i * 0.31) * 120_000)
);
const ingestRequests = dates.map((_, i) =>
  Math.round(610_000 + i * 9_000 + Math.sin(i * 0.8 + 1.2) * 120_000)
);
const requests = queryRequests.map((value, i) => value + ingestRequests[i]);
const failures = requests.map((value, i) =>
  Math.round(value * (0.00031 + (Math.sin(i * 0.7) + 1) * 0.00018))
);
const p95 = dates.map((_, i) =>
  Math.round(151 - i * 0.53 + Math.sin(i * 1.1) * 17 + (i === 55 ? 37 : 0))
);
const p50 = p95.map((value, i) => Math.round(value * 0.32 + Math.cos(i * 0.6) * 4));

function operations() {
  const currentRequests = windowValues(requests);
  const previousRequests = windowValues(requests, true);
  const total = sum(currentRequests);
  const previousTotal = sum(previousRequests);
  const success = 100 * (1 - sum(windowValues(failures)) / total);
  const previousSuccess = 100 * (1 - sum(windowValues(failures, true)) / previousTotal);
  const latency = windowValues(p95);
  const priorLatency = windowValues(p95, true);
  metricCards(
    [
      {
        label: 'Total requests',
        value: compact(total),
        change: change(total, previousTotal),
        positive: total >= previousTotal,
        spark: currentRequests
      },
      {
        label: 'Success rate',
        value: success.toFixed(3),
        unit: '%',
        change: pointChange(success, previousSuccess),
        positive: success >= previousSuccess,
        spark: currentRequests.map((value, i) => 100 * (1 - windowValues(failures)[i] / value))
      },
      {
        label: 'Latest daily p95',
        value: String(latency.at(-1)),
        unit: 'ms',
        change: change(latency.at(-1)!, priorLatency.at(-1)!),
        positive: latency.at(-1)! <= priorLatency.at(-1)!,
        spark: latency
      },
      {
        label: 'Services healthy',
        value: '4 <small>/ 4</small>',
        change: 'All operational',
        positive: true,
        note: 'sample snapshot',
        spark: currentRequests.map(() => 4)
      }
    ],
    '#71dac1'
  );
  panels.innerHTML = `<div class="panel-grid"><section class="panel">${heading('Request volume', 'Daily requests across your platform', 'REQUESTS')}${panelStat(compact(total), 'requests in the selected period')}<div class="chart-wrap"><scope-chart id="traffic"></scope-chart></div>${footer('Query + ingestion', 'UTC · daily observations')}</section><section class="panel">${heading('Response latency', 'Daily response-time percentiles', 'MILLISECONDS')}${panelStat(`${latency.at(-1)} <span>ms</span>`, 'latest daily p95')}<div class="chart-wrap"><scope-chart id="latency"></scope-chart></div>${footer('p50 / p95', 'Lower is better')}</section></div><div class="lower-grid operations-lower"><section class="panel">${heading('Requests by service', 'Where the work happens', '4 SERVICES')}<div class="chart-wrap"><scope-chart id="services"></scope-chart></div>${footer('Selected period', 'Requests')}</section><section class="panel">${heading('Inside a request', 'GET /v1/events · latest sample trace', '200 OK')}<div class="entity-wrap"><scope-trace id="trace"></scope-trace></div>${footer('6 spans · complete trace', '184 ms')}</section><section class="panel">${heading('CPU profile', 'Latest sample · inclusive frame weights', 'SAMPLES')}<div class="entity-wrap"><scope-flame id="flame"></scope-flame></div>${footer('1,000 samples', 'Click a frame to explore')}</section></div>`;
  mount(
    'traffic',
    'Daily request volume',
    series(
      ['Query', 'Ingestion'],
      [windowValues(queryRequests), windowValues(ingestRequests)],
      'area',
      ['#71dac1', '#739bba']
    )
  );
  const latencyDocument = series(['p95', 'p50'], [latency, windowValues(p50)], 'line', [
    '#b9a0d7',
    '#739bba'
  ]);
  latencyDocument.options!.values = ['result-column-1', 'result-column-2'].map((id) => ({
    field: fieldRef(buildChartDataset(latencyDocument.data), id as `result-column-${number}`),
    divisor: '1',
    unit: 'ms',
    decimals: 0
  }));
  mount('latency', 'Daily response latency', latencyDocument);
  mount(
    'services',
    'Requests by service',
    distribution(
      ['Query API', 'Ingestion', 'Gateway', 'Export'],
      split(total, [0.42, 0.28, 0.19, 0.11]),
      'top-list',
      ['#71dac1', '#739bba', '#b9a0d7', '#d0b071']
    )
  );
  const origin = BigInt(snapshotEnd - 60_000) * 1_000_000n;
  const time = (ms: number) => (origin + BigInt(ms) * 1_000_000n).toString();
  const traceDocument: TraceDocument = {
    version: 1,
    kind: 'trace',
    coverage: 'complete',
    spans: [
      {
        id: 'request',
        name: 'GET /v1/events',
        service: 'gateway',
        status: 'ok',
        startTimeNs: time(0),
        endTimeNs: time(184)
      },
      {
        id: 'auth',
        parentId: 'request',
        name: 'authenticate',
        service: 'gateway',
        startTimeNs: time(2),
        endTimeNs: time(19)
      },
      {
        id: 'query',
        parentId: 'request',
        name: 'execute query',
        service: 'query',
        startTimeNs: time(22),
        endTimeNs: time(172)
      },
      {
        id: 'scan',
        parentId: 'query',
        name: 'scan events',
        service: 'storage',
        startTimeNs: time(30),
        endTimeNs: time(138)
      },
      {
        id: 'decode',
        parentId: 'scan',
        name: 'decode batch',
        service: 'storage',
        startTimeNs: time(42),
        endTimeNs: time(105)
      },
      {
        id: 'merge',
        parentId: 'query',
        name: 'merge results',
        service: 'query',
        startTimeNs: time(140),
        endTimeNs: time(168)
      }
    ]
  };
  const trace = document.querySelector<ScopeTraceElement>('#trace')!;
  skin(trace);
  trace.document = traceDocument;
  const profileDocument: ProfileDocument = {
    version: 1,
    kind: 'profile',
    unit: 'samples',
    frames: [
      { id: 'root', name: 'handleRequest', selfWeight: '45' },
      { id: 'execute', parentId: 'root', name: 'executeQuery', selfWeight: '55' },
      { id: 'scan', parentId: 'execute', name: 'scanEvents', selfWeight: '150' },
      { id: 'decode', parentId: 'scan', name: 'decodeBatch', selfWeight: '380' },
      { id: 'filter', parentId: 'scan', name: 'filterRows', selfWeight: '190' },
      { id: 'merge', parentId: 'execute', name: 'mergeResults', selfWeight: '130' },
      { id: 'auth', parentId: 'root', name: 'authenticate', selfWeight: '50' }
    ]
  };
  const flame = document.querySelector<ScopeFlameElement>('#flame')!;
  skin(flame);
  flame.document = profileDocument;
}

const activeUsers = dates.map((_, i) =>
  Math.round(12_800 + i * 218 + Math.sin(i * 0.83) * 1900 + Math.cos(i * 0.24) * 800)
);
const newUsers = dates.map((_, i) => Math.round(1100 + i * 16 + Math.sin(i * 0.83 + 0.5) * 290));
const signups = dates.map((_, i) => Math.round(340 + i * 4.1 + Math.sin(i * 0.83 + 0.7) * 100));
const activated = signups.map((value, i) =>
  Math.round(value * (0.56 + i * 0.0015 + Math.sin(i * 0.4) * 0.02))
);
const sessions = activeUsers.map((value, i) =>
  Math.round(value * (3.15 + i * 0.013 + Math.sin(i * 0.4) * 0.18))
);

function cohortTable() {
  const cohorts: [string, (number | null)[]][] = [
    ['Aug 31', [100, 68, 54, 48, 44]],
    ['Sep 07', [100, 72, 59, 52, null]],
    ['Sep 14', [100, 74, 61, null, null]],
    ['Sep 21', [100, 76, null, null, null]]
  ];
  return `<div class="table-wrap"><table class="cohort-table"><thead><tr><th scope="col">COHORT</th>${['Week 0', 'Week 1', 'Week 2', 'Week 3', 'Week 4'].map((name) => `<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>${cohorts.map(([name, values]) => `<tr><th scope="row">${name}</th>${values.map((value) => (value === null ? '<td class="unavailable" aria-label="Not yet available">—</td>' : `<td style="--cell-alpha:${0.06 + value * 0.0029}">${value}%</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function growth() {
  const currentActive = windowValues(activeUsers);
  const previousActive = windowValues(activeUsers, true);
  const accounts = sum(windowValues(signups));
  const previousAccounts = sum(windowValues(signups, true));
  const activations = sum(windowValues(activated));
  const activationRate = (100 * activations) / accounts;
  const previousActivation = (100 * sum(windowValues(activated, true))) / previousAccounts;
  const sessionRate = sum(windowValues(sessions)) / sum(currentActive);
  const previousSessionRate = sum(windowValues(sessions, true)) / sum(previousActive);
  metricCards(
    [
      {
        label: 'Avg. daily active users',
        value: compact(mean(currentActive)),
        change: change(mean(currentActive), mean(previousActive)),
        positive: mean(currentActive) >= mean(previousActive),
        spark: currentActive
      },
      {
        label: 'New accounts',
        value: integer(accounts),
        change: change(accounts, previousAccounts),
        positive: accounts >= previousAccounts,
        spark: windowValues(signups)
      },
      {
        label: 'Account activation',
        value: activationRate.toFixed(1),
        unit: '%',
        change: pointChange(activationRate, previousActivation),
        positive: activationRate >= previousActivation,
        spark: windowValues(signups).map((value, i) => (100 * windowValues(activated)[i]) / value)
      },
      {
        label: 'Sessions per active user',
        value: sessionRate.toFixed(2),
        change: change(sessionRate, previousSessionRate),
        positive: sessionRate >= previousSessionRate,
        spark: currentActive.map((value, i) => windowValues(sessions)[i] / value)
      }
    ],
    '#6877dc'
  );
  const funnel = [
    Math.round(accounts * 8.4),
    accounts,
    activations,
    Math.round(activations * 0.28)
  ];
  panels.innerHTML = `<div class="panel-grid"><section class="panel">${heading('Daily active users', 'A growing audience, one day at a time', 'USERS')}${panelStat(integer(mean(currentActive)), 'average daily active users')}<div class="chart-wrap"><scope-chart id="audience"></scope-chart></div>${footer('Active users include new users', 'UTC · daily observations')}</section><section class="panel">${heading('The activation journey', 'From first visit to first value', 'FUNNEL')}${panelStat(`${activationRate.toFixed(1)}%`, 'of new accounts activated')}<div class="chart-wrap"><scope-chart id="funnel"></scope-chart></div>${footer('Selected period', 'Returned stage totals')}</section></div><div class="lower-grid"><section class="panel">${heading('Where growth starts', 'New accounts by acquisition channel', 'ATTRIBUTION')}<div class="chart-wrap"><scope-chart id="channels"></scope-chart></div>${footer(`${integer(accounts)} new accounts`, 'Last-touch attribution')}</section><section class="panel">${heading('Give them a reason to return', 'Weekly retention · latest four cohort snapshots', 'COHORTS')}${cohortTable()}${footer('Darker cells = higher retention', '— not yet available')}</section></div>`;
  mount(
    'audience',
    'Daily active and new users',
    series(['Active users', 'New users'], [currentActive, windowValues(newUsers)], 'area', [
      '#6877dc',
      '#9cc5de'
    ])
  );
  mount(
    'funnel',
    'Activation journey',
    distribution(['Visitors', 'Signed up', 'Activated', 'Paid'], funnel, 'top-list', [
      '#a5afe9',
      '#8898e2',
      '#6877dc',
      '#3f50b0'
    ])
  );
  const channelDocument = distribution(
    ['Organic', 'Direct', 'Referral', 'Paid', 'Social'],
    split(accounts, [0.34, 0.26, 0.19, 0.14, 0.07]),
    'bar',
    ['#6877dc', '#8391e2', '#a5afe9', '#9cc5de', '#b8d4e5']
  );
  channelDocument.options!.orientation = 'horizontal';
  mount('channels', 'New accounts by channel', channelDocument);
}

const orders = dates.map((_, i) =>
  Math.round(118 + i * 1.3 + Math.sin(i * 0.87) * 23 + (i % 7 === 5 ? 28 : 0))
);
const sales = orders.map((value, i) =>
  Math.round(value * (87 + i * 0.43 + Math.cos(i * 0.34) * 9))
);
const refunds = orders.map((value, i) =>
  Math.max(1, Math.round(value * (0.02 - i * 0.00012 + Math.sin(i) * 0.004)))
);

function transactions() {
  const rows = [
    ['M', 'Morrow Studio', 'Order #10482 · Oct 01', 'Editions', '$248.00'],
    ['F', 'Forma & Field', 'Order #10481 · Oct 01', 'Objects', '$186.00'],
    ['A', 'Atelier North', 'Order #10480 · Oct 01', 'Essentials', '$124.00'],
    ['O', 'Openhouse', 'Order #10479 · Oct 01', 'Accessories', '$78.00']
  ];
  return `<div class="table-wrap"><table><thead><tr><th scope="col">CUSTOMER</th><th scope="col">COLLECTION</th><th scope="col">STATUS</th><th scope="col" class="text-right">AMOUNT</th></tr></thead><tbody>${rows.map(([initial, name, order, collection, amount]) => `<tr><th scope="row"><span class="customer"><span class="customer-avatar">${initial}</span><span><strong>${name}</strong><small>${order}</small></span></span></th><td>${collection}</td><td><span class="paid-badge">Paid</span></td><td class="text-right">${amount}</td></tr>`).join('')}</tbody></table></div>`;
}

function revenue() {
  const currentSales = windowValues(sales);
  const previousSales = windowValues(sales, true);
  const total = sum(currentSales);
  const previousTotal = sum(previousSales);
  const currentOrders = windowValues(orders);
  const orderTotal = sum(currentOrders);
  const previousOrders = sum(windowValues(orders, true));
  const orderValue = total / orderTotal;
  const priorOrderValue = previousTotal / previousOrders;
  const refundRate = (100 * sum(windowValues(refunds))) / orderTotal;
  const previousRefundRate = (100 * sum(windowValues(refunds, true))) / previousOrders;
  metricCards(
    [
      {
        label: 'Gross revenue',
        value: money(total),
        change: change(total, previousTotal),
        positive: total >= previousTotal,
        spark: currentSales
      },
      {
        label: 'Orders placed',
        value: integer(orderTotal),
        change: change(orderTotal, previousOrders),
        positive: orderTotal >= previousOrders,
        spark: currentOrders
      },
      {
        label: 'Average order value',
        value: money(orderValue),
        change: change(orderValue, priorOrderValue),
        positive: orderValue >= priorOrderValue,
        spark: currentSales.map((value, i) => value / currentOrders[i])
      },
      {
        label: 'Refunded orders',
        value: refundRate.toFixed(2),
        unit: '%',
        change: pointChange(refundRate, previousRefundRate),
        positive: refundRate <= previousRefundRate,
        spark: currentOrders.map((value, i) => (100 * windowValues(refunds)[i]) / value)
      }
    ],
    '#bc825f'
  );
  const collections = ['Essentials', 'Objects', 'Editions', 'Accessories'];
  const collectionColors = ['#bd825f', '#d9b99a', '#8d9b81', '#b7beca'];
  const collectionValues = split(total, [0.43, 0.28, 0.19, 0.1]);
  const legend = `<div class="distribution-legend">${collections.map((name, i) => `<div class="distribution-row" style="--key-color:${collectionColors[i]}"><i></i><span>${name}</span><strong>${money(collectionValues[i])}</strong><small>${Math.round((collectionValues[i] / total) * 100)}%</small></div>`).join('')}</div>`;
  panels.innerHTML = `<div class="panel-grid"><section class="panel">${heading('The revenue picture', 'Daily gross sales, with a little perspective', 'USD')}${panelStat(money(total), 'gross revenue in the selected period')}<div class="chart-wrap"><scope-chart id="sales"></scope-chart></div>${footer('Prior period aligned by day', 'UTC · daily observations')}</section><section class="panel">${heading('A well-balanced collection', 'Revenue by product collection', 'SALES MIX')}<div class="donut-wrap"><scope-chart id="mix"></scope-chart></div>${legend}${footer('Four collections', 'Gross revenue · USD')}</section></div><div class="lower-grid"><section class="panel">${heading('Every storefront counts', 'Gross revenue by sales channel', 'USD')}<div class="chart-wrap"><scope-chart id="storefronts"></scope-chart></div>${footer('Selected period', 'All storefronts')}</section><section class="panel">${heading('The latest good news', 'Four recent orders · separate sample snapshot', 'TRANSACTIONS')}${transactions()}${footer('Oct 01, 2026 · sample orders', 'Amounts in USD')}</section></div>`;
  mount(
    'sales',
    'Daily gross revenue',
    series(['Current period', 'Prior period'], [currentSales, previousSales], 'area', [
      '#bd825f',
      '#b7beca'
    ])
  );
  mount(
    'mix',
    'Revenue by product collection',
    distribution(collections, collectionValues, 'pie', collectionColors)
  );
  const storefrontDocument = distribution(
    ['Online', 'Marketplace', 'Retail', 'Wholesale'],
    split(total, [0.52, 0.23, 0.16, 0.09]),
    'bar',
    ['#bd825f', '#d9b99a', '#8d9b81', '#b7beca']
  );
  storefrontDocument.options!.orientation = 'horizontal';
  mount('storefronts', 'Revenue by sales channel', storefrontDocument);
}

function render() {
  document.documentElement.dataset.dashboard = dashboard;
  document.title = `${settings[dashboard].name} · ScopeView`;
  for (const [id, text] of Object.entries({
    'breadcrumb-title': settings[dashboard].name,
    eyebrow: settings[dashboard].eyebrow,
    'page-title': settings[dashboard].title,
    'page-description': settings[dashboard].description
  }))
    document.getElementById(id)!.textContent = text;
  document.querySelectorAll<HTMLAnchorElement>('[data-dashboard-link]').forEach((link) => {
    if (link.dataset.dashboardLink === dashboard) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  period.value = String(periodByDashboard[dashboard]);
  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  });
  document.querySelector('#snapshot-range')!.textContent =
    `${dateFormat.format(new Date(selectedDates()[0]))} — ${dateFormat.format(new Date(snapshotEnd - day))} · UTC`;
  document.querySelector('#context-detail')!.innerHTML =
    dashboard === 'operations'
      ? '<i class="status-dot"></i>All systems operational · sample snapshot'
      : 'A little perspective on the everyday';
  exports.length = 0;
  if (dashboard === 'operations') operations();
  else if (dashboard === 'growth') growth();
  else revenue();
}

function navigate() {
  const hash = window.location.hash.slice(1);
  dashboard = hash === 'growth' || hash === 'revenue' ? hash : 'operations';
  render();
}

period.addEventListener('change', () => {
  periodByDashboard[dashboard] = Number(period.value);
  render();
});
window.addEventListener('hashchange', navigate);

document.querySelector('#export')!.addEventListener('click', () => {
  // Export one rectangular table of metric chart sources; sparkline duplicates are omitted.
  const rows: Row[] = [['Dashboard', 'Chart', 'Row', 'Field', 'Value']];
  for (const source of exports) {
    source.data.rows.forEach((row, index) => {
      row.forEach((value, column) => {
        rows.push([
          settings[dashboard].name,
          source.title,
          String(index + 1),
          source.data.fields[column].name,
          value
        ]);
      });
    });
  }
  const csv = rows
    .map((row) => row.map((cell) => `"${(cell ?? 'NULL').replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `scopeview-${dashboard}-${periodByDashboard[dashboard]}d.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const toast = document.querySelector<HTMLElement>('#toast')!;
  clearTimeout(toastTimer);
  toast.textContent = 'Metric chart source data exported as CSV.';
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
});

icons();
navigate();
