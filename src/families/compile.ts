import { compileChart, type ChartDocument, type CompiledChart } from './metrics/document.js';
import { compileTrace, type TraceDocument, type CompiledTrace } from './trace.js';
import { compileProfile, type ProfileDocument, type CompiledProfile } from './profile.js';
import { object, fail } from './hierarchy/model.js';

export type VisualizationDocument = ChartDocument | TraceDocument | ProfileDocument;
export type CompiledVisualization =
  | { kind: 'metric'; chart: CompiledChart; document: ChartDocument }
  | CompiledTrace
  | CompiledProfile;
/** Dispatch each document family through its compiler. */
export function compileVisualization(value: unknown): CompiledVisualization {
  const input = object(value, 'document');
  if (input.kind === 'trace') return compileTrace(input);
  if (input.kind === 'profile') return compileProfile(input);
  if (input.kind !== undefined && input.kind !== 'metric')
    fail('kind', 'Expected metric, trace or profile.');
  const chart = compileChart(value);
  return { kind: 'metric', chart, document: chart.document };
}
