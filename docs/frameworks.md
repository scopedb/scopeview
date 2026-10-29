---
description: Integrate ScopeView with React, Svelte, asynchronous loading and server rendering.
---

# Frameworks

Use a normal container and the headless API in your framework's client lifecycle. Create one view per mounted container, update it when the document changes, and dispose it on unmount. No ScopeView wrapper package is required.

The examples below use the metric factory and `requests` from [getting started](getting-started.md). Use `/trace` or `/flame` and their document types for those families. Remount when changing families; use `/chart` for synchronous switching across all metric layouts.

## React

This component keeps the same chart instance across document updates. Its cleanup also supports React's development setup/cleanup cycle. See React's [effect lifecycle](https://react.dev/reference/react/useEffect).

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { createChart, type ChartDocumentInput, type ChartView } from '@scopedb/scopeview/chart';

export function Chart({ document: input }: { document: ChartDocumentInput }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<ChartView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    if (view.current) view.current.update(input);
    else view.current = createChart(host.current, input, { theme: 'system' });
  }, [input]);

  useEffect(() => () => {
    view.current?.dispose();
    view.current = null;
  }, []);

  return <div ref={host} />;
}
```

Pass a new document object when data changes. Invalid input throws from the factory or update; handle errors at your application's data boundary.

## Svelte 5

Effects run in the browser after mounting, so the bound container is available before the factory runs. The destruction hook releases the view. See the Svelte [effect](https://svelte.dev/docs/svelte/$effect) and [lifecycle](https://svelte.dev/docs/svelte/lifecycle-hooks) references.

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createChart, type ChartDocumentInput, type ChartView } from '@scopedb/scopeview/chart';

  let { document: input }: { document: ChartDocumentInput } = $props();
  let host = $state<HTMLDivElement>();
  let view: ChartView | undefined;

  $effect(() => {
    if (!host) return;
    if (view) view.update(input);
    else view = createChart(host, input, { theme: 'system' });
  });

  onDestroy(() => view?.dispose());
</script>

<div bind:this={host} style="--scope-chart-height: 280px"></div>
```

## Asynchronous mounting

When using `/report`, cleanup must cover both a mounted view and a pending import. This helper returns a cleanup function suitable for a client lifecycle hook:

```ts
import { createReport, type ReportView } from '@scopedb/scopeview/report';

export function mountReport(
  host: HTMLElement,
  input: unknown,
  onError: (error: unknown) => void
): () => void {
  const controller = new AbortController();
  let view: ReportView | undefined;
  void createReport(host, input, { signal: controller.signal }).then((next) => {
    if (controller.signal.aborted) next.dispose();
    else view = next;
  }).catch((error) => {
    if (!controller.signal.aborted) onError(error);
  });
  return () => {
    controller.abort();
    view?.dispose();
  };
}
```

For subsequent snapshots, retain the resolved `ReportView` and await `update(input)`. Keep failed-download and loading messages in the surrounding application.

## SSR and components

Document types, parsers and compilers from the package root are DOM-free. Headless modules can be imported on the server, but mounting needs a browser element. Do not call a factory during server rendering.

The optional Web Components require browser registration. In an SSR application, load `@scopedb/scopeview/register` in a client hook, then assign the element's `document` property. Pass documents as JavaScript objects, not serialized attributes. To keep component selection across compatible updates, use `updateDocument(input, { preserveViewState: true })`. Attach and remove event listeners through the framework's lifecycle. Removing the element releases its rendering resources. See [component API](api.md) for typed events and methods.
