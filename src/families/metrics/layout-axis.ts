import { layoutContext, frame, yTicks, add, type MetricLayout } from './layout-common.js';
import type { Position, SceneInteraction } from '../../core/scene.js';
import { compileAxisChartModel, type TimeSample } from './model.js';
import { formatQuantity } from '../../data/semantics.js';
import { timeTooltipHeader } from './tooltip.js';
import { zoneLabel } from '../../data/date-time.js';
import { linear, numericAxis } from './scale.js';
import { chartColumn, chartColumnLabel, chartValue } from './dataset.js';
import {
  formatTemporalTick,
  temporalAxisCaption,
  temporalStep,
  temporalTicks
} from './temporal-axis.js';
import { groupSeriesName } from './prepared.js';
import type { SeriesInfo } from './series.js';
import {
  areaFillOpacity as tokenAreaFillOpacity,
  areaInnerStrokeWidth as tokenAreaInnerStrokeWidth,
  areaStackedOpacity as tokenAreaStackedOpacity,
  dataPointRadius as tokenDataPointRadius,
  lineWidth as tokenLineWidth
} from '../../theme/visual-tokens.js';

const transparent = 'none';
const point = (value: number) => Number(value.toFixed(3));
const xy = (x: number, y: number) => `${point(x)},${point(y)}`;
function color(series: SeriesInfo, position: string | number, line = false) {
  const paint =
    series.categories?.find((item) => item.name === groupSeriesName(position)) ?? series;
  return (line ? paint.lineColor : paint.color) ?? paint.color;
}
function linePath(points: readonly Position[]) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${xy(p.x, p.y)}`).join('');
}

export const layoutAxis: MetricLayout = (
  compiled,
  hidden,
  width,
  height,
  measure,
  axes = 'full'
) => {
  const { dataset, config } = compiled;
  const { mapping, displayType } = config;
  if (mapping.kind !== 'axis') throw new TypeError('An axis layout requires an axis mapping.');
  const { model, finish, visible, labels, showLabels, full, miniature, report } = layoutContext(
    compiled,
    hidden,
    width,
    height,
    measure,
    axes
  );
  const semantic = compiled.axisModel ?? compileAxisChartModel(dataset, mapping);
  const temporal = semantic.kind === 'time-series';
  const bucket = temporal && semantic.sampling === 'buckets' ? semantic : null;
  if (temporal)
    model.time = {
      domain: semantic.window ?? semantic.domain,
      window: semantic.window,
      ...(bucket ? { intervalMs: bucket.intervalMs, coverage: bucket.coverage } : {})
    };
  const xColumn = chartColumn(dataset, mapping.x)!;
  const positions: (number | string)[] = temporal
    ? semantic.positions.map(Number)
    : [
        ...new Set(
          dataset.rows
            .map((row) => chartValue(row, xColumn))
            .filter((v) => v !== null)
            .map(String)
        )
      ];
  const positionsByValue = new Map(positions.map((p, i) => [p, i]));
  const rows = semantic.rows.filter((row) => !hidden.has(row.series));
  type Datum = (typeof rows)[number];
  const grouped = new Map<string, Map<number | string, Datum>>();
  for (const row of rows) {
    let values = grouped.get(row.series);
    if (!values) {
      values = new Map();
      grouped.set(row.series, values);
    }
    values.set(row.x instanceof Date ? +row.x : row.x, row);
  }
  const stacked =
    displayType === 'bar'
      ? config.stack !== false
      : displayType === 'area' && mapping.y.length === 1 && config.stack !== false;
  if (displayType === 'line' || displayType === 'area') model.emphasis = 'series';
  const positive = positions.map(() => 0),
    negative = positions.map(() => 0);
  const seriesData = visible.map((series) => {
    const values = grouped.get(series.name);
    return {
      series,
      points: [...(values?.entries() ?? [])]
        .map(([position, row]) => {
          const index = positionsByValue.get(position)!;
          const sums = row.y >= 0 ? positive : negative;
          const base = stacked ? sums[index] : 0;
          const top = base + row.y;
          if (!Number.isFinite(top))
            throw new Error('The stack total exceeds finite number precision.');
          if (stacked) sums[index] = top;
          return { row, base, top, position, index };
        })
        .sort((a, b) => a.index - b.index)
    };
  });
  const extents = seriesData.flatMap((s) =>
    s.points.flatMap((p) => (p ? [p.top, ...(stacked ? [p.base] : [])] : []))
  );
  const yAxis = numericAxis(extents, height < 240 ? 3 : 5, displayType !== 'line');
  if (report) {
    const units = new Set(mapping.y.map((id) => compiled.displays.get(id)?.unit));
    const unit = units.size === 1 ? units.values().next().value : undefined;
    if (unit) yAxis.labels[yAxis.labels.length - 1] += ` ${unit}`;
  }
  const r = frame(width, height, yAxis, full, measure, 0, miniature, full || (report && temporal));
  model.rect = r;
  model.clipRect = r;
  const y = linear(yAxis.domain, [r.y + r.height, r.y]);
  const domain = temporal
    ? ([
        (semantic.window ?? semantic.domain).start,
        (semantic.window ?? semantic.domain).end
      ] as const)
    : ([0, Math.max(0, positions.length - 1)] as const);
  // Reserve the same horizontal edge space across line, area and bar styles.
  const edge = bucket || miniature ? 0 : Math.min(28, r.width / 4);
  const scaleX = linear(domain, [r.x + edge, r.x + r.width - edge]);
  const x = (p: number | string) => scaleX(temporal ? Number(p) : positionsByValue.get(p)!);
  const bucketEdges = (p: number | string) =>
    [
      x(Math.max(Number(p), domain[0])),
      x(Math.min(Number(p) + bucket!.intervalMs, domain[1]))
    ] as const;
  if (bucket?.completeThrough !== undefined && bucket.completeThrough < domain[1]) {
    const left = x(
      Math.max(
        domain[0],
        Math.floor(bucket.completeThrough / bucket.intervalMs) * bucket.intervalMs
      )
    );
    model.partial = { x: left, y: r.y, width: r.x + r.width - left, height: r.height };
  }
  const centerX = (p: number | string) => {
    if (!bucket) return x(p);
    const [left, right] = bucketEdges(p);
    return (left + right) / 2;
  };
  const centers = positions.map(centerX);
  const gap =
    centers.length < 2 ? r.width : Math.min(...centers.slice(1).map((v, i) => v - centers[i]));
  const columnWidth = Math.min(48, gap * 0.72);
  const columnAt = (p: number | string) => {
    const edges = bucket ? bucketEdges(p) : null;
    return {
      center: centerX(p),
      width: edges ? Math.max(0, edges[1] - edges[0]) * 0.72 : columnWidth
    };
  };
  const groupedBars = displayType === 'bar' && !stacked;
  model.hitMode = displayType === 'bar' ? 'bar' : 'axis';
  model.baseline = Math.max(r.y, Math.min(r.y + r.height, y(0)));
  model.yTicks = yTicks(yAxis, y);
  if (temporal) {
    const { start, end } = semantic.window ?? semantic.domain;
    const span = end - start;
    const ticks =
      start === end
        ? [start]
        : temporalTicks(start, end, temporalStep(span, Math.max(2, Math.min(8, r.width / 100))));
    const differentOffsets =
      new Date(start).getTimezoneOffset() !== new Date(end).getTimezoneOffset();
    model.xTicks = ticks.map((value) => ({
      position: x(value),
      label:
        formatTemporalTick(new Date(value), span) + (differentOffsets ? ` ${zoneLabel(value)}` : '')
    }));
    if (full || report) model.xTitle = temporalAxisCaption(full ? xColumn.label : '', start, end);
  } else {
    model.xTicks = positions.map((p) => ({ position: x(p), label: String(p) }));
    if (full) model.xTitle = xColumn.label;
  }
  if (full) model.yTitle = mapping.y.map((id) => chartColumnLabel(dataset, id)).join(', ');

  const atPosition = positions.map(
    () => [] as { row: Datum; point: SceneInteraction['points'][number] }[]
  );
  const barsAtPosition = positions.map(() => [] as NonNullable<SceneInteraction['bars']>);
  const samplesAtPosition = new Map<number, TimeSample[]>();
  if (temporal)
    for (const sample of semantic.samples) {
      const samples = samplesAtPosition.get(sample.time) ?? [];
      samples.push(sample);
      samplesAtPosition.set(sample.time, samples);
    }
  seriesData.forEach(({ series, points }, seriesIndex) => {
    let segment: { x: number; y: number; base: number; color: string }[] = [];
    let previousIndex = -2;
    const flush = () => {
      if (!segment.length) return;
      const stroke = series.lineColor ?? series.color;
      if (displayType === 'area') {
        const d =
          linePath(segment) +
          segment
            .toReversed()
            .map((p) => `L${xy(p.x, p.base)}`)
            .join('') +
          'Z';
        model.marks.push({
          kind: 'path',
          d,
          fill: series.color,
          opacity: stacked ? tokenAreaStackedOpacity : tokenAreaFillOpacity,
          series: series.name
        });
      }
      if (displayType === 'line' || displayType === 'area')
        model.marks.push({
          kind: 'path',
          d: linePath(segment),
          fill: transparent,
          stroke,
          strokeWidth:
            displayType === 'area' && stacked && seriesIndex < seriesData.length - 1
              ? tokenAreaInnerStrokeWidth
              : tokenLineWidth,
          series: series.name,
          dashed: displayType === 'line' && series.lineType === 'dashed'
        });
      // Continuous paths carry the series; only isolated or category-colored samples need dots.
      if (segment.length === 1 || series.categories) {
        for (const p of segment)
          model.marks.push({
            kind: 'circle',
            x: p.x,
            y: p.y,
            radius: tokenDataPointRadius,
            fill: p.color,
            series: series.name
          });
      }
      segment = [];
    };
    for (const p of points) {
      if (p.index !== previousIndex + 1) flush();
      previousIndex = p.index;
      const fill = color(series, p.position, displayType === 'line');
      const column = columnAt(p.position),
        barWidth = column.width / (groupedBars ? Math.max(1, visible.length) : 1);
      const center =
        (bucket || displayType === 'bar' ? column.center : x(p.position)) +
        (groupedBars ? -column.width / 2 + barWidth * (seriesIndex + 0.5) : 0);
      const top = y(p.top),
        base = y(p.base);
      atPosition[p.index].push({
        row: p.row,
        point: {
          x: center,
          y: top,
          color: fill,
          series: series.name,
          ...(displayType === 'area' && stacked ? { baseY: base } : {})
        }
      });
      if (displayType === 'bar') {
        // A real zero retains an inspection target but has no fabricated painted height.
        if (p.row.y !== 0) {
          const height = Math.max(1, Math.abs(base - top));
          barsAtPosition[p.index].push({
            x: center - barWidth / 2,
            y: p.row.y > 0 ? base - height : base,
            width: barWidth,
            height,
            color: fill,
            series: series.name
          });
          model.marks.push({
            kind: 'rect',
            key: `${temporal ? 'time' : 'category'}:${p.position}`,
            x: center - barWidth / 2,
            y: p.row.y > 0 ? base - height : base,
            width: barWidth,
            height,
            fill
          });
        }
      } else segment.push({ x: center, y: top, base, color: fill });
      if (showLabels && displayType === 'bar' && !stacked && gap >= 36) {
        const metric = dataset.columns.find((c) => c.label === p.row.metric)!;
        const text = formatQuantity(
          p.row.source[metric.columnIndex],
          compiled.displays.get(metric.id)
        );
        labels.push({
          text,
          x: center - measure(text) / 2,
          y: top + (p.row.y < 0 ? 9 : -9),
          priority: Math.abs(p.row.y)
        });
      }
    }
    flush();
    if (showLabels && displayType === 'line' && points.at(-1)?.index === positions.length - 1) {
      const last = points.at(-1)!;
      const metric = dataset.columns.find((c) => c.label === last.row.metric)!;
      labels.push({
        text: formatQuantity(last.row.source[metric.columnIndex], compiled.displays.get(metric.id)),
        x: centerX(last.position) + 8,
        y: y(last.top),
        series: series.name,
        priority: last.top
      });
    }
  });
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index],
      values = atPosition[index];
    const samples = samplesAtPosition.get(Number(position)) ?? [];
    const returned = samples.filter((sample) =>
      visible.some((series) => series.name === sample.series)
    );
    if (!values.length && !returned.length) continue;
    const key = `${temporal ? 'time' : 'category'}:${position}`;
    const start = bucket
      ? Math.max(Number(position), bucket.window?.start ?? -Infinity)
      : Number(position);
    const end = bucket
      ? Math.min(Number(position) + bucket.intervalMs, bucket.window?.end ?? Infinity)
      : undefined;
    const partial = bucket?.completeThrough !== undefined && end! > bucket.completeThrough;
    const sources = [
      ...new Set(returned.length ? returned.map((s) => s.source) : values.map((v) => v.row.source))
    ];
    let readingHeader: { title: string; context: string } | undefined;
    const header = () => {
      if (readingHeader) return readingHeader;
      readingHeader = temporal
        ? timeTooltipHeader(xColumn.label, start, end)
        : { title: String(position), context: xColumn.label };
      if (temporal) {
        const timestamps = [
          ...new Set(sources.map((row) => row[xColumn.columnIndex]).filter((raw) => raw !== null))
        ];
        if (timestamps.length) readingHeader.context += ` · ${timestamps.join(' · ')}`;
      }
      return readingHeader;
    };
    add(
      model,
      {
        key,
        sources,
        get axisLabel() {
          return header().title;
        },
        ...(temporal
          ? {
              time: {
                start,
                ...(end === undefined ? {} : { end }),
                ...(partial ? { partial: true } : {})
              }
            }
          : {}),
        anchor: {
          x: bucket || displayType === 'bar' ? centerX(position) : x(position),
          y: Math.min(
            ...values.map((v) => v.point.y),
            displayType === 'bar' || !values.length ? y(0) : Infinity
          )
        },
        points: displayType === 'bar' ? [] : values.map((v) => v.point),
        ...(bucket && displayType !== 'bar'
          ? {
              band: {
                x: bucketEdges(position)[0],
                width: bucketEdges(position)[1] - bucketEdges(position)[0]
              }
            }
          : {}),
        ...(displayType === 'bar'
          ? {
              bars: barsAtPosition[index],
              band: bucket
                ? {
                    x: bucketEdges(position)[0],
                    width: bucketEdges(position)[1] - bucketEdges(position)[0]
                  }
                : {
                    x: columnAt(position).center - columnAt(position).width / 2,
                    width: columnAt(position).width
                  }
            }
          : {})
      },
      () => ({
        ...header(),
        ...(temporal && displayType !== 'bar' && !partial
          ? { presentation: 'sample' as const }
          : {}),
        ...(partial ? { context: `${header().context} · Partial data` } : {}),
        rows: visible.map((series) => {
          const v = values.find((v) => v.row.series === series.name),
            sample = returned.find((s) => s.series === series.name);
          return {
            label: series.name,
            format: 'number',
            value: (() => {
              if (!v) return sample ? 'NULL' : '—';
              const column = dataset.columns.find((c) => c.label === v.row.metric)!;
              return formatQuantity(
                v.row.source[column.columnIndex],
                compiled.displays.get(column.id)
              );
            })(),
            color: v?.point.color ?? color(series, position, displayType === 'line')
          };
        }),
        ...(displayType === 'bar' &&
        stacked &&
        visible.length > 1 &&
        values.length === visible.length &&
        new Set(mapping.y.map((id) => JSON.stringify(compiled.displays.get(id)))).size === 1
          ? {
              summary: {
                label: 'Total',
                format: 'number' as const,
                value: (() => {
                  const raw = values.map((v) => {
                    const column = dataset.columns.find((c) => c.label === v.row.metric)!;
                    return v.row.source[column.columnIndex]!;
                  });
                  const sum = raw.every((v) => /^[+-]?\d+$/.test(v))
                    ? String(raw.reduce((sum, v) => sum + BigInt(v), 0n))
                    : String(values.reduce((sum, v) => sum + v.row.y, 0));
                  return formatQuantity(sum, compiled.displays.get(mapping.y[0]));
                })()
              }
            }
          : {})
      })
    );
    if (
      showLabels &&
      displayType === 'bar' &&
      stacked &&
      gap >= 36 &&
      values.every((v) => v.row.y >= 0)
    ) {
      const interaction = model.interactionByKey.get(key)!;
      const text =
        interaction.tooltip.summary?.value ??
        (visible.length === 1 && values.length === 1
          ? interaction.tooltip.rows[0].value
          : undefined);
      if (text)
        labels.push({
          text,
          x: interaction.anchor.x - measure(text) / 2,
          y: Math.min(...values.map((v) => v.point.y)) - 9,
          priority: Math.max(...values.map((v) => v.row.y))
        });
    }
  }
  return finish(model);
};
