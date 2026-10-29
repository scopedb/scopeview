---
description: Build a custom host with the document compilers, layout functions, Canvas runtime and painter.
---

# Custom rendering

Use `/runtime` when you need to supply the surrounding DOM and inspection UI while sharing ScopeView's layout, Canvas painter and input handling. `/canvas` exposes the painter alone. Most applications can use the smaller [headless factories](headless.md).

## Compile, lay out and paint

The DOM-free package root exports document compilers and layout functions. A compiler owns an exact snapshot; a layout produces a `ChartScene` in CSS pixels. Scenes contain marks, labels, clipping, hit targets and original sources. Treat each scene as immutable between renders.

```ts
import { compileChart, layoutChart } from '@scopedb/scopeview';
import { ChartRuntime, SCOPE_CHART_STYLES } from '@scopedb/scopeview/runtime';

export function mountCustomChart(host: HTMLElement, input: unknown): () => void {
  const compiled = compileChart(input);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SCOPE_CHART_STYLES;
  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative;height:280px';
  const canvas = document.createElement('div');
  canvas.style.cssText = 'position:relative;width:100%;height:100%';
  const decoration = document.createElement('div');
  decoration.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  frame.append(canvas, decoration);
  root.append(style, frame);
  const runtime = new ChartRuntime(canvas, decoration, {
    layout: (width, height, measure, hidden) =>
      layoutChart(compiled, hidden, width, height, measure),
    onInspect: (target) => console.log(target?.tooltip ?? []),
    onError: (error) => console.error(error)
  });
  return () => {
    runtime.dispose();
    frame.remove();
    style.remove();
  };
}
```

The host in this example must not already have a shadow root. The runtime handles sizing, font completion, device pixel ratio, input and scheduled painting. Your host renders any reading UI from the callback. It also owns loading, application errors and external actions.

For traces, use `compileTrace`, `createTraceView` and `layoutTrace`; profiles use the corresponding profile functions. Parameterize `ChartRuntime<TraceSpan>` or `ChartRuntime<ProfileFrame>` to preserve source types.

## Invalidation and state

| Operation                         | Use                                                               |
| --------------------------------- | ----------------------------------------------------------------- |
| `refresh()` / `refresh('layout')` | Rebuild geometry after data, visibility or layout changes         |
| `refresh('paint')`                | Re-read paint after token changes, reusing geometry when possible |
| `setLayout(callback)`             | Replace the layout callback for another snapshot                  |
| `session`                         | Inspection and series visibility state                            |
| `rangeSelection`                  | Controlled time-range binding                                     |
| `linkedHighlight`                 | Passive cross-chart emphasis                                      |
| `dispose()`                       | Remove listeners/observers and release owned drawing buffers      |

Requests coalesce into one animation frame; layout wins over paint. Size or font changes still rebuild layout even when the original request was paint-only. For unrelated snapshots, reset the session and clear/rebind ranges before replacing the layout. Stable keys preserve state only when they still identify the same source.

Hierarchy hosts can combine `ViewportSession` with `/runtime`'s `ViewportController`. Create input before the runtime, forward consumed gestures through `inputConsumed`, and use `onNavigate` to reveal offscreen logical targets. Dispose both objects. The examples in [`examples/infra.html`](../examples/infra.html) and [`examples/families.html`](../examples/families.html) show complete custom consumers.

Keyboard input commits the requested session state before invoking `onNavigate`. This hook may paint synchronously; changes made by host callbacks during that paint remain authoritative. The subsequent inspection reads the current session, and disposal during navigation stops further callbacks.

## Painter-only hosts

`new CanvasRenderer(container, decoration, inspect)` accepts a typed scene and projects `PaintState` with `render(scene, state?)`. Hosts own measurement, layout, scheduling, state and accessible readings. Cache strategy is automatic; there is no public paint-strategy option.

The painter uses one visible Canvas. Dense interactive scenes may also retain a detached static cache. State-only drawing reuses that cache where valid; scene, font, density or paint changes invalidate it. Context state and the CSS-pixel transform are reset on each pass. Background bands precede data; guides and outlines preserve labels and source fills.

Buffers follow native device pixel ratio. Paint snapping improves backing-pixel alignment without changing the source geometry or hit contract. Coordinates and tiny intervals remain subject to pixel resolution.

`diagnostics` reports strategy, surfaces, nominal RGBA `backingBytes`, `basePaints` and `frames`. These counters are not FPS or total process/GPU memory. Measure representative application workloads before choosing a caching strategy.

## Logical and visible targets

Hierarchy layouts separate full logical navigation from visible paint/hit targets. Viewport culling bounds drawing work while retaining keyboard access to uncollapsed sources. Compilation and stored navigation still scale with input size; virtualization does not make the full snapshot free. Zero-area nodes remain logical targets.

Geometry, source identity and selection behavior follow the same [design baseline](../development/design-baseline.md) as the public factories and components.
