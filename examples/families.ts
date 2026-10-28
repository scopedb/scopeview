import '../src/register.js';
import type { TraceDocument, ProfileDocument } from '../src/index.js';
import type {
  ScopeTraceElement,
  ScopeFlameElement,
  HierarchyInspectionDetail
} from '../src/element.js';

const trace = document.querySelector<ScopeTraceElement>('#trace')!;
const flame = document.querySelector<ScopeFlameElement>('#flame')!;
const origin = 1790643600000000001n;
const time = (ns: bigint) => (origin + ns).toString();
export const traceExample: TraceDocument = {
  version: 1,
  kind: 'trace',
  title: 'Query · parallel execution',
  coverage: 'partial',
  description: 'Exact nanosecond timestamps; overlapping workers retain independent rows.',
  spans: [
    {
      id: 'query',
      name: 'SELECT · logs',
      service: 'query',
      startTimeNs: time(0n),
      endTimeNs: time(100_000_000n)
    },
    {
      id: 'parse',
      parentId: 'query',
      name: 'parse SQL',
      service: 'query',
      startTimeNs: time(0n),
      endTimeNs: time(10_000_001n)
    },
    {
      id: 'worker-a',
      parentId: 'query',
      name: 'scan · worker A',
      service: 'storage',
      startTimeNs: time(12_000_000n),
      endTimeNs: time(76_000_000n)
    },
    {
      id: 'worker-b',
      parentId: 'query',
      name: 'scan · worker B',
      service: 'storage',
      startTimeNs: time(20_000_000n),
      endTimeNs: time(84_000_000n)
    },
    {
      id: 'read',
      parentId: 'worker-a',
      name: 'read object',
      service: 'storage',
      startTimeNs: time(14_000_000n),
      endTimeNs: time(60_000_000n)
    },
    {
      id: 'retry',
      parentId: 'worker-b',
      name: 'retry · timeout',
      service: 'storage',
      status: 'error',
      startTimeNs: time(40_000_000n),
      endTimeNs: time(48_000_000n)
    },
    {
      id: 'merge',
      parentId: 'query',
      name: 'merge results',
      service: 'query',
      startTimeNs: time(86_000_000n),
      endTimeNs: time(100_000_000n)
    },
    {
      id: 'instant',
      parentId: 'merge',
      name: 'emit · zero duration',
      startTimeNs: time(100_000_000n),
      endTimeNs: time(100_000_000n)
    },
    {
      id: 'orphan',
      parentId: 'not-supplied',
      name: 'external span',
      service: 'gateway',
      startTimeNs: time(10_000_000n),
      endTimeNs: time(22_000_000n)
    }
  ]
};
export const profileExample: ProfileDocument = {
  version: 1,
  kind: 'profile',
  unit: 'samples',
  title: 'Query · CPU profile',
  description: 'Self weights are supplied; inclusive widths are computed without double counting.',
  frames: [
    { id: 'query', name: 'executeQuery', selfWeight: '10' },
    { id: 'scan', parentId: 'query', name: 'scanSegments', selfWeight: '15' },
    {
      id: 'decode',
      parentId: 'scan',
      name: 'decodeBatch',
      selfWeight: '45',
      file: 'decoder.ts',
      line: 42
    },
    { id: 'filter', parentId: 'scan', name: 'evaluatePredicate', selfWeight: '20' },
    { id: 'merge', parentId: 'query', name: 'mergeResults', selfWeight: '10' },
    { id: 'zero', parentId: 'merge', name: 'idle · zero weight', selfWeight: '0' }
  ]
};
const small = () => {
  trace.document = traceExample;
  flame.document = profileExample;
};
document.querySelector('#small')!.addEventListener('click', small);
document.querySelector('#large')!.addEventListener('click', () => {
  trace.document = {
    version: 1,
    kind: 'trace',
    title: '10,000 parallel spans',
    coverage: 'complete',
    spans: Array.from({ length: 10_000 }, (_, i) => ({
      id: String(i),
      name: `worker ${i}`,
      startTimeNs: time(0n),
      endTimeNs: time(100_000_000n)
    }))
  };
});
document.querySelector('#deep')!.addEventListener('click', () => {
  flame.document = {
    version: 1,
    kind: 'profile',
    unit: 'samples',
    title: '2,000 stack frames',
    frames: Array.from({ length: 2000 }, (_, i) => ({
      id: String(i),
      name: `frame ${i}`,
      selfWeight: '1',
      ...(i ? { parentId: String(i - 1) } : {})
    }))
  };
});
for (const element of [trace, flame])
  element.addEventListener('scope-select', (event) => {
    const detail = (event as CustomEvent<HierarchyInspectionDetail>).detail;
    document.querySelector('#events')!.textContent = JSON.stringify(detail, null, 2);
  });
small();
