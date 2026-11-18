import type { HighlightLanguage } from './theme/highlight.js';

export type LandingScenarioId = 'trace' | 'line' | 'profile';

export interface LandingScenario {
  id: LandingScenarioId;
  label: string;
  caption: string;
  defaultNote: string;
  document: Record<string, unknown>;
}

export interface LandingHeroStat {
  value: string;
  label: string;
}

export interface LandingPrinciple {
  index: string;
  title: string;
  body: string;
}

export interface LandingWorkflow {
  id: string;
  title: string;
  blurb: string;
  header: string;
  docHref: string;
  docLabel: string;
  language: HighlightLanguage;
  code: string;
}

export interface LandingFamilyChip {
  label: string;
  href: string;
}

export interface LandingFamilyGroup {
  category: string;
  entryPoint: string;
  budget: string;
  description: string;
  chips: LandingFamilyChip[];
}

export interface LandingInstallOption {
  id: string;
  label: string;
  command: string;
}

export const REPO_URL = 'https://github.com/scopedb/scopeview';
export const BUNDLE_DOC_URL = `${REPO_URL}/blob/main/development/bundle-size.md`;

export const heroStats: readonly LandingHeroStat[] = [
  { value: '10', label: 'chart & trace views' },
  { value: '< 39 KiB', label: 'standalone gzip' },
  { value: '0', label: 'runtime deps' },
  { value: '1 ns', label: 'span resolution' }
];

const traceOriginNs = 1803600000000000000n;
const ns = (offset: bigint) => (traceOriginNs + offset).toString();

export const landingScenarios: readonly LandingScenario[] = [
  {
    id: 'trace',
    label: 'Trace',
    caption: '100 ms request · parallel storage workers',
    defaultNote: 'index probe: 1 ns ("…080000001") · commit: 0 ns',
    document: {
      version: 1,
      kind: 'trace',
      title: 'Query execution trace',
      description: '100 ms · parallel storage workers',
      coverage: 'complete',
      spans: [
        {
          id: 'request',
          name: 'SELECT · logs',
          service: 'query',
          startTimeNs: ns(0n),
          endTimeNs: ns(100_000_000n)
        },
        {
          id: 'parse',
          parentId: 'request',
          name: 'parse SQL',
          service: 'query',
          startTimeNs: ns(0n),
          endTimeNs: ns(18_000_001n)
        },
        {
          id: 'worker-a',
          parentId: 'request',
          name: 'scan · worker A',
          service: 'storage',
          startTimeNs: ns(19_000_000n),
          endTimeNs: ns(78_000_000n)
        },
        {
          id: 'read',
          parentId: 'worker-a',
          name: 'read segment',
          service: 'storage',
          startTimeNs: ns(22_000_000n),
          endTimeNs: ns(68_000_000n)
        },
        {
          id: 'range',
          parentId: 'read',
          name: 'fetch byte range',
          service: 'storage',
          startTimeNs: ns(24_000_000n),
          endTimeNs: ns(58_000_000n)
        },
        {
          id: 'worker-b',
          parentId: 'request',
          name: 'scan · worker B',
          service: 'storage',
          startTimeNs: ns(22_000_000n),
          endTimeNs: ns(80_000_000n)
        },
        {
          id: 'retry',
          parentId: 'worker-b',
          name: 'retry · timeout',
          service: 'storage',
          status: 'error',
          startTimeNs: ns(40_000_000n),
          endTimeNs: ns(62_000_000n)
        },
        {
          id: 'tiny',
          parentId: 'request',
          name: 'index probe',
          service: 'cache',
          startTimeNs: ns(80_000_000n),
          endTimeNs: ns(80_000_001n)
        },
        {
          id: 'zero',
          parentId: 'request',
          name: 'commit marker',
          service: 'query',
          startTimeNs: ns(80_000_000n),
          endTimeNs: ns(80_000_000n)
        },
        {
          id: 'merge',
          parentId: 'request',
          name: 'merge results',
          service: 'query',
          startTimeNs: ns(81_000_000n),
          endTimeNs: ns(100_000_000n)
        }
      ]
    }
  },
  {
    id: 'line',
    label: 'Metrics',
    caption: '16 hourly intervals · explicit outage gap',
    defaultNote: '05:00Z ingest: "0" · 06:00Z–07:00Z ingest: null',
    document: {
      version: 1,
      title: 'Requests per hour',
      description: 'Query and ingestion · explicit null gap vs zero',
      data: {
        fields: [
          { name: 'time', data_type: 'timestamp' },
          { name: 'query', data_type: 'number' },
          { name: 'ingest', data_type: 'number' }
        ],
        rows: [
          ['2026-10-27T00:00:00Z', '2120', '1340'],
          ['2026-10-27T01:00:00Z', '2280', '1420'],
          ['2026-10-27T02:00:00Z', '2410', '1510'],
          ['2026-10-27T03:00:00Z', '2360', '1480'],
          ['2026-10-27T04:00:00Z', '2540', '920'],
          ['2026-10-27T05:00:00Z', '2490', '0'],
          ['2026-10-27T06:00:00Z', '2680', null],
          ['2026-10-27T07:00:00Z', '2740', null],
          ['2026-10-27T08:00:00Z', '2910', '1690'],
          ['2026-10-27T09:00:00Z', '3150', '1840'],
          ['2026-10-27T10:00:00Z', '3340', '1960'],
          ['2026-10-27T11:00:00Z', '3280', '1910'],
          ['2026-10-27T12:00:00Z', '3520', '2080'],
          ['2026-10-27T13:00:00Z', '3690', '2190'],
          ['2026-10-27T14:00:00Z', '3610', '2140'],
          ['2026-10-27T15:00:00Z', '3840', '2290']
        ]
      },
      spec: {
        visualization: 'line',
        encoding: {
          x: 'time',
          y: ['query', 'ingest']
        }
      }
    }
  },
  {
    id: 'profile',
    label: 'Flame graph',
    caption: '64-bit cycle weights · BigInt totals',
    defaultNote: 'decodeBatch selfWeight = "9007199254740993" (> 2^53 - 1)',
    document: {
      version: 1,
      kind: 'profile',
      title: 'Query CPU cycles',
      description: '64-bit hardware cycle counters',
      unit: 'cycles',
      frames: [
        {
          id: 'root',
          name: 'executeQuery',
          selfWeight: '1200959900632132',
          file: 'executor.ts',
          line: 28
        },
        {
          id: 'scan',
          parentId: 'root',
          name: 'scanSegments',
          selfWeight: '2101679826106231',
          file: 'scanner.ts',
          line: 64
        },
        {
          id: 'decode',
          parentId: 'scan',
          name: 'decodeBatch',
          selfWeight: '9007199254740993',
          file: 'parquet.ts',
          line: 142
        },
        {
          id: 'decompress',
          parentId: 'decode',
          name: 'decompressPage',
          selfWeight: '5104079577686562',
          file: 'zstd.ts',
          line: 77
        },
        {
          id: 'filter',
          parentId: 'scan',
          name: 'evalPredicate',
          selfWeight: '3903119677054430',
          file: 'predicate.ts',
          line: 89
        },
        {
          id: 'bitmap',
          parentId: 'filter',
          name: 'intersectBitmaps',
          selfWeight: '3002399751580331',
          file: 'bitmap.ts',
          line: 41
        },
        {
          id: 'merge',
          parentId: 'root',
          name: 'mergeSketches',
          selfWeight: '4203359652212463',
          file: 'quantile.ts',
          line: 53
        },
        {
          id: 'heap',
          parentId: 'merge',
          name: 'compactHeap',
          selfWeight: '3302639726738364',
          file: 'heap.ts',
          line: 19
        }
      ]
    }
  }
];

export const principles: readonly LandingPrinciple[] = [
  {
    index: '01',
    title: 'String-backed precision',
    body: 'Timestamps, 64-bit counters, and high-precision decimals stay encoded as strings. Span durations and profile weights above 2^53 compute with BigInt instead of rounding to IEEE-754 floats.'
  },
  {
    index: '02',
    title: 'Explicit gaps and zeros',
    body: 'Null metric slots break line and area series cleanly to show missing observations, while real zeros remain plotted on the baseline. Empty inputs render an explicit empty state.'
  },
  {
    index: '03',
    title: 'Small, dependency-free runtime',
    body: 'Scalar views bundle in 4 KiB gzip, trace and flame views in ~20 KiB, and the complete runtime stays under 39 KiB gzip with zero runtime npm dependencies.'
  }
];

export const workflows: readonly LandingWorkflow[] = [
  {
    id: 'headless',
    title: 'Mount in TypeScript',
    blurb:
      'Render into any DOM container while keeping layout, controls, and selection state in your application.',
    header: 'npm install @scopedb/scopeview',
    docHref: '/headless.html',
    docLabel: 'Headless API',
    language: 'typescript',
    code: `import {
  createChart,
  enableInteractions
} from '@scopedb/scopeview/charts';

const view = createChart(container, snapshot, {
  theme: 'system',
  axes: 'minimal',
  onSelect(_target, context) {
    console.log(context?.rows);
  }
});

const stop = enableInteractions(view);`
  },
  {
    id: 'elements',
    title: 'Drop in Web Components',
    blurb:
      'Use <scope-chart>, <scope-trace>, and <scope-flame> with built-in legends, zoom, keyboard navigation, and data tables.',
    header: '@scopedb/scopeview/register',
    docHref: '/api.html',
    docLabel: 'Web Components',
    language: 'html',
    code: `<scope-trace id="trace"></scope-trace>

<script type="module">
  import '@scopedb/scopeview/register';
  import traceData from './trace.json' with { type: 'json' };

  const element = document.querySelector('#trace');
  element.configure({
    summary: true,
    inspector: true,
    toolbar: true
  });
  element.document = traceData;
</script>`
  },
  {
    id: 'cli',
    title: 'Export offline HTML from CLI',
    blurb:
      'Validate v1 JSON in terminal pipelines or CI and write a self-contained HTML report that opens without a server.',
    header: 'npx @scopedb/scopeview',
    docHref: '/cli.html',
    docLabel: 'CLI reference',
    language: 'shellscript',
    code: `# Print a built-in v1 fixture
npx @scopedb/scopeview example trace > trace.json

# Validate structure, fields, and precision rules
npx @scopedb/scopeview validate trace.json --json

# Bundle data and runtime into a standalone HTML file
npx @scopedb/scopeview render trace.json \\
  -o trace.html \\
  --json`
  },
  {
    id: 'agents',
    title: 'Hand off from coding agents',
    blurb:
      'Point Claude Code, Codex, or Cursor at /llms.txt so query answers and saved traces ship with an inspectable chart.',
    header: 'https://scopeview.scopedb.io/llms.txt',
    docHref: '/llms.txt',
    docLabel: 'llms.txt',
    language: 'shellscript',
    code: `# 1. Inspect the v1 JSON Schema (or read /llms.txt)
scopeview schema > schema.json

# 2. Keep 64-bit numbers as strings and gaps as null,
#    then check diagnostics before delivering HTML
scopeview validate report.json --json

scopeview render report.json \\
  -o report.html \\
  --json`
  }
];

export const familyGroups: readonly LandingFamilyGroup[] = [
  {
    category: 'Time & category axes',
    entryPoint: '@scopedb/scopeview/charts/axis',
    budget: '29 KiB gzip',
    description:
      'Multi-series trends, stacked totals, and categorical comparisons with explicit bucket coverage.',
    chips: [
      { label: 'Line', href: '/examples.html?family=line' },
      { label: 'Area', href: '/examples.html?family=area' },
      { label: 'Bar', href: '/examples.html?family=bar' }
    ]
  },
  {
    category: 'Distribution & summary',
    entryPoint: '@scopedb/scopeview/charts/*',
    budget: '4–27 KiB gzip',
    description:
      'Single-value KPIs, ranked service tables, proportional shares, and bivariate scatter plots.',
    chips: [
      { label: 'Value · 4 KiB', href: '/examples.html?family=value' },
      { label: 'Top list', href: '/examples.html?family=ranked' },
      { label: 'Donut', href: '/examples.html?family=donut' },
      { label: 'Treemap', href: '/examples.html?family=treemap' },
      { label: 'Scatter', href: '/examples.html?family=scatter' }
    ]
  },
  {
    category: 'Distributed traces',
    entryPoint: '@scopedb/scopeview/trace',
    budget: '21 KiB gzip',
    description:
      'Hierarchical span waterfalls with BigInt nanosecond intervals, error highlights, and keyboard traversal.',
    chips: [
      { label: 'Span waterfall', href: '/examples.html?family=trace' },
      { label: '<scope-trace>', href: '/trace-component.html' }
    ]
  },
  {
    category: 'Continuous profiling',
    entryPoint: '@scopedb/scopeview/profile',
    budget: '20 KiB gzip',
    description:
      'Call-tree flame graphs computing exact inclusive weights from string-encoded 64-bit self weights.',
    chips: [
      { label: 'Flame graph', href: '/examples.html?family=profile' },
      { label: '<scope-flame>', href: '/flame-component.html' }
    ]
  }
];

export const installOptions: readonly LandingInstallOption[] = [
  { id: 'npm', label: 'npm', command: 'npm install @scopedb/scopeview' },
  { id: 'pnpm', label: 'pnpm', command: 'pnpm add @scopedb/scopeview' },
  { id: 'bun', label: 'Bun', command: 'bun add @scopedb/scopeview' },
  {
    id: 'npx',
    label: 'CLI',
    command: 'npx @scopedb/scopeview example trace > trace.json'
  }
];
