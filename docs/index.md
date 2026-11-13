---
layout: home
title: ScopeView
titleTemplate: Exact telemetry charts for coding agents and apps
hero:
  name: ScopeView
  text: Exact telemetry charts for coding agents and apps.
  tagline: Render exact metrics, nanosecond traces, and 64-bit flame graphs to Canvas or standalone HTML with zero runtime dependencies.
  actions:
    - theme: brand
      text: Inspect Live Showcase
      link: '#inspect-and-reproduce'
    - theme: alt
      text: Agent & CLI Guide
      link: /cli
    - theme: alt
      text: Embed in Apps
      link: /getting-started
features:
  - title: Exact source readings
    details: String-backed timestamps, 64-bit integers, decimals, and BigInt weights keep 1 ns vs 0 ns spans and weights above 2^53 intact while missing samples remain explicit null gaps.
  - title: Built for coding agents & CLIs
    details: Run schema, example, validate, and render with deterministic --json contracts and /llms.txt instructions so coding agents emit portable standalone HTML artifacts in one step.
  - title: Under 39 KiB, zero dependencies
    details: Self-contained Canvas runtime with zero third-party chart dependencies, shipping compact entry points (4 KiB scalar, 21 KiB trace, 39 KiB all-family standalone).
---

<div id="inspect-and-reproduce"></div>

<LandingShowcase />

## Use with coding agents and CLIs

ScopeView gives Claude Code, Codex, Cursor, and CI scripts a deterministic contract from JSON generation to a shareable standalone HTML report: inspect the contract, validate payloads cleanly, and open the generated chart in any browser without network access or Node runtime dependencies at view time.

- **Agent entry point:** point agents to [`/llms.txt`](/llms.txt) for the compact `v1` JSON contract, precision rules, and verified CLI workflow.
- **Deterministic CLI loop:** `scopeview schema --json`, `scopeview example <kind> --json`, `scopeview validate --input <file> --json`, and `scopeview render --input <file> --output <file> --json`.
- **Portable delivery:** download any standalone HTML fixture from the showcase above or install the latest release from [GitHub Releases](https://github.com/scopedb/scopeview/releases) and inspect the full command reference in [CLI Reference](./cli.md).

```bash
npm install -g @scopedb/scopeview
scopeview schema --json > schema.json
scopeview validate --input report.json --json
scopeview render --input report.json --output report.html --json
```

## Embed in applications

Embed the headless Canvas engine, custom elements, or Node HTML renderer directly in TypeScript and JavaScript applications. Choose only the chart families your bundle needs or ship the standalone bundle under a 39 KiB gzip budget.

::: code-group

```bash [npm]
npm install @scopedb/scopeview
```

```bash [pnpm]
pnpm add @scopedb/scopeview
```

```bash [Bun]
bun add @scopedb/scopeview
```

:::

```ts
import { createChart, enableInteractions } from '@scopedb/scopeview/charts';

const view = createChart(container, document, {
  theme: 'system',
  onSelect(_target, context) {
    console.log(context);
  }
});

const stop = enableInteractions(view);
```

| Integration path | Entry point                                  | Best suited for                                             |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Standalone CLI   | `npx @scopedb/scopeview`                     | Coding agents, terminal pipelines, single-file HTML reports |
| Metric charts    | `@scopedb/scopeview/charts`                  | Line, bar, area, scatter, donut, top-list, treemap, scalar  |
| Trace & profile  | `@scopedb/scopeview/trace` & `/profile`      | Waterfall span timelines and BigInt flame graphs            |
| Custom element   | `@scopedb/scopeview/element`                 | Declarative `<scope-chart>` with attribute/DOM integration  |
| Headless & Node  | `@scopedb/scopeview/headless` & `/node`      | Custom frameworks, theme wiring, server-side HTML rendering |

Explore [Overview](./overview.md), [Getting Started](./getting-started.md), [Live Examples](./examples.md), and [Bundle Size Budgets](../development/bundle-size.md).
