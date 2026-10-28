import { expect, test } from '@playwright/test';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';
import type { ViewState } from '../../src/index.js';

const viewport = { start: 0.1, end: 0.9, scrollOffset: 0 };
for (const { tag, state } of [
  {
    tag: 'scope-chart',
    state: { version: 1, kind: 'metric', pinnedKey: 'time:1790647200000', hiddenSeries: ['ingest'] }
  },
  {
    tag: 'scope-trace',
    state: { version: 1, kind: 'trace', pinnedKey: 'trace:scan', viewport, collapsed: [] }
  },
  {
    tag: 'scope-flame',
    state: { version: 1, kind: 'profile', pinnedKey: 'profile:scan', viewport, collapsed: [] }
  }
] satisfies { tag: string; state: ViewState }[]) {
  test(`${tag} replays pre-registration properties in document/state order and keeps setters live`, async ({
    page
  }) => {
    await page.goto('/tests/browser/fixtures/blank.html');
    await page.evaluate(
      async ({ tag, state }) => {
        const dataEntry = '/examples/embedding-data.ts',
          { metricDocument, traceDocument, profileDocument } = await import(dataEntry),
          input =
            tag === 'scope-chart'
              ? metricDocument()
              : tag === 'scope-trace'
                ? traceDocument
                : profileDocument;
        const chart = document.createElement(tag);
        // Deliberately assign saved state before its document and before definition.
        Object.assign(chart, {
          viewState: state,
          linkedHighlight: { inspectionKey: null, cursor: 0.4 },
          loading: true,
          document: input
        });
        document.body.append(chart);
        const entry = '/src/register.ts';
        await import(entry);
      },
      { tag, state }
    );
    const chart = page.locator(tag);
    await expect(chart).toHaveAttribute('data-state', 'loading');
    await chart.evaluate((node) => {
      (node as ScopeChartElement | ScopeTraceElement | ScopeFlameElement).loading = false;
    });
    await expect(chart).toHaveAttribute('data-state', 'ready');
    await expect(chart.locator('.tooltip-badge')).toHaveText(
      tag === 'scope-chart' ? 'Selected' : 'Pinned'
    );
    expect(
      await chart.evaluate((node) => {
        const chart = node as ScopeChartElement | ScopeTraceElement | ScopeFlameElement;
        return {
          state: chart.viewState,
          linked: chart.linkedHighlight,
          own: ['document', 'viewState', 'loading', 'linkedHighlight'].filter((key) =>
            Object.hasOwn(chart, key)
          )
        };
      })
    ).toEqual({ state, linked: { inspectionKey: null, cursor: 0.4 }, own: [] });
    await chart.evaluate((node) => {
      const chart = node as ScopeChartElement | ScopeTraceElement | ScopeFlameElement;
      chart.document = { ...chart.document, title: 'Updated after registration' };
    });
    await expect(chart.locator('h2')).toHaveText('Updated after registration');
    await expect(chart.locator('.tooltip')).toBeHidden();
  });
}
