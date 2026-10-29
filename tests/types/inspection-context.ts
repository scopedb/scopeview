import { expectTypeOf } from 'vitest';
import { createChart, type MetricInspectionContext } from '../../src/chart.js';
import {
  createChart as createAxis,
  type MetricInspectionContext as AxisInspectionContext
} from '../../src/chart-axis.js';
import { createTrace, type TraceInspectionContext } from '../../src/trace.js';
import { createFlame, type ProfileInspectionContext } from '../../src/flame.js';
import { createVisualization, type InspectionContext } from '../../src/headless.js';
import {
  createReport,
  type InspectionContext as ReportInspectionContext
} from '../../src/report.js';
import type { ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';

// Compiled by pnpm check; these consumers need no DOM at test runtime.
export function inspectionContextTypes(
  host: HTMLElement,
  trace: ScopeTraceElement,
  profile: ScopeFlameElement
) {
  expectTypeOf<AxisInspectionContext>().toEqualTypeOf<MetricInspectionContext>();
  expectTypeOf<ReportInspectionContext>().toEqualTypeOf<InspectionContext>();
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
