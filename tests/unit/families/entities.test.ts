import { describe, expect, it } from 'vitest';
import {
  compileTrace,
  createTraceView,
  layoutTrace,
  compileProfile,
  createProfileView,
  layoutProfile,
  compileVisualization,
  ViewportSession,
  SceneHitIndex,
  ChartSession,
  type TraceDocument,
  type ProfileDocument,
  type TraceSpan,
  type ProfileFrame
} from '../../../src/index.js';
import { RowIntervalIndex } from '../../../src/families/hierarchy/layout.js';

const base = 1_790_640_000_000_000_001n;
const trace = (): TraceDocument => ({
  version: 1,
  kind: 'trace',
  coverage: 'partial',
  spans: [
    { id: 'root', name: 'Request', startTimeNs: String(base), endTimeNs: String(base + 100n) },
    {
      id: 'a',
      parentId: 'root',
      name: 'Parallel A',
      startTimeNs: String(base + 10n),
      endTimeNs: String(base + 50n)
    },
    {
      id: 'b',
      parentId: 'root',
      name: 'Parallel B',
      startTimeNs: String(base + 20n),
      endTimeNs: String(base + 70n)
    },
    {
      id: 'c',
      parentId: 'root',
      name: 'Later',
      startTimeNs: String(base + 50n),
      endTimeNs: String(base + 80n)
    }
  ]
});
const profile = (): ProfileDocument => ({
  version: 1,
  kind: 'profile',
  unit: 'samples',
  frames: [
    { id: 'root', name: 'main', selfWeight: '2' },
    { id: 'a', parentId: 'root', name: 'parse', selfWeight: '3' },
    { id: 'b', parentId: 'root', name: 'query', selfWeight: '5' },
    { id: 'zero', parentId: 'b', name: 'unsampled', selfWeight: '0' }
  ]
});
const measure = (text: string) => text.length * 6;

describe('trace intervals and hierarchy', () => {
  it('keeps preview warnings while retaining non-error status in complete details and sources', () => {
    const document = trace();
    document.spans = document.spans.map((span, i) => ({
      ...span,
      status: i === 0 ? 'ok' : i === 1 ? 'unset' : 'error'
    }));
    document.spans.push({
      id: 'orphan',
      parentId: 'missing',
      name: 'Orphan',
      startTimeNs: String(base),
      endTimeNs: String(base + 1n),
      status: 'error'
    });
    const view = createTraceView(compileTrace(document));
    for (const id of ['root', 'a']) {
      const target = view.byId.get(id)!.interaction;
      expect(target.tooltip.previewRows?.some((row) => row.label === 'Status')).toBe(false);
      expect(target.tooltip.rows.find((row) => row.label === 'Status')?.value).toBe(
        target.sources[0].status
      );
    }
    expect(view.byId.get('orphan')!.interaction.tooltip.previewRows).toEqual([
      { label: 'Duration', value: '1 ns', format: 'number' },
      { label: 'Status', value: 'error', tone: 'danger' },
      { label: 'Relationships', value: 'Missing parent', tone: 'warning' }
    ]);
  });
  it('provides exact compact readings and marks cropped time boundaries for inspection', () => {
    const view = createTraceView(
      compileTrace({
        version: 1,
        kind: 'trace',
        spans: [{ id: 'x', name: 'Request', startTimeNs: '0', endTimeNs: '10000001' }]
      })
    );
    expect(view.byId.get('x')!.interaction.tooltip.previewRows).toEqual([
      { label: 'Duration', value: '10.000001 ms', format: 'number' }
    ]);
    expect(view.byId.get('x')!.interaction.tooltip.rows[0].value).toContain('10,000,001 ns');
    const scene = layoutTrace(view, 640, 180, measure, { start: 0.2, end: 0.6, scrollOffset: 0 });
    expect(scene.interactions[0].interval).toMatchObject({
      x: scene.rect!.x,
      width: scene.rect!.width,
      startClipped: true,
      endClipped: true
    });
    expect(scene.interactions[0].sources[0].endTimeNs).toBe('10000001');
  });
  it('preserves nanoseconds beyond Number precision and owns its source snapshot', () => {
    const input = trace(),
      compiled = compileTrace(input);
    input.spans[0] = { ...input.spans[0], name: 'changed' };
    expect(compiled.document.spans[0].name).toBe('Request');
    expect(compiled.startTimeNs).toBe(base);
    expect(compiled.durationNs).toBe(100n);
    expect(compiled.timings.get('a')!.duration).toBe(40n);
    const view = createTraceView(compiled);
    expect(view.byId.get('a')!.start).toBeCloseTo(0.1);
    expect(view.byId.get('a')!.interaction.sources[0]).toBe(compiled.document.spans[1]);
    expect(
      view.byId.get('a')!.interaction.tooltip.rows.find((row) => row.label === 'Start (ns)')!.value
    ).toBe(String(base + 10n));
  });
  it('unions overlapping children instead of summing parallel elapsed durations', () => {
    const compiled = compileTrace(trace());
    expect(compiled.timings.get('root')).toMatchObject({
      duration: 100n,
      coveredChildDuration: 70n,
      uncoveredDuration: 30n
    });
    expect(
      [...compiled.timings.values()].reduce((sum, value) => sum + value.duration, 0n)
    ).toBeGreaterThan(compiled.durationNs);
  });
  it('retains missing parents and out-of-parent intervals without repairing them', () => {
    const input = trace();
    input.spans.push({
      id: 'orphan',
      parentId: 'missing',
      name: 'Partial',
      startTimeNs: String(base - 5n),
      endTimeNs: String(base + 5n)
    });
    input.spans[1] = { ...input.spans[1], endTimeNs: String(base + 120n) };
    const compiled = compileTrace(input);
    expect(compiled.issues).toEqual(
      expect.arrayContaining([
        { kind: 'missing-parent', id: 'orphan', parentId: 'missing' },
        { kind: 'outside-parent', id: 'a', parentId: 'root' }
      ])
    );
    expect(compiled.timings.get('root')!.duration).toBe(100n);
    expect(compiled.startTimeNs).toBe(base - 5n);
    expect(compiled.durationNs).toBe(125n);
    expect(compiled.document.spans.at(-1)!.parentId).toBe('missing');
  });
  it('packs parallel siblings into separate lanes, reuses free lanes and collapses subtrees', () => {
    const compiled = compileTrace(trace()),
      view = createTraceView(compiled);
    expect(view.byId.get('a')!.row).not.toBe(view.byId.get('b')!.row);
    expect(view.byId.get('a')!.row).toBe(view.byId.get('c')!.row);
    expect(view.rowCount).toBe(3);
    const folded = createTraceView(compiled, new Set(['root']));
    expect(folded.items.map((item) => item.id)).toEqual(['root']);
    expect(compiled.document.spans).toHaveLength(4);
    expect(folded.byId.get('root')!.end).toBe(1);
  });
  it('keeps true zero intervals readable without inventing visible duration', () => {
    const input: TraceDocument = {
      version: 1,
      kind: 'trace',
      spans: [
        {
          id: 'zero',
          name: 'instant',
          startTimeNs: '1000000000000000001',
          endTimeNs: '1000000000000000001'
        }
      ]
    };
    const view = createTraceView(compileTrace(input)),
      scene = layoutTrace(view, 320, 180, measure);
    expect(scene.marks.filter((mark) => mark.kind === 'rect')).toHaveLength(0);
    expect(scene.navigation!.interactions).toHaveLength(1);
    expect(scene.navigation!.interactions[0].tooltip.rows[0].value).toBe('0 ns (0 ns)');
  });
});

describe('profile weights and flame layout', () => {
  it('uses explicit self weights and conserves inclusive widths and self gaps', () => {
    const compiled = compileProfile(profile()),
      view = createProfileView(compiled);
    expect(compiled.totalWeight).toBe(10n);
    expect(compiled.weights.get('root')).toEqual({ self: 2n, total: 10n, start: 0n, end: 10n });
    expect(compiled.weights.get('a')).toEqual({ self: 3n, total: 3n, start: 2n, end: 5n });
    expect(compiled.weights.get('b')).toEqual({ self: 5n, total: 5n, start: 5n, end: 10n });
    expect(view.byId.get('a')!.start).toBe(0.2);
    expect(view.byId.get('a')!.end).toBe(0.5);
    expect(view.byId.get('zero')!.interaction.sources[0].selfWeight).toBe('0');
  });
  it('retains large integer quantities, repeated names and incomplete forests', () => {
    const input = profile();
    input.frames[0] = { ...input.frames[0], selfWeight: '9007199254740993' };
    input.frames[1] = { ...input.frames[1], name: 'main' };
    input.frames.push({ id: 'orphan', parentId: 'missing', name: 'partial', selfWeight: '1' });
    const compiled = compileProfile(input),
      view = createProfileView(compiled);
    expect(compiled.totalWeight).toBe(9007199254741002n);
    expect(compiled.hierarchy.roots.map((frame) => frame.id)).toEqual(['root', 'orphan']);
    expect(view.byId.get('root')!.interaction.tooltip.rows[0].value).toBe(
      '9,007,199,254,740,993 samples'
    );
    expect(view.byId.get('root')!.interaction.tooltip.previewRows?.[0].value).toBe(
      '9,007,199,254,740,993 samples'
    );
    expect(view.byId.get('orphan')!.interaction.tooltip.previewRows).toContainEqual({
      label: 'Relationships',
      value: 'Missing parent',
      tone: 'warning'
    });
    expect(view.byId.get('a')!.interaction.sources[0].id).toBe('a');
  });
  it('collapses without moving or reweighting the remaining frames', () => {
    const compiled = compileProfile(profile()),
      before = createProfileView(compiled),
      folded = createProfileView(compiled, new Set(['b']));
    expect(folded.byId.has('zero')).toBe(false);
    expect(folded.byId.get('b')!.start).toBe(before.byId.get('b')!.start);
    expect(folded.byId.get('b')!.end).toBe(before.byId.get('b')!.end);
    expect(folded.byId.get('b')!.interaction.tooltip.rows).toEqual(
      before.byId.get('b')!.interaction.tooltip.rows
    );
  });
  it('validates deep hierarchies iteratively and rejects cyclic parents', () => {
    const input: ProfileDocument = {
      version: 1,
      kind: 'profile',
      unit: 'samples',
      frames: Array.from({ length: 5000 }, (_, i) => ({
        id: String(i),
        name: 'frame',
        selfWeight: '1',
        ...(i ? { parentId: String(i - 1) } : {})
      }))
    };
    const compiled = compileProfile(input);
    expect(compiled.totalWeight).toBe(5000n);
    expect(createProfileView(compiled).rowCount).toBe(5000);
    input.frames[0] = { ...input.frames[0], parentId: '4999' };
    expect(() => compileProfile(input)).toThrow(/cycle/);
  });
});

describe('family validation and virtualized reading', () => {
  it('keeps keyboard reading across passive pointer leave and clears it when its target disappears', () => {
    const view = createProfileView(compileProfile(profile())),
      session = new ChartSession<ProfileFrame>();
    session.setModel(view.navigation);
    session.inspect('profile:a', false, true);
    expect(session.keyboardInspection).toBe(true);
    expect(session.inspect(null)).toBe(false);
    expect(session.active?.key).toBe('profile:a');
    session.inspect('profile:b');
    expect(session.keyboardInspection).toBe(false);
    session.inspect(null);
    expect(session.active).toBeNull();
    session.inspect('profile:a', false, true);
    session.setModel(createProfileView(compileProfile(profile()), new Set(['root'])).navigation);
    expect(session.active).toBeNull();
    expect(session.keyboardInspection).toBe(false);
  });
  it('uses aligned readable ticks while preserving integer geometry', () => {
    const traceScene = layoutTrace(
      createTraceView(
        compileTrace({
          version: 1,
          kind: 'trace',
          spans: [{ id: 'x', name: 'Request', startTimeNs: '0', endTimeNs: '100000000' }]
        })
      ),
      640,
      180,
      measure
    );
    expect(traceScene.xTicks.map((tick) => tick.label)).toEqual([
      '0 ns',
      '20 ms',
      '40 ms',
      '60 ms',
      '80 ms',
      '100 ms'
    ]);
    const profileScene = layoutProfile(
      createProfileView(
        compileProfile({
          version: 1,
          kind: 'profile',
          unit: 'samples',
          frames: [{ id: 'x', name: 'main', selfWeight: '100' }]
        })
      ),
      440,
      180,
      measure
    );
    expect(profileScene.xTicks.map((tick) => tick.label)).toEqual(['0', '25', '50', '75', '100']);
  });
  it('positions tiny integer ticks at their actual values and retains readable precision after zoom', () => {
    for (const duration of [0n, 1n, 3n]) {
      const view = createTraceView(
        compileTrace({
          version: 1,
          kind: 'trace',
          spans: [
            { id: 'x', name: 'tiny', startTimeNs: String(base), endTimeNs: String(base + duration) }
          ]
        })
      );
      const scene = layoutTrace(view, 640, 180, measure);
      const labels = scene.xTicks.map((tick) => tick.label);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels).toEqual(Array.from({ length: Number(duration) + 1 }, (_, i) => `${i} ns`));
      for (const tick of scene.xTicks)
        expect(tick.position).toBeCloseTo(
          scene.rect!.x +
            (duration ? Number.parseInt(tick.label, 10) / Number(duration) : 0) * scene.rect!.width
        );
    }
    const view = createTraceView(
      compileTrace({
        version: 1,
        kind: 'trace',
        spans: [{ id: 'x', name: 'zoom', startTimeNs: '0', endTimeNs: '100000000' }]
      })
    );
    const scene = layoutTrace(view, 640, 180, measure, {
      start: 0.9,
      end: 0.90000006,
      scrollOffset: 0
    });
    expect(new Set(scene.xTicks.map((tick) => tick.label)).size).toBeGreaterThan(1);
    expect(
      scene.xTicks.every((tick) => tick.label.startsWith('90.00000') || tick.label === '90 ms')
    ).toBe(true);
  });
  it('rejects malformed timestamps, weights, duplicate identity and unsafe metadata', () => {
    for (const value of ['1.5', 'NaN', '', '1e3', '9'.repeat(41)]) {
      const input = trace();
      input.spans[0] = { ...input.spans[0], startTimeNs: value };
      expect(() => compileTrace(input)).toThrow(/spans\[0\].startTimeNs/);
    }
    const t = trace();
    t.spans[0] = { ...t.spans[0], endTimeNs: String(base - 1n) };
    expect(() => compileTrace(t)).toThrow(/endTimeNs/);
    const p = profile();
    p.frames[0] = { ...p.frames[0], selfWeight: '-1' };
    expect(() => compileProfile(p)).toThrow(/selfWeight/);
    p.frames[0] = { ...p.frames[1] };
    expect(() => compileProfile(p)).toThrow(/Duplicate identity/);
    expect(() => compileVisualization({ kind: 'unknown', version: 1 })).toThrow(/kind/);
    expect(() => compileTrace({ ...trace(), coverage: ['partial'] })).toThrow(/coverage/);
    expect(() =>
      compileTrace({ ...trace(), spans: [{ ...trace().spans[0], status: ['ok'] }] })
    ).toThrow(/status/);
    expect(() =>
      compileTrace({
        ...trace(),
        spans: [{ ...trace().spans[0], attributes: { secret: { script: 'bad' } } }]
      })
    ).toThrow(/attributes/);
  });
  it('bounds painted rows and keeps the complete logical order and exact sources', () => {
    const input: TraceDocument = {
      version: 1,
      kind: 'trace',
      spans: Array.from({ length: 10_000 }, (_, i) => ({
        id: String(i),
        name: 'parallel',
        startTimeNs: String(base),
        endTimeNs: String(base + 10n)
      }))
    };
    const compiled = compileTrace(input),
      view = createTraceView(compiled),
      scene = layoutTrace(view, 640, 180, measure, { start: 0, end: 1, scrollOffset: 24 * 5000 });
    expect(scene.navigation!.interactions).toHaveLength(10_000);
    expect(scene.marks.length).toBeLessThan(20);
    expect(scene.interactions.length).toBeLessThan(8);
    const session = new ChartSession<TraceSpan>();
    session.setModel(scene.navigation!);
    expect(session.next('End')!.key).toBe('trace:9999');
    const first = scene.interactions[0];
    expect(new SceneHitIndex(scene).hit({ x: first.anchor.x, y: first.anchor.y })?.key).toBe(
      first.key
    );
  });
  it('culls off-window intervals but reconciles a pin against the logical model', () => {
    const view = createProfileView(compileProfile(profile())),
      full = layoutProfile(view, 640, 180, measure),
      clipped = layoutProfile(view, 640, 180, measure, { start: 0.75, end: 1, scrollOffset: 0 });
    const session = new ChartSession<ProfileFrame>();
    session.setModel(full.navigation!);
    session.inspect('profile:a', true);
    session.setModel(clipped.navigation!);
    expect(clipped.interactionByKey.has('profile:a')).toBe(false);
    expect(session.pinned).toBe(true);
    expect(session.active!.sources[0].id).toBe('a');
    expect(
      clipped.marks
        .filter((mark) => mark.kind === 'rect')
        .every(
          (mark) =>
            mark.x >= clipped.rect!.x &&
            mark.x + mark.width <= clipped.rect!.x + clipped.rect!.width + 1e-9
        )
    ).toBe(true);
  });
});

describe('viewport session', () => {
  it('rejects unbounded interval queries and clamps large row ranges to the index', () => {
    const view = createProfileView(compileProfile(profile()));
    expect(() => view.index.query(0, 1, 0, Infinity)).toThrow(/query/);
    expect(() => view.index.query(0, 1, 0.5, 1)).toThrow(/query/);
    expect(view.index.query(0, 1, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(4);
    expect(new RowIntervalIndex<ProfileFrame>([]).query(0, 1, 0, 100)).toHaveLength(0);
    const item = view.items[0];
    expect(() => new RowIntervalIndex([item, { ...item, id: 'overlap' }])).toThrow(/overlap/);
    expect(() => new RowIntervalIndex([{ ...item, row: Infinity }])).toThrow(/interval/);
    const sparse = new RowIntervalIndex([{ ...item, row: Number.MAX_SAFE_INTEGER }]);
    expect(sparse.query(0, 1, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });
  it('zooms around the cursor, clamps pan/scroll and reconciles changed bounds', () => {
    const view = new ViewportSession();
    view.configure({ contentHeight: 1000, visibleHeight: 200 });
    view.zoom(2, 0.25);
    expect(view.state.start + 0.25 * (view.state.end - view.state.start)).toBe(0.25);
    view.pan(100);
    expect(view.state.end).toBe(1);
    view.scroll(2000);
    expect(view.state.scrollOffset).toBe(800);
    view.configure({ contentHeight: 100, visibleHeight: 200 });
    expect(view.state.scrollOffset).toBe(0);
    view.reset();
    expect(view.state).toEqual({ start: 0, end: 1, scrollOffset: 0 });
  });
  it('reveals an off-screen logical target and rejects invalid geometry', () => {
    const view = new ViewportSession();
    view.configure({ contentHeight: 1000, visibleHeight: 100 });
    view.zoom(10, 0);
    view.reveal(0.8, 0.85, 500, 524);
    expect(view.state.start).toBeLessThanOrEqual(0.8);
    expect(view.state.end).toBeGreaterThanOrEqual(0.85);
    expect(view.state.scrollOffset).toBe(424);
    expect(() => view.zoom(0)).toThrow();
    expect(() => view.pan(NaN)).toThrow();
    expect(() => view.set({ start: 1, end: 0, scrollOffset: 0 })).toThrow();
    expect(() => view.configure({ contentHeight: Infinity, visibleHeight: 100 })).toThrow();
  });
});
