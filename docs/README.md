# Documentation

Read the [overview](overview.md) to choose an interface, or follow [getting started](getting-started.md) to install ScopeView and mount a chart. Run `pnpm docs:dev` from the repository to browse these guides with live examples.

## Start here

1. [Overview](overview.md): understand the chart families, interfaces and source readings.
2. [Getting started](getting-started.md): install, mount, update and dispose a chart.
3. [Data format](data.md): prepare metric rows, trace spans or profile frames.
4. [Chart families](charts.md): choose a visualization and import path.

## Integrate with your application

| Guide                       | Covers                                     |
| --------------------------- | ------------------------------------------ |
| [Frameworks](frameworks.md) | React/Svelte lifecycle and SSR             |
| [Styling](styling.md)       | Size, themes, fonts and source colors      |
| [HTML export](embedding.md) | Node API, CLI, offline pages and fragments |

## API reference and examples

[Headless API](headless.md) covers factories, updates, loading, callbacks and interactions. [Document options](options.md) lists accepted values, defaults and interface-specific behavior. [Web Component API](api.md) documents the complete Web Components. Live examples are available in the [gallery](examples.md), with copyable source for [metrics](chart-component.md), [traces](trace-component.md) and [flame graphs](flame-component.md). [View state and coordination](view-state.md) covers persistence, linked charts and controlled ranges. [Design tokens](design-tokens.md) describes the public token catalog. [Custom rendering](canvas-infra.md) covers the runtime and Canvas painter.

Follow [Run an example](examples.md#run-an-example) to create a project, save the source files and start or build it with Vite.

## Contribute

The [contributor guide](../CONTRIBUTING.md) covers development, tests and architecture. The [release guide](../RELEASE.md) covers publication. Release history is in the [changelog](../CHANGELOG.md).
