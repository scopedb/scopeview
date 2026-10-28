import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import {
  ChartLinkGroup,
  buildChartDataset,
  createChartSpec,
  fieldRef,
  snapTimeRange,
  type ResultSet,
  type ChartDocument,
  type ChartLinkState,
  type LinkedHighlight,
  type ViewState,
  type ViewportState
} from '../src/index.js';
import {
  bindChartLinks,
  type ScopeChartElement,
  type ScopeTraceElement,
  type ScopeFlameElement,
  type ScopeInspectionDetail,
  type HierarchyInspectionDetail
} from '../src/element.js';
import { traceDocument, profileDocument } from './embedding-data.js';

const activity = document.querySelector<ScopeChartElement>('#activity')!;
const latency = document.querySelector<ScopeChartElement>('#latency')!;
for (const chart of [activity, latency]) chart.configure({ axes: 'minimal', legend: true });
const trace = document.querySelector<ScopeTraceElement>('#trace')!;
const profile = document.querySelector<ScopeFlameElement>('#profile')!;
const charts = [activity, latency, trace, profile];
const group = new ChartLinkGroup();
const startNs = BigInt(traceDocument.spans[0].startTimeNs),
  endNs = BigInt(traceDocument.spans[0].endTimeNs);
const startMs = Number(startNs / 1_000_000n),
  intervalMs = 10;
const metricWindow = { start: startMs, end: startMs + 100 };
const feedback = document.querySelector('#feedback')!;
let revision = 1,
  removed = false,
  restoring = false;

function metricDocument(name: string, values: number[]): ChartDocument {
  const data: ResultSet = {
    fields: [
      { name: 'time', data_type: 'timestamp' },
      { name, data_type: 'number' },
      { name: 'Baseline', data_type: 'number' }
    ],
    rows: values.map((value, index) => [
      new Date(startMs + index * intervalMs).toISOString(),
      String(value + (revision - 1) * 4),
      String(Math.round(value * 0.7))
    ])
  };
  const dataset = buildChartDataset(data);
  return {
    version: 1,
    title: name === 'Records' ? 'Records processed' : 'Latency by bucket',
    description: '10 ms buckets · one supplied query',
    data,
    spec: createChartSpec(dataset, {
      displayType: name === 'Records' ? 'bar' : 'line',
      mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1', 'result-column-2'] },
      stack: false
    }),
    options: { stack: false },
    semantics: {
      time: {
        kind: 'buckets',
        field: fieldRef(dataset, 'result-column-0'),
        intervalMs,
        window: metricWindow,
        coverage: 'complete',
        valueKind: 'number'
      }
    }
  };
}
function setDocuments(preserveViewState = false) {
  activity.updateDocument(metricDocument('Records', [8, 24, 56, 72, 68, 91, 85, 65, 43, 12]), {
    preserveViewState
  });
  latency.updateDocument(metricDocument('Latency (ms)', [2, 3, 8, 11, 15, 13, 12, 9, 6, 2]), {
    preserveViewState
  });
  const spans = structuredClone(traceDocument);
  spans.spans = spans.spans
    .filter((span) => !removed || !['scan', 'decode'].includes(span.id))
    .map((span) => ({ ...span, attributes: { snapshot: String(revision) } }));
  trace.updateDocument(spans, { preserveViewState });
  const frames = structuredClone(profileDocument);
  frames.frames = frames.frames
    .filter((frame) => !removed || !['scan', 'decode', 'filter'].includes(frame.id))
    .map((frame) => ({
      ...frame,
      selfWeight: String(BigInt(frame.selfWeight) + BigInt(revision - 1))
    }));
  profile.updateDocument(frames, { preserveViewState });
}
function fraction(timeNs: string | null, start: bigint, end: bigint): number | null {
  if (timeNs === null || end <= start) return null;
  const time = BigInt(timeNs);
  return time < start || time > end
    ? null
    : Number(((time - start) * 1_000_000_000_000n) / (end - start)) / 1e12;
}
function metricProjection(state: ChartLinkState): LinkedHighlight {
  return {
    inspectionKey: null,
    cursor: fraction(
      state.cursorTimeNs,
      BigInt(metricWindow.start) * 1_000_000n,
      BigInt(metricWindow.end) * 1_000_000n
    )
  };
}
const operationToFrame: Record<string, string> = {
  query: 'root',
  plan: 'root',
  scan: 'scan',
  worker: 'scan',
  decode: 'decode'
};
const frameToOperation: Record<string, string> = {
  root: 'query',
  scan: 'scan',
  decode: 'decode',
  filter: 'scan',
  merge: 'query'
};
function operation(state: ChartLinkState): string | null {
  return state.selection?.namespace === 'query-operation' ? state.selection.id : null;
}
function bindRanges(state = group.state) {
  const value = state.window
    ? snapTimeRange(
        Number(BigInt(state.window.startTimeNs) / 1_000_000n),
        Number((BigInt(state.window.endTimeNs) + 999_999n) / 1_000_000n),
        metricWindow,
        intervalMs
      )
    : null;
  for (const chart of [activity, latency]) {
    chart.rangeSelection = {
      snapshot: chart,
      value,
      onCommit(value) {
        metricMembers.get(chart)!.window({
          startTimeNs: String(BigInt(value.start) * 1_000_000n),
          endTimeNs: String(BigInt(value.end) * 1_000_000n)
        });
        bindRanges();
        showLinks();
      },
      onDismiss() {
        metricMembers.get(chart)!.window(null);
        bindRanges();
        showLinks();
      }
    };
  }
}
const metricMembers = new Map<ScopeChartElement, ReturnType<typeof bindChartLinks>>();
const bindings = [activity, latency].map((chart) => {
  const member = bindChartLinks<ScopeInspectionDetail>(chart, group, {
    id: chart.id,
    cursor: (detail) =>
      detail.cursorTimeMs == null ? null : String(BigInt(detail.cursorTimeMs) * 1_000_000n),
    project: ({ state }) => metricProjection(state),
    receive: (update) => {
      if (update.changed === 'window' || update.changed === 'restore') bindRanges(update.state);
    }
  });
  metricMembers.set(chart, member);
  return member;
});
bindings.push(
  bindChartLinks<HierarchyInspectionDetail>(trace, group, {
    id: 'trace',
    cursor: (detail) => {
      const span = detail.sources[0] as (typeof traceDocument.spans)[number] | undefined;
      return span?.startTimeNs ?? null;
    },
    selection: (detail) =>
      detail.pinned && detail.sources[0]
        ? { namespace: 'query-operation', id: detail.sources[0].id }
        : null,
    project: ({ state }) => {
      const id = operation(state),
        span = trace.document?.spans.find((span) => span.id === id);
      const start =
        startNs +
        (BigInt(Math.round(trace.viewport.start * 1e12)) * (endNs - startNs)) / 1_000_000_000_000n;
      const end =
        startNs +
        (BigInt(Math.round(trace.viewport.end * 1e12)) * (endNs - startNs)) / 1_000_000_000_000n;
      return {
        inspectionKey: span ? `trace:${span.id}` : null,
        cursor: fraction(state.cursorTimeNs, start, end)
      };
    },
    receive: (update) => {
      if (restoring || (update.changed !== 'window' && update.changed !== 'restore')) return;
      if (!update.state.window) {
        trace.resetViewport();
        return;
      }
      const start = fraction(
        String(
          BigInt(update.state.window.startTimeNs) < startNs
            ? startNs
            : BigInt(update.state.window.startTimeNs)
        ),
        startNs,
        endNs
      );
      const end = fraction(
        String(
          BigInt(update.state.window.endTimeNs) > endNs
            ? endNs
            : BigInt(update.state.window.endTimeNs)
        ),
        startNs,
        endNs
      );
      if (start !== null && end !== null && start < end)
        trace.viewport = { ...trace.viewport, start, end };
    },
    viewportWindow: (detail) => {
      const viewport = detail as ViewportState;
      if (viewport.start === 0 && viewport.end === 1) return null;
      const at = (value: number) =>
        String(
          startNs + (BigInt(Math.round(value * 1e12)) * (endNs - startNs)) / 1_000_000_000_000n
        );
      return { startTimeNs: at(viewport.start), endTimeNs: at(viewport.end) };
    }
  })
);
bindings.push(
  bindChartLinks<HierarchyInspectionDetail>(profile, group, {
    id: 'profile',
    selection: (detail) =>
      detail.pinned && detail.sources[0] && frameToOperation[detail.sources[0].id]
        ? { namespace: 'query-operation', id: frameToOperation[detail.sources[0].id] }
        : null,
    project: ({ state }) => {
      const id = operation(state),
        frame = id && operationToFrame[id];
      return {
        inspectionKey:
          frame && profile.document?.frames.some((source) => source.id === frame)
            ? `profile:${frame}`
            : null,
        cursor: null
      };
    }
  })
);
function showLinks() {
  const state = group.state;
  const elapsed = (ns: string) =>
    String(Number((Number(BigInt(ns) - startNs) / 1_000_000).toFixed(2)));
  document.querySelector('#linked-cursor')!.textContent = state.cursorTimeNs
    ? `${elapsed(state.cursorTimeNs)} ms`
    : '—';
  document.querySelector('#linked-window')!.textContent = state.window
    ? `${elapsed(state.window.startTimeNs)}–${elapsed(state.window.endTimeNs)} ms`
    : 'Full query';
  document.querySelector('#linked-selection')!.textContent = state.selection?.id ?? 'None selected';
}
bindings.push(group.connect('summary', showLinks));

interface SavedAnalysis {
  version: 1;
  views: ViewState[];
  links: ChartLinkState;
}
const storageKey = 'scopeview-linked-analysis-v1';
function capture(): SavedAnalysis {
  return {
    version: 1,
    views: charts.map((chart) => chart.viewState),
    links: { ...group.state, cursorTimeNs: null }
  };
}
const beforePointerAction = new Map<EventTarget, SavedAnalysis>();
// Capture before normal outside dismissal. Saving/updating from the host toolbar must
// operate on the reading visible when the user presses the button.
for (const button of document.querySelectorAll('.controls button, #theme')) {
  button.addEventListener('pointerdown', () => beforePointerAction.set(button, capture()));
}
function actionState(event: Event) {
  const snapshot = beforePointerAction.get(event.currentTarget!) ?? capture();
  beforePointerAction.delete(event.currentTarget!);
  return snapshot;
}
function restoreAnalysis(snapshot: SavedAnalysis) {
  restoring = true;
  try {
    group.state = snapshot.links;
    [activity, latency].forEach((chart, index) => {
      chart.viewState = snapshot.views[index] as typeof chart.viewState;
    });
    trace.viewState = snapshot.views[2] as typeof trace.viewState;
    profile.viewState = snapshot.views[3] as typeof profile.viewState;
  } finally {
    restoring = false;
  }
}
let saved: SavedAnalysis | null = null;
try {
  saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as SavedAnalysis | null;
} catch {
  /* Storage is optional in embedded hosts. */
}
function showSaved() {
  document.querySelector<HTMLButtonElement>('#restore')!.disabled = !saved;
  document.querySelector('#saved-state')!.textContent = saved
    ? JSON.stringify(saved, null, 2)
    : 'Save a view to inspect its portable state.';
}
document.querySelector('#save')!.addEventListener('click', (event) => {
  saved = actionState(event);
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    /* In-memory saving still works. */
  }
  showSaved();
  feedback.textContent = 'View saved · pins, legends, windows and collapsed nodes';
});
document.querySelector('#restore')!.addEventListener('click', () => {
  if (!saved || saved.version !== 1) return;
  restoreAnalysis(saved);
  bindRanges();
  showLinks();
  feedback.textContent = 'Saved view restored';
});
document.querySelector('#reset')!.addEventListener('click', () => {
  group.state = { cursorTimeNs: null, window: null, selection: null };
  removed = false;
  revision = 1;
  setDocuments();
  bindRanges();
  showLinks();
  feedback.textContent = 'Synthetic query · snapshot 1';
});
document.querySelector('#update')!.addEventListener('click', (event) => {
  restoreAnalysis(actionState(event));
  revision++;
  setDocuments(true);
  bindRanges();
  feedback.textContent = `Snapshot ${revision} · valid view state preserved`;
});
document.querySelector('#remove')!.addEventListener('click', (event) => {
  restoreAnalysis(actionState(event));
  removed = true;
  setDocuments(true);
  bindRanges();
  group.state = { ...group.state, selection: null };
  showLinks();
  feedback.textContent = 'Scan operation removed · missing targets cleared';
});
document.querySelector('#theme')!.addEventListener('click', (event) => {
  restoreAnalysis(actionState(event));
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  (event.currentTarget as HTMLElement).textContent = dark ? 'Light theme' : 'Dark theme';
  charts.forEach((chart) => {
    chart.refresh();
  });
});
setDocuments();
bindRanges();
showSaved();
window.addEventListener(
  'pagehide',
  () =>
    bindings.forEach((binding) => {
      binding.disconnect();
    }),
  {
    once: true
  }
);
