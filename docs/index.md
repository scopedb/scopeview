---
title: ScopeView
layout: home
description: Small Canvas charts with exact source readings and no runtime dependencies.
hero:
  name: ScopeView
  text: Small charts. Exact readings.
  tagline: Metric charts, trace timelines and flame graphs with exact source values and no runtime dependencies.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Explore charts
      link: /examples
features:
  - title: 1. Mount, update, dispose
    details: Install the package and render a working bar chart in your application.
    link: /getting-started
    linkText: Create your first chart
  - title: 2. Prepare a snapshot
    details: Map metric columns, supply trace spans or describe a weighted call tree.
    link: /data
    linkText: Bring your data
  - title: 3. Fit your application
    details: Connect the chart lifecycle to your framework and handle client rendering.
    link: /frameworks
    linkText: Integrate ScopeView
---

## Install

```sh
npm install @scopedb/scopeview
```

## Live preview

Bring your data and a container. ScopeView handles the rendering. Try a family below, or open the [examples gallery](examples.md) for built-in controls and copyable examples.

<HeadlessDemo />

## Choose an integration

Use the same documents and source readings across each approach.

| Integration                 | Use it when                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| [Headless API](headless.md) | Your application owns titles, controls and selected-source details.  |
| [Web Components](api.md)    | You want built-in legends, toolbars, data tables and pinned details. |
| [HTML export](embedding.md) | You need a self-contained, interactive chart that opens offline.     |

## Keep exploring

[Themes, size and fonts](styling.md) · [Selection and linked views](view-state.md) · [Custom rendering](canvas-infra.md)
