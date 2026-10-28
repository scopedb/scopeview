import { expectTypeOf } from 'vitest';
import { createChart } from '../../src/chart.js';
import { createChart as createAxis } from '../../src/chart-axis.js';
import { createTrace } from '../../src/trace.js';
import { createFlame } from '../../src/flame.js';
import { createVisualization } from '../../src/headless.js';
import { createReport } from '../../src/report.js';
import type { ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';
import type {
  InspectionContext,
  MetricInspectionContext,
  TraceInspectionContext,
  ProfileInspectionContext
} from '../../src/index.js';

// Compiled by pnpm check; these consumers need no DOM at test runtime.
export function inspectionContextTypes(
  host: HTMLElement,
  trace: ScopeTraceElement,
  profile: ScopeFlameElement
) {
  for (const create of [createChart, createAxis])
    create(
      host,
      {},
      {
        onInspect(_target, context) {
          expectTypeOf(context).toEqualTypeOf<MetricInspectionContext | null>();
        },
        onSelect(_target, context) {
          expectTypeOf(context).toEqualTypeOf<MetricInspectionContext | null>();
        }
      }
    );
  createTrace(
    host,
    {},
    {
      onInspect(_target, context) {
        expectTypeOf(context).toEqualTypeOf<TraceInspectionContext | null>();
      },
      onSelect(_target, context) {
        expectTypeOf(context).toEqualTypeOf<TraceInspectionContext | null>();
      }
    }
  );
  createFlame(
    host,
    {},
    {
      onInspect(_target, context) {
        expectTypeOf(context).toEqualTypeOf<ProfileInspectionContext | null>();
      },
      onSelect(_target, context) {
        expectTypeOf(context).toEqualTypeOf<ProfileInspectionContext | null>();
      }
    }
  );
  createVisualization(
    host,
    {},
    {
      onInspect(_target, context) {
        expectTypeOf(context).toEqualTypeOf<InspectionContext | null>();
      }
    }
  );
  createReport(
    host,
    {},
    {
      onSelect(_target, context) {
        expectTypeOf(context).toEqualTypeOf<InspectionContext | null>();
      }
    }
  );
  trace.addEventListener('scope-inspect', (event) => {
    expectTypeOf(event.detail.context).toEqualTypeOf<TraceInspectionContext | null>();
  });
  profile.addEventListener('scope-select', (event) => {
    expectTypeOf(event.detail.context).toEqualTypeOf<ProfileInspectionContext | null>();
  });
}
