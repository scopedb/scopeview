---
description: Try interactive chart examples and open matching mount code, configuration and input data.
---

# Examples

Try a chart with synthetic data, then copy the working example into your application. For help choosing a visualization and factory import, use the [chart family guide](charts.md).

## Live gallery

Choose a chart type from the grouped menu. **Docs** opens the matching component example, preserving the selected type and its copyable mount code, configuration and input data. The selected type is also kept in the URL for reloads, links and browser navigation.

<ChartDemo />

## Run an example

The source tabs use npm package imports and JSON modules. Use a build tool that resolves both, such as Vite. The steps below create a small local application with Node.js 24+.

### Create a project

```sh
mkdir scopeview-example
cd scopeview-example
npm init -y
npm install @scopedb/scopeview
npm install --save-dev vite
```

### Save the source files

Open **Docs** for the selected chart, or choose [metric charts](chart-component.md), [trace timeline](trace-component.md) or [flame graph](flame-component.md). Copy all three source tabs from the same example into the project directory:

```text
scopeview-example/
  index.html
  chart.js
  data.json
  package.json
```

Keep the module script and styles from **index.html**. **chart.js** imports **data.json** and exports the document; **index.html** registers and mounts its component. Vite resolves the package and JSON imports when serving or building the application.

### Start and build

From the project directory, start the development server:

```sh
npx vite --host 127.0.0.1
```

Open the local HTTP URL printed by Vite. Opening **index.html** directly or serving these source files with a plain static server does not resolve the package and JSON imports.

To build the application and preview the resulting **dist/** directory:

```sh
npx vite build
npx vite preview --host 127.0.0.1
```

For an HTML file that includes its data and renderer and opens offline, use [HTML export](embedding.md).

## Copy and adapt

The gallery uses optional Web Components with built-in controls and details. Their source pages explain how to save the three example files and replace the supplied snapshot:

- [Metric charts](chart-component.md): tabular charts and aggregate values.
- [Trace timeline](trace-component.md): span timing and hierarchy navigation.
- [Flame graph](flame-component.md): weighted call trees and source inspection.

The same document families work with the [headless API](headless.md), where your application supplies the surrounding controls. Use [HTML export](embedding.md) for an offline chart page.
