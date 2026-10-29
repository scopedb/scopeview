# Architecture

ScopeView turns a supplied document into a scene, paints it with Canvas, and reports exact source readings. The package has no runtime npm dependencies. The default browser API is a small view; complete components and custom rendering are separate entry points.

## Data flow

```mermaid
flowchart LR
  Document[Document snapshot] --> Compile[Validate and compile]
  Compile --> Layout[Family layout]
  Layout --> Scene[Scene and source targets]
  Scene --> Paint[Canvas painter]
  Scene --> Read[Inspection and callbacks]
  Tokens[Shared tokens] --> Layout
  Tokens --> Paint
  Tokens --> Read
```

Data and computation stay separate from browser lifecycle. The compiler owns a normalized snapshot, with source strings preserved for inspection. Layout uses approximate CSS-pixel coordinates. The host owns fetching, aggregation, titles, controls and application actions.

## Source ownership

| Directory               | Responsibility                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `src/data/`             | Fields, exact values, time, formatting and validation primitives                    |
| `src/families/`         | Metric, trace and profile validation, compilation and layout                        |
| `src/core/`             | Scenes, hit contracts, sessions, ranges, viewports and semantic links               |
| `src/theme/`            | Strict host theme configuration, token source, generated defaults and shared styles |
| `src/renderers/canvas/` | Paint composition, contrast, surfaces and caches                                    |
| `src/runtime/`          | Measurement, input, invalidation and resource lifecycle                             |
| `src/ui/`               | Shared DOM construction, exact reading presentation and floating placement          |
| `src/views/`            | Headless mounting, transient readings, updates and disposal                         |
| `src/elements/`         | Optional component shells, controls, host events and adapters                       |
| `node/`                 | Published HTML exporter using built public entries                                  |

Metric code separates parsing, field/spec resolution, semantic compilation, data preparation and individual layouts. Trace/profile share hierarchy validation and interval layout. All browser surfaces use the same family geometry and painter. A component shell does not own another rendering implementation.

## Public entry points

Top-level `src/*.ts` files define the package's public ESM entries. `package.json` owns the entry list; builds derive it from exports. Declaration names must match the source entry. Internal modules import their owner directly rather than using public barrels.

The root API, data, core, families and token catalog are DOM-free. `/chart/axis` retains only axis validation/preparation/layout. Other fixed metric entries retain their own layout. `/report` loads the selected family and metric layout; `/headless` composes synchronous factories. `/scalar` excludes Canvas, family compilation and pointer runtime.

Headless views and components depend on shared text-safe reading and placement helpers in `ui/`; views do not import component-owned modules in `elements/`. Headless entries exclude component classes, controls and full shell CSS. `/interactions` adds persistent selection and hierarchy input separately, sharing only primitive record validation from `data/`. `/element` exposes component classes; `/register` performs registration. The standalone script uses headless factories.

## Dependency boundaries

Keep data and compilation independent of browser globals. Views share Canvas and reading helpers; component shells compose those views. Node tooling uses the built public library and Node built-ins. Production code has no external runtime dependencies.

`pnpm test:bundle` bundles actual public imports to verify Node-safe model use, optional registration, unused-import removal, small scalar/fixed-chart consumers, and retained fonts. See [bundle checks](bundle-size.md) for the concrete limits. These tests check shipped capabilities rather than enforcing a file-by-file source dependency graph.

## State and lifecycle

Each mounted chart has one DOM-free interaction owner for canonical reading state, command boundaries and publication. Session objects are compatibility facades into that owner. Pure reducers commit semantic keys, selection, hover and intent before any effect invokes application code. Hierarchy family state owns compiled target resolution, collapse, viewport and deferred geometry; it shares the component's session and pump rather than copying selection into an independent runtime.

The internal `RuntimeLifecycle` base owns Canvas measurement, layout invalidation, frame scheduling, resize/font/DPR listeners, error recovery and resource disposal. `ReadingRuntime` and `ChartRuntime` translate input and project committed state into paint. Layout revisions and semantic model versions reject stale custom layout results and errors. Consumed Canvas providers and detached borrowed session facades keep old runtime lifetimes from mutating a new mounted chart. Optional ranges, links and viewport controllers stay outside the base and small headless runtime.

Family-owned inspection context projectors expose exact source values, field roles and ancestry. Context types and opaque document identity live in `core/inspection-context.ts`; completed scenes retain their compiled source through `core/scene-snapshot.ts`. A pending document does not relabel an older painted frame. Lazy source clones retain exact original values and ancestry when hosts keep a context after later updates.

`Interaction` in `core/interaction.ts` runs keyed, validated presentation effects before controls, reading reports, viewport reports, portable state and ready. Channels bind this fixed compatibility order at creation; individual state reports do not assign scheduling priorities. `InspectionNotifications` adapts inspect/select identity (`snapshot`, `key`, `series`, `pinned`) and independent invalidation onto that same pump. Delivery records identity before invoking the host; nested commands commit immediately while reports wait for the current broadcast. Captured context can therefore describe an earlier state than current getters. Pending reports coalesce per channel, without a total inspect/select order across nested commands. Same-value acknowledgements quiesce, changing-value feedback yields after bounded work, and observer failures preserve other valid reports before propagating.

Hierarchy focus resolves against compiled semantic targets and expands ancestors before accepting the command. Hidden charts retain the last positive measurement and a complete positioning intent. Newer dismissal, viewport, restore, collapse or document commands cancel older reveal work. One explicit Canvas Escape owner commits dismissal; runtime and shell fallback skip that Canvas path so other listeners can restore newer state without a second clear.

The implemented [interaction transaction design](interaction-transactions.md) records ownership, publication phases, API compatibility and regression coverage. Invalid headless updates preserve the previous figure. Asynchronous report updates validate before loading and prevent stale downloads from overwriting newer data. Component loading/disconnection and silent headless disposal preserve their entry-specific lifecycle policies.

Views own their child DOM; components release runtime resources on disconnect. Shared tokens and the [accepted design baseline](design-baseline.md) govern paint and reading behavior.

See [custom rendering](../docs/canvas-infra.md) for low-level consumers and [development](../CONTRIBUTING.md) for tests, scripts and packaging.

## Local tooling ownership

Node tooling imports the built public compiler and sibling helpers; it never imports source, private chunks or development scripts. `node/compile.mjs` loads the public compiler without retaining optional diagnostics. `node/document.mjs` derives summaries and warnings from one authoritative compilation. `node/html.mjs` embeds installed assets and returns HTML plus internal metadata; `node/embed.mjs` preserves the string-returning public API and optionally delivers the same diagnostics as CLI render. Export captions use the public token styles; token-only consumers can omit component shell CSS. `node/diagnostics.mjs` owns shared warnings and loads on demand for Node export callbacks. `node/resources.mjs` reads installed schema/examples/version, and `node/errors.mjs` owns transport classification. `node/cli.mjs` is the only executable entry; `node/command.mjs` owns parsing/protocol routing from one command/option table. `node/io.mjs` bounds reads, checks aliases, awaits streams and publishes files atomically. Node helpers and resources stay outside browser barrels.

JSON Schema is an authoring resource; it never replaces semantic compilation. ScopeView owns supplied documents and generic export, while query execution, raw database conversion, evidence bundles and host presentation belong to adapters outside this repository.

The self-contained CLI reuses the exact accepted npm tarball. Development-only distribution scripts verify a pinned official Node archive, copy its executable/license alongside the package and add a relative launcher. They never add a renderer or compiler implementation. The application code and resources keep their installed layout. CI builds and tests each supported platform. The [release workflow](../RELEASE.md) publishes the accepted artifacts after verification on every supported platform.
