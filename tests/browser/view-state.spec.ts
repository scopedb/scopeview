import { expect, test, type Page } from '@playwright/test';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';
import type { ViewStateChangeDetail } from '../../src/index.js';
import { sceneFor, settleRendering } from './scene.js';

async function ready(page: Page) {
  await page.goto('/examples/linked-analysis.html');
  await expect(page.locator('[data-state=ready]')).toHaveCount(4);
  await settleRendering(page);
}

test('metric JSON state restores idempotently, owns its arrays, and reconciles new source data', async ({
  page
}) => {
  await ready(page);
  const chart = page.locator('#activity');
  await chart.evaluate((node) => {
    const chart = node as ScopeChartElement;
    chart.viewState = {
      version: 1,
      kind: 'metric',
      pinnedKey: `time:${Date.parse(chart.document!.data.rows[0][0]!)}`,
      hiddenSeries: ['Baseline', 'unknown']
    };
  });
  await expect(chart.locator('.tooltip')).toContainText('Selected');
  await expect(chart.locator('.legend button').last()).toHaveAttribute('aria-pressed', 'false');
  await chart.evaluate((node) => {
    const chart = node as ScopeChartElement,
      state = JSON.parse(JSON.stringify(chart.viewState));
    chart.viewState = state;
    state.hiddenSeries.length = 0;
    const doc = chart.document!;
    doc.data.rows = doc.data.rows
      .toReversed()
      .map((row) => [row[0], String(Number(row[1]) + 100), row[2]]);
    chart.updateDocument(doc, { preserveViewState: true });
  });
  await expect(chart.locator('.tooltip')).toContainText('108');
  expect(
    await chart.evaluate((node) => (node as ScopeChartElement).viewState.hiddenSeries)
  ).toEqual(['Baseline']);
  await chart.evaluate((node) => {
    const chart = node as ScopeChartElement,
      doc = chart.document!;
    doc.data.rows = doc.data.rows.filter(
      (row) => Date.parse(row[0]!) !== Number(chart.viewState.pinnedKey!.slice(5))
    );
    chart.updateDocument(doc, { preserveViewState: true });
  });
  await expect
    .poll(() => chart.evaluate((node) => (node as ScopeChartElement).viewState.pinnedKey))
    .toBeNull();
  await expect(chart.locator('.tooltip')).toBeHidden();
  expect(
    await chart.evaluate((node) => (node as ScopeChartElement).viewState.hiddenSeries)
  ).toEqual(['Baseline']);
});

test('hierarchy state restores before mount, clamps scroll after layout and preserves exact source inspection', async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() => {
    const original = document.querySelector<ScopeTraceElement>('#trace')!;
    const chart = document.createElement('scope-trace');
    chart.id = 'restored-trace';
    chart.document = original.document;
    chart.viewState = {
      version: 1,
      kind: 'trace',
      pinnedKey: 'trace:scan',
      viewport: { start: 0.1, end: 0.8, scrollOffset: 1000 },
      collapsed: ['worker', 'missing']
    };
    document.querySelector('main')!.append(chart);
  });
  const chart = page.locator('#restored-trace');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await expect(chart.locator('.tooltip')).toContainText('1790643600014000001');
  const state = await chart.evaluate((node) => (node as ScopeTraceElement).viewState);
  expect(state.viewport).toEqual({ start: 0.1, end: 0.8, scrollOffset: 0 });
  expect(state.collapsed).toEqual(['worker']);
  await chart.evaluate((node) => {
    const chart = node as ScopeTraceElement,
      state = JSON.parse(JSON.stringify(chart.viewState));
    chart.viewState = state;
    state.viewport.start = 0;
    state.collapsed.length = 0;
    const doc = chart.document!;
    doc.spans = doc.spans
      .toReversed()
      .map((span) => ({ ...span, name: span.id === 'scan' ? 'scan · next snapshot' : span.name }));
    chart.updateDocument(doc, { preserveViewState: true });
  });
  await expect(chart.locator('.tooltip')).toContainText('scan · next snapshot');
  expect(await chart.evaluate((node) => (node as ScopeTraceElement).viewState)).toEqual(state);
  await chart.evaluate((node) => {
    const chart = node as ScopeTraceElement,
      doc = chart.document!;
    doc.spans = doc.spans.filter((span) => span.id !== 'scan');
    chart.updateDocument(doc, { preserveViewState: true });
  });
  await expect
    .poll(() => chart.evaluate((node) => (node as ScopeTraceElement).viewState.pinnedKey))
    .toBeNull();
  await expect(chart.locator('.tooltip')).toBeHidden();
});

test('profile restores pins, rejects other families atomically and clears pins hidden by collapse', async ({
  page
}) => {
  await ready(page);
  const chart = page.locator('#profile');
  await chart.evaluate((node) => {
    (node as ScopeFlameElement).viewState = {
      version: 1,
      kind: 'profile',
      pinnedKey: 'profile:decode',
      collapsed: [],
      viewport: { start: 0.2, end: 0.9, scrollOffset: 0 }
    };
  });
  await expect(chart.locator('.tooltip')).toContainText('decoder.ts:42');
  expect(
    await chart.evaluate((node) => {
      const chart = node as ScopeFlameElement,
        before = JSON.stringify(chart.viewState);
      try {
        chart.viewState = { ...chart.viewState, kind: 'trace' };
      } catch {
        /* Expected family rejection. */
      }
      return JSON.stringify(chart.viewState) === before;
    })
  ).toBe(true);
  await chart.evaluate((node) => {
    const chart = node as ScopeFlameElement;
    chart.viewState = { ...chart.viewState, collapsed: ['scan'] };
  });
  await expect
    .poll(() => chart.evaluate((node) => (node as ScopeFlameElement).viewState.pinnedKey))
    .toBeNull();
  await expect(chart.locator('.tooltip')).toBeHidden();
});

test('default document assignment resets durable state and hover never enters it', async ({
  page
}) => {
  await ready(page);
  const chart = page.locator('#activity'),
    scene = await sceneFor(page, '#activity');
  await page.mouse.move(
    scene.frame.x + scene.interactions[2].anchor.x,
    scene.frame.y + scene.interactions[2].anchor.y
  );
  await expect(chart.locator('.tooltip')).toBeVisible();
  expect(
    await chart.evaluate((node) => (node as ScopeChartElement).viewState.pinnedKey)
  ).toBeNull();
  await chart.evaluate((node) => {
    const chart = node as ScopeChartElement;
    chart.viewState = {
      ...chart.viewState,
      hiddenSeries: ['Baseline'],
      pinnedKey: `time:${Date.parse(chart.document!.data.rows[0][0]!)}`
    };
  });
  await expect(chart.locator('.tooltip')).toContainText('Selected');
  await chart.evaluate((node) => {
    const chart = node as ScopeChartElement;
    const doc = chart.document;
    chart.document = doc;
  });
  await expect(chart.locator('.tooltip')).toBeHidden();
  await expect(chart.locator('.legend button').last()).toHaveAttribute('aria-pressed', 'true');
});

test('temporary loading and repaint preserve durable state, and restoration does not loop through a controlled host', async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() => {
    for (const id of ['activity', 'trace', 'profile']) {
      const chart = document.getElementById(id) as
        | ScopeChartElement
        | ScopeTraceElement
        | ScopeFlameElement;
      let changes = 0;
      chart.addEventListener('scope-view-state-change', (event) => {
        changes++;
        if (changes > 10) throw new Error('View state feedback loop');
        const detail = (event as CustomEvent<ViewStateChangeDetail>).detail;
        chart.viewState = detail.state as typeof chart.viewState;
      });
      chart.viewState = {
        ...chart.viewState,
        pinnedKey:
          id === 'activity'
            ? `time:${Date.parse((chart as ScopeChartElement).document!.data.rows[0][0]!)}`
            : id === 'trace'
              ? 'trace:scan'
              : 'profile:decode'
      } as typeof chart.viewState;
    }
  });
  for (const id of ['activity', 'trace', 'profile'])
    await expect(page.locator(`#${id} .tooltip`)).toContainText(
      id === 'activity' ? 'Selected' : 'Pinned'
    );
  const before = await page.evaluate(() =>
    ['activity', 'trace', 'profile'].map(
      (id) => (document.getElementById(id) as ScopeChartElement | ScopeTraceElement).viewState
    )
  );
  await page.evaluate(() => {
    for (const id of ['activity', 'trace', 'profile'])
      (document.getElementById(id) as ScopeChartElement).loading = true;
  });
  await expect(page.locator('[data-state=loading]')).toHaveCount(3);
  await page.evaluate(() => {
    for (const id of ['activity', 'trace', 'profile']) {
      const chart = document.getElementById(id) as ScopeChartElement;
      chart.loading = false;
      chart.refresh();
    }
  });
  for (const id of ['activity', 'trace', 'profile'])
    await expect(page.locator(`#${id} .tooltip`)).toContainText(
      id === 'activity' ? 'Selected' : 'Pinned'
    );
  expect(
    await page.evaluate(() =>
      ['activity', 'trace', 'profile'].map(
        (id) => (document.getElementById(id) as ScopeChartElement | ScopeTraceElement).viewState
      )
    )
  ).toEqual(before);
});

test('linked hover draws a peer guide without pinning, moving focus or opening peer inspectors', async ({
  page
}) => {
  await ready(page);
  const scene = await sceneFor(page, '#latency'),
    point = scene.interactions[3].anchor;
  await page.mouse.move(scene.frame.x + point.x, scene.frame.y + point.y);
  await expect(page.locator('#latency .tooltip')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('#activity')
        .evaluate((node) => (node as ScopeChartElement).linkedHighlight?.cursor)
    )
    .toBe(0.3);
  await expect
    .poll(() =>
      page.locator('#trace').evaluate((node) => (node as ScopeTraceElement).linkedHighlight?.cursor)
    )
    .toBeGreaterThan(0.29);
  await expect(page.locator('#activity .tooltip')).toBeHidden();
  await expect(page.locator('#trace .tooltip')).toBeHidden();
  expect(
    await page
      .locator('#profile')
      .evaluate((node) => (node as ScopeFlameElement).linkedHighlight?.cursor)
  ).toBeNull();
  await page.mouse.move(2, 2);
  await expect
    .poll(() =>
      page
        .locator('#activity')
        .evaluate((node) => (node as ScopeChartElement).linkedHighlight?.cursor)
    )
    .toBeNull();
});

test('time range and trace zoom share their window while profile retains its weight viewport', async ({
  page
}) => {
  await ready(page);
  await page.locator('#activity').evaluate((node) => {
    const chart = node as ScopeChartElement,
      binding = chart.rangeSelection!;
    const start = Date.parse(chart.document!.data.rows[2][0]!),
      end = Date.parse(chart.document!.data.rows[7][0]!);
    binding.onCommit({ start, end }, binding.snapshot);
  });
  await expect
    .poll(() =>
      page.locator('#trace').evaluate((node) => (node as ScopeTraceElement).viewport.start)
    )
    .toBeGreaterThan(0.19);
  expect(
    await page
      .locator('#latency')
      .evaluate((node) => (node as ScopeChartElement).rangeSelection!.value)
  ).not.toBeNull();
  expect(
    await page.locator('#profile').evaluate((node) => (node as ScopeFlameElement).viewport)
  ).toEqual({ start: 0, end: 1, scrollOffset: 0 });
  await page.locator('#trace .zoom-in').click();
  await expect
    .poll(() =>
      page
        .locator('#trace')
        .evaluate(
          (node) =>
            (node as ScopeTraceElement).viewport.end - (node as ScopeTraceElement).viewport.start
        )
    )
    .toBeCloseTo(0.25, 5);
  await expect(page.locator('#linked-window')).not.toHaveText('Full query');
});

test('entity links preserve local pins and exact source reads; saved view restores across reload', async ({
  page
}) => {
  await ready(page);
  await page
    .locator('#trace')
    .evaluate((node) => (node as ScopeTraceElement).focusNode('decode', { pin: true }));
  await expect(page.locator('#trace .tooltip')).toContainText('1790643600020000001');
  await expect
    .poll(() =>
      page
        .locator('#profile')
        .evaluate((node) => (node as ScopeFlameElement).linkedHighlight?.inspectionKey)
    )
    .toBe('profile:decode');
  await expect(page.locator('#profile .tooltip')).toBeHidden();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.locator('#reset').click();
  await page.getByRole('button', { name: 'Restore view', exact: true }).click();
  await expect(page.locator('#trace .tooltip')).toContainText('Pinned');
  await page.reload();
  await expect(page.locator('[data-state=ready]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Restore view', exact: true }).click();
  await expect(page.locator('#trace .tooltip')).toContainText('1790643600020000001');
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('#trace .root')).toHaveCSS('background-color', 'rgb(26, 32, 41)');
  await expect(page.locator('#linked-selection')).toHaveCSS('color', 'rgb(220, 226, 235)');
  await expect(page.locator('#trace .tooltip')).toContainText('Pinned');
  await settleRendering(page);
});

test('host snapshot update keeps the pressed reading, and removing its identity dismisses it', async ({
  page
}) => {
  await ready(page);
  await page
    .locator('#trace')
    .evaluate((node) => (node as ScopeTraceElement).focusNode('scan', { pin: true }));
  await page.getByRole('button', { name: 'Update snapshot', exact: true }).click();
  await expect(page.locator('#trace .tooltip')).toContainText('Pinned');
  await expect
    .poll(() =>
      page
        .locator('#trace')
        .evaluate(
          (node) =>
            (node as ScopeTraceElement).document!.spans.find((span) => span.id === 'scan')!
              .attributes!.snapshot
        )
    )
    .toBe('2');
  expect(
    await page.locator('#trace').evaluate((node) => (node as ScopeTraceElement).viewState.pinnedKey)
  ).toBe('trace:scan');
  await page.getByRole('button', { name: 'Remove scan operation', exact: true }).click();
  await expect(page.locator('#trace .tooltip')).toBeHidden();
  await expect
    .poll(() =>
      page.locator('#trace').evaluate((node) => (node as ScopeTraceElement).viewState.pinnedKey)
    )
    .toBeNull();
});

test('switching a metric to a value summary clears selection even while another source is hovered', async ({
  page
}) => {
  await ready(page);
  await page.locator('#activity').evaluate((node) => {
    const chart = node as ScopeChartElement;
    chart.viewState = {
      ...chart.viewState,
      pinnedKey: `time:${Date.parse(chart.document!.data.rows[0][0]!)}`
    };
  });
  await expect(page.locator('#activity .tooltip')).toContainText('Selected');
  const scene = await sceneFor(page, '#activity'),
    target = scene.interactions[2];
  await page.mouse.move(scene.frame.x + target.anchor.x, scene.frame.y + target.anchor.y);
  await expect(page.locator('#activity .tooltip-badge')).toHaveCount(0);
  await page.locator('#activity').evaluate((node) => {
    const chart = node as ScopeChartElement;
    chart.updateDocument(
      {
        version: 1,
        data: {
          fields: [{ name: 'Count', data_type: 'number' }],
          rows: [['42']]
        },
        spec: {
          visualization: 'big-number',
          encoding: {
            values: [{ name: 'Count', data_type: 'number', occurrence: 0 }]
          }
        }
      },
      { preserveViewState: true }
    );
  });
  await expect(page.locator('#activity .metrics')).toContainText('42');
  await expect
    .poll(() =>
      page.locator('#activity').evaluate((node) => (node as ScopeChartElement).viewState.pinnedKey)
    )
    .toBeNull();
  await expect(page.locator('#activity .tooltip')).toBeHidden();
});

test('host configuration persists across documents, preserves state and rejects mistakes atomically', async ({
  page
}) => {
  await ready(page);
  for (const id of ['activity', 'trace', 'profile']) {
    const chart = page.locator(`#${id}`);
    const result = await chart.evaluate((node) => {
      const chart = node as ScopeChartElement | ScopeTraceElement | ScopeFlameElement;
      const state = {
        ...chart.viewState,
        pinnedKey:
          chart.localName === 'scope-chart'
            ? `time:${Date.parse((chart as ScopeChartElement).document!.data.rows[0][0]!)}`
            : chart.localName === 'scope-trace'
              ? 'trace:scan'
              : 'profile:decode'
      };
      chart.viewState = state as typeof chart.viewState;
      const before = JSON.stringify(chart.document),
        saved = JSON.stringify(chart.viewState);
      chart.configure({ header: false, axes: 'minimal' });
      const paths: string[] = [];
      for (const input of [
        { header: true, toolip: false },
        { toolbar: { attributon: false } },
        { presentation: 'sparkline' },
        { interactive: false }
      ]) {
        try {
          chart.configure(JSON.parse(JSON.stringify(input)));
        } catch (error) {
          paths.push((error as { path: string }).path);
        }
      }
      const preserved =
        before === JSON.stringify(chart.document) && saved === JSON.stringify(chart.viewState);
      const document = chart.document!;
      chart.updateDocument({ ...document, title: 'New snapshot' }, { preserveViewState: true });
      return { paths, preserved, pinned: chart.viewState.pinnedKey };
    });
    expect(result.paths).toEqual([
      'ui.toolip',
      'ui.toolbar.attributon',
      'ui.presentation',
      'ui.interactive'
    ]);
    expect(result.preserved).toBe(true);
    expect(result.pinned).not.toBeNull();
    await expect(chart.locator('header')).toBeHidden();
    await chart.evaluate((node) => (node as ScopeChartElement).configure({ header: true }));
    await expect(chart.locator('h2')).toHaveText('New snapshot');
  }
  await page.evaluate(() => {
    const chart = document.createElement('scope-chart');
    chart.id = 'configured-before-document';
    chart.configure({ header: false, legend: false });
    chart.document = document.querySelector<ScopeChartElement>('#activity')!.document;
    document.querySelector('main')!.append(chart);
  });
  await expect(page.locator('#configured-before-document')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#configured-before-document header')).toBeHidden();
  await expect(page.locator('#configured-before-document .legend')).toBeHidden();
});
