import type { PaintState, ScenePainter } from '../../core/painter.js';
import type {
  ChartInteraction,
  ChartScene,
  Inspect,
  PlotRect,
  SceneInteraction,
  SceneMark
} from '../../core/scene.js';
import type { TimeWindow } from '../../data/time.js';
import type { ResultRow } from '../../data/result.js';
import { CanvasSurface } from './surface.js';
import { SceneInput } from './scene-input.js';
import { contrastingInk, inspectionFill } from './contrast.js';
import { fitLabel } from '../../core/labels.js';
import {
  activeSampleRadius as tokenActiveSampleRadius,
  cellHoverLightness as tokenCellHoverLightness,
  donutPinnedWidth as tokenDonutPinnedWidth,
  frameDark as tokenFrameDark,
  frameInner as tokenFrameInner,
  frameLight as tokenFrameLight,
  hoverWidth as tokenHoverWidth,
  labelSize as tokenLabelSize,
  lineHoverWidth as tokenLineHoverWidth,
  linePinnedWidth as tokenLinePinnedWidth,
  lineWidth as tokenLineWidth,
  mutedOpacity as tokenMutedOpacity,
  partialOpacity as tokenPartialOpacity,
  pinnedWidth as tokenPinnedWidth,
  pointHoverGrowth as tokenPointHoverGrowth,
  pointMutedOpacity as tokenPointMutedOpacity,
  pointPinnedGrowth as tokenPointPinnedGrowth,
  pointSeparator as tokenPointSeparator,
  pointStroke as tokenPointStroke,
  railHeight as tokenRailHeight,
  rangeOpacity as tokenRangeOpacity,
  ruleWidth as tokenRuleWidth,
  sampleRadius as tokenSampleRadius,
  sampleStroke as tokenSampleStroke,
  seamWidth as tokenSeamWidth
} from '../../theme/visual-tokens.js';
import { canvasFont } from './typography.js';
export interface CanvasDiagnostics {
  strategy: 'direct' | 'cached';
  surfaces: number;
  /** Nominal RGBA backing bytes, including the detached static cache. */
  backingBytes: number;
  basePaints: number;
  frames: number;
}

/** Paints immutable scenes in CSS pixels; all interaction is projected host state. */
export class CanvasRenderer<Source = ResultRow> implements ScenePainter<Source> {
  model: ChartScene<Source> | null = null;
  private root = document.createElement('div');
  private output = new CanvasSurface('marks');
  private cache: CanvasSurface | null = null;
  private probe = document.createElement('span');
  private colors = new Map<string, string>();
  private inspectionColors = new Map<string, string>();
  private targets = new Map<string, SceneMark[]>();
  private input: SceneInput<Source>;
  private state: PaintState = { inspectionKey: null, range: null };
  #font = '';
  #fontFamily = 'sans-serif';
  #fontSize: number = tokenLabelSize;
  private disposed = false;
  private baseInvalid = true;
  private basePaints = 0;
  private frames = 0;
  private cacheContext = '';

  constructor(container: HTMLElement, decoration: HTMLElement, inspect: Inspect<Source>);
  constructor(
    private container: HTMLElement,
    private decoration: HTMLElement,
    inspect: Inspect<Source>,
    ...extra: unknown[]
  ) {
    if (extra.length) throw new TypeError('CanvasRenderer expects 3 arguments.');
    this.root.className = 'plot plot-canvas';
    this.root.dataset.renderer = 'canvas';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
    // The DPR-sized bitmap already contains antialiasing. Fractional CSS boxes
    // must not filter those pixels again when the browser composes the page.
    this.output.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none';
    this.probe.hidden = true;
    this.root.append(this.output.canvas, this.probe);
    container.prepend(this.root);
    this.input = new SceneInput(this.root, inspect);
  }
  get diagnostics(): Readonly<CanvasDiagnostics> {
    return {
      strategy: this.cache ? 'cached' : 'direct',
      surfaces: this.disposed ? 0 : this.cache ? 2 : 1,
      backingBytes: this.output.backingBytes + (this.cache?.backingBytes ?? 0),
      basePaints: this.basePaints,
      frames: this.frames
    };
  }
  /** External resources (for example, a loaded font) can change without new geometry. */
  invalidate() {
    this.baseInvalid = true;
  }
  private color(value: string) {
    if (value === 'none') return 'transparent';
    let color = this.colors.get(value);
    if (!color) {
      this.probe.style.color = value;
      color = getComputedStyle(this.probe).color;
      this.colors.set(value, color);
    }
    return color;
  }
  private inspectionFill(fill: string, step?: number) {
    const key = `${fill}:${step ?? ''}`;
    let paint = this.inspectionColors.get(key);
    if (!paint) {
      paint = inspectionFill(this.color(fill), this.color('var(--color-surface)'), step);
      this.inspectionColors.set(key, paint);
    }
    return paint;
  }
  render(scene: ChartScene<Source>, state: PaintState = this.state) {
    if (this.disposed) return;
    if (!(scene.width > 0 && scene.height > 0 && Number.isFinite(scene.width + scene.height)))
      throw new Error('Scene dimensions must be finite and positive.');
    if (!this.container.contains(this.root)) this.container.prepend(this.root);
    const geometryChanged = scene !== this.model;
    if (geometryChanged) {
      this.input.update(scene);
      this.targets.clear();
      for (const mark of scene.marks) {
        if (!mark.key) continue;
        const targets = this.targets.get(mark.key) ?? [];
        targets.push(mark);
        this.targets.set(mark.key, targets);
      }
    }
    this.model = scene;
    this.state = {
      inspectionKey: state.inspectionKey,
      hoverKey: state.hoverKey ?? null,
      linkedInspectionKey: state.linkedInspectionKey,
      linkedCursor: state.linkedCursor,
      inspectionPinned: state.inspectionPinned ?? false,
      inspectionSeries: state.inspectionSeries ?? null,
      selectedKey: state.selectedKey ?? (state.inspectionPinned ? state.inspectionKey : null),
      range: state.range && { ...state.range }
    };
    const previousColors = this.colors;
    this.colors = new Map();
    this.inspectionColors.clear();
    let paintsChanged = false;
    for (const [value, resolved] of previousColors)
      if (this.color(value) !== resolved) paintsChanged = true;
    const font = canvasFont(this.container);
    this.#fontSize = parseFloat(font);
    this.#fontFamily = font.slice(font.indexOf(' ') + 1);
    const fontChanged = font !== this.#font;
    this.#font = font;
    this.root.style.pointerEvents = scene.interactive === false ? 'none' : '';
    this.root.dataset.hitMode = scene.hitMode;
    const density = window.devicePixelRatio || 1;
    const pixelsChanged =
      this.output.canvas.width !== Math.round(scene.width * density) ||
      this.output.canvas.height !== Math.round(scene.height * density);
    this.output.resize(scene.width, scene.height, density);
    // Row count is unrelated to painting cost (a line can contain 10,000 vertices).
    const dense =
      scene.marks.length >= 512 ||
      scene.marks.some((mark) => mark.kind === 'path' && mark.d.length >= 8192);
    const cached = scene.interactive !== false && dense;
    if (cached) {
      const cacheMissing = !this.cache;
      this.cache ??= new CanvasSurface('cache');
      this.cache.resize(scene.width, scene.height, density);
      if (
        this.baseInvalid ||
        cacheMissing ||
        geometryChanged ||
        fontChanged ||
        pixelsChanged ||
        paintsChanged
      )
        this.baseInvalid = true;
    } else {
      this.cache?.dispose();
      this.cache = null;
    }
    this.frame();
    this.baseInvalid = false;
    this.decoration.replaceChildren();
    if (scene.center) {
      const center = document.createElement('div'),
        value = document.createElement('strong'),
        label = document.createElement('span');
      center.className = 'center';
      value.textContent = scene.center.value;
      label.textContent = scene.center.label;
      center.append(value, label);
      this.decoration.append(center);
    }
  }
  private clipped(ctx: CanvasRenderingContext2D, draw: () => void) {
    ctx.save();
    try {
      const clip = this.model!.clipRect ?? this.model!.rect;
      if (clip) {
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.width, clip.height);
        ctx.clip();
      }
      draw();
    } finally {
      ctx.restore();
    }
  }
  private base(ctx: CanvasRenderingContext2D) {
    this.basePaints++;
    ctx.save();
    try {
      this.axes(ctx);
    } finally {
      ctx.restore();
    }
    const context = this.emphasisContext();
    this.clipped(ctx, () => {
      if (this.model!.partial) {
        ctx.save();
        ctx.globalAlpha = tokenPartialOpacity;
        ctx.fillStyle = this.color('var(--color-text-primary)');
        this.rectangle(ctx, this.model!.partial!);
        ctx.restore();
      }
      for (const mark of this.model!.marks) {
        const muted =
          (context.key &&
            mark.key &&
            mark.key !== context.key &&
            mark.key !== this.state.selectedKey) ||
          (context.series && mark.series && mark.series !== context.series);
        this.mark(
          ctx,
          mark,
          muted
            ? this.model!.emphasis === 'point'
              ? tokenPointMutedOpacity
              : tokenMutedOpacity
            : 1
        );
      }
    });
  }
  private emphasisContext() {
    const scene = this.model!;
    const value = this.state.inspectionKey
      ? scene.interactionByKey.get(this.state.inspectionKey)
      : null;
    return {
      key: scene.emphasis === 'point' ? (value?.key ?? null) : null,
      series:
        scene.emphasis === 'series' &&
        value?.points.some((point) => point.series === this.state.inspectionSeries)
          ? (this.state.inspectionSeries ?? null)
          : null
    };
  }
  private mark(ctx: CanvasRenderingContext2D, mark: SceneMark, prominence = 1) {
    ctx.save();
    try {
      ctx.fillStyle = this.color(mark.fill);
      ctx.globalAlpha = ('opacity' in mark ? (mark.opacity ?? 1) : 1) * prominence;
      ctx.lineWidth =
        mark.kind === 'path' && mark.strokeWidth !== undefined
          ? mark.strokeWidth
          : mark.kind === 'circle'
            ? tokenPointStroke
            : mark.fill === 'none'
              ? tokenLineWidth
              : tokenSeamWidth;
      ctx.strokeStyle = this.color(
        mark.kind === 'path' ? (mark.stroke ?? 'transparent') : 'var(--color-surface)'
      );
      if (mark.kind === 'path') {
        const path = this.input.path(mark);
        if (mark.fill !== 'none') ctx.fill(path);
        if (mark.stroke && mark.stroke !== 'none') {
          ctx.lineCap = 'round';
          ctx.setLineDash(mark.dashed ? [5, 4] : []);
          ctx.stroke(path);
        }
      } else if (mark.kind === 'rect') {
        if (mark.fill !== 'none') this.rectangle(ctx, mark);
      } else if (mark.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
        if (mark.fill !== 'none') ctx.fill();
        ctx.stroke();
      } else {
        if (mark.contrastAgainst)
          ctx.fillStyle = this.ink(mark.contrastAgainst, mark.fill, mark.contrastInks);
        ctx.font = `${mark.fontWeight ?? 400} ${mark.fontSize ?? this.#fontSize}px ${this.#fontFamily}`;
        ctx.textAlign = mark.align === 'end' ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(mark.text, mark.x, mark.y);
      }
    } finally {
      ctx.restore();
    }
  }
  private ink(
    background: string,
    fallback = 'var(--color-text-primary)',
    preferred: readonly string[] = []
  ) {
    return contrastingInk(
      this.color(background),
      this.color('var(--color-surface)'),
      this.color(fallback),
      preferred.map((color) => this.color(color))
    );
  }
  /** Snap straight edges in backing pixels, preserving marks narrower than one pixel. */
  private rectangle(ctx: CanvasRenderingContext2D, rect: PlotRect) {
    const { a, d } = ctx.getTransform();
    const axis = (start: number, size: number, scale: number) => {
      if (size * scale < 1) return [start, size];
      const edge = Math.round(start * scale);
      return [edge / scale, (Math.round((start + size) * scale) - edge) / scale];
    };
    const [x, width] = axis(rect.x, rect.width, a),
      [y, height] = axis(rect.y, rect.height, d);
    ctx.fillRect(x, y, width, height);
  }
  /** A reading rail uses the row gutter so source fill and label ink stay intact. */
  private readingRail(ctx: CanvasRenderingContext2D, rect: PlotRect) {
    const clip = this.model!.clipRect ?? this.model!.rect;
    if (!clip || rect.width <= 0 || rect.height <= 0) return;
    const below = rect.y + rect.height,
      above = rect.y - tokenRailHeight,
      y = below + tokenRailHeight <= clip.y + clip.height ? below : above;
    if (y < clip.y) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.color('var(--color-chart-inspection-accent, var(--color-text-primary))');
    ctx.fillRect(rect.x, y, rect.width, tokenRailHeight);
  }
  /** Separate the target from both the host surface and its own source fill. */
  private entityOutline(
    ctx: CanvasRenderingContext2D,
    rect: PlotRect & { startClipped?: boolean; endClipped?: boolean },
    fill: string
  ) {
    if (rect.width < 10 || rect.height < 10) {
      this.readingRail(ctx, rect);
      return;
    }
    const outer = this.ink('var(--color-surface)') === '#ffffff' ? tokenFrameDark : tokenFrameLight;
    const frame = (inset: number, weight: number, color: string) => {
      const x = rect.x + inset,
        y = rect.y + inset,
        width = rect.width - inset * 2,
        height = rect.height - inset * 2;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, weight);
      ctx.fillRect(x, y + height - weight, width, weight);
      if (!rect.startClipped) ctx.fillRect(x, y + weight, weight, height - weight * 2);
      if (!rect.endClipped)
        ctx.fillRect(x + width - weight, y + weight, weight, height - weight * 2);
    };
    ctx.globalAlpha = 1;
    frame(0, outer, this.color('var(--color-chart-inspection-accent, var(--color-text-primary))'));
    frame(outer, tokenFrameInner, this.ink(fill));
  }
  /** Inspection decorates geometry without covering labels or changing data paint. */
  private outline(
    ctx: CanvasRenderingContext2D,
    mark: SceneMark,
    pinned = this.state.inspectionPinned
  ) {
    if (mark.kind === 'text' || mark.fill === 'transparent') return;
    if (mark.kind === 'rect' && this.model?.viewport) {
      this.entityOutline(ctx, mark, mark.fill);
      return;
    }
    // A tiny positive bar must retain its data ink instead of becoming all border.
    if (mark.kind === 'rect' && (mark.width < 4 || mark.height < 4)) return;
    ctx.save();
    try {
      if (mark.kind === 'path' && mark.fill === 'none') {
        ctx.strokeStyle = this.color(mark.stroke ?? 'var(--color-text-primary)');
        ctx.lineWidth = pinned ? tokenLinePinnedWidth : tokenLineHoverWidth;
        ctx.lineCap = 'round';
        ctx.setLineDash(mark.dashed ? [5, 4] : []);
        ctx.stroke(this.input.path(mark));
        return;
      }
      const draw = () => {
        if (mark.kind === 'rect') {
          const inset = Math.min(ctx.lineWidth / 2, mark.width / 2, mark.height / 2);
          ctx.strokeRect(
            mark.x + inset,
            mark.y + inset,
            mark.width - inset * 2,
            mark.height - inset * 2
          );
        } else if (mark.kind === 'circle') {
          ctx.beginPath();
          ctx.arc(mark.x, mark.y, Math.max(0, mark.radius - ctx.lineWidth / 2), 0, Math.PI * 2);
          ctx.stroke();
        } else ctx.stroke(this.input.path(mark));
      };
      ctx.globalAlpha = 1;
      ctx.lineWidth =
        pinned && this.model?.emphasis === 'radial'
          ? tokenDonutPinnedWidth
          : pinned
            ? tokenPinnedWidth
            : tokenHoverWidth;
      ctx.strokeStyle = this.ink(mark.fill);
      draw();
    } finally {
      ctx.restore();
    }
  }
  private emphasizeRectangle(
    ctx: CanvasRenderingContext2D,
    mark: Extract<SceneMark, { kind: 'rect' }>,
    fill: string,
    composite?: GlobalCompositeOperation
  ) {
    ctx.save();
    try {
      if (composite) ctx.globalCompositeOperation = composite;
      ctx.fillStyle = fill;
      this.rectangle(ctx, mark);
    } finally {
      ctx.restore();
    }
  }
  private targetOutline(
    ctx: CanvasRenderingContext2D,
    value: SceneInteraction<Source>,
    pinned = false
  ) {
    for (const mark of this.targets.get(value.key) ?? []) {
      if (mark.kind === 'path' && this.model?.emphasis === 'radial' && value.radial && !pinned) {
        // The outer edge is the hover cue; retain the quiet surface-colored seams.
        this.mark(ctx, { ...mark, d: value.radial.expandedPath });
      } else if (mark.kind === 'rect' && this.model?.emphasis === 'row') {
        if (mark.fill === 'transparent') {
          if (pinned) this.readingRail(ctx, { ...mark, height: mark.height - tokenRailHeight });
        } else if (!pinned) this.emphasizeRectangle(ctx, mark, this.inspectionFill(mark.fill));
      } else if (mark.kind === 'rect' && this.model?.emphasis === 'cell') {
        if (pinned) this.outline(ctx, mark, true);
        else {
          const paint = this.inspectionFill(mark.fill, tokenCellHoverLightness);
          this.emphasizeRectangle(ctx, mark, paint, 'source-atop');
          for (const label of this.targets.get(value.key) ?? [])
            if (label.kind === 'text') this.mark(ctx, { ...label, contrastAgainst: paint });
        }
      } else if (mark.kind === 'circle' && this.model?.emphasis === 'point') {
        // Transient readings use the source hue; a neutral ring identifies durable selection.
        ctx.save();
        try {
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(
            mark.x,
            mark.y,
            mark.radius + (pinned ? tokenPointPinnedGrowth : tokenPointHoverGrowth),
            0,
            Math.PI * 2
          );
          ctx.fillStyle = this.color(mark.fill);
          ctx.fill();
          ctx.lineWidth = tokenPointSeparator;
          ctx.strokeStyle = this.color('var(--color-surface)');
          ctx.stroke();
          ctx.lineWidth = pinned ? tokenPinnedWidth : tokenHoverWidth;
          ctx.strokeStyle = this.color(pinned ? 'var(--color-chart-inspection-accent)' : mark.fill);
          ctx.stroke();
        } finally {
          ctx.restore();
        }
      } else if (mark.kind === 'rect' && value.interval)
        this.entityOutline(
          ctx,
          {
            ...mark,
            startClipped: value.interval?.startClipped,
            endClipped: value.interval?.endClipped
          },
          mark.fill
        );
      else this.outline(ctx, mark, pinned);
    }
  }
  private line(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string
  ) {
    ctx.strokeStyle = this.color(color);
    const { a, d } = ctx.getTransform(),
      vertical = x1 === x2,
      scale = vertical ? a : d,
      weight = Math.max(1, Math.round(tokenRuleWidth * scale));
    x1 *= a;
    x2 *= a;
    y1 *= d;
    y2 *= d;
    const position = Math.round((vertical ? x1 : y1) - weight / 2) + weight / 2;
    if (vertical) x1 = x2 = position;
    else y1 = y2 = position;
    ctx.save();
    ctx.setLineDash(ctx.getLineDash().map((value) => value * (vertical ? d : a)));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
  private axes(ctx: CanvasRenderingContext2D) {
    const scene = this.model!,
      r = scene.rect;
    if (!r) return;
    ctx.fillStyle = this.color('var(--color-chart-label, var(--color-text-tertiary))');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of scene.yTicks) {
      if (scene.axisStyle !== 'minimal' && tick.position !== scene.baseline)
        this.line(
          ctx,
          r.x,
          tick.position,
          r.x + r.width,
          tick.position,
          'var(--color-chart-grid, var(--color-border-light))'
        );
      ctx.fillText(tick.label, r.x - 8, tick.position);
    }
    if (scene.baseline !== undefined)
      this.line(
        ctx,
        r.x,
        scene.baseline,
        r.x + r.width,
        scene.baseline,
        'var(--color-chart-baseline, var(--color-chart-axis))'
      );
    ctx.textAlign = 'left';
    for (const tick of scene.xTicks) {
      if (scene.axisStyle !== 'minimal')
        this.line(
          ctx,
          tick.position,
          r.y + r.height,
          tick.position,
          r.y + r.height + 3,
          'var(--color-chart-baseline, var(--color-chart-axis))'
        );
      ctx.fillText(tick.label, tick.labelPosition ?? tick.position, r.y + r.height + 17);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = this.color('var(--color-text-secondary)');
    if (scene.xTitle)
      ctx.fillText(
        scene.xTitle,
        r.x + r.width / 2,
        scene.height - Math.max(10, this.#fontSize / 2 + 2)
      );
    if (scene.yTitle) {
      ctx.save();
      try {
        ctx.translate(Math.max(14, this.#fontSize / 2 + 2), r.y + r.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(scene.yTitle, 0, 0);
      } finally {
        ctx.restore();
      }
    }
  }
  private frame() {
    const scene = this.model;
    if (this.disposed || !scene) return;
    const context = this.emphasisContext(),
      contextKey = JSON.stringify([
        context.key,
        context.series,
        context.key ? this.state.selectedKey : null
      ]);
    if (this.cache && (this.baseInvalid || contextKey !== this.cacheContext)) {
      this.cache.paint(this.#font, (ctx) => this.base(ctx));
      this.cacheContext = contextKey;
    }
    this.output.paint(this.#font, (ctx) => {
      const r = scene.rect,
        domain = scene.time?.domain;
      const value =
        (this.state.inspectionKey ?? this.state.linkedInspectionKey) && scene.interactive !== false
          ? scene.interactionByKey.get(
              (this.state.inspectionKey ?? this.state.linkedInspectionKey)!
            )
          : null;
      const inspectionSurface = this.state.inspectionPinned
        ? 'var(--color-chart-inspection-pinned, var(--color-surface-pressed))'
        : 'var(--color-chart-inspection-hover, var(--color-surface-hover))';
      const selected =
        this.state.selectedKey && scene.interactive !== false
          ? scene.interactionByKey.get(this.state.selectedKey)
          : null;
      // Background state is painted before the static scene; never cover labels/fills.
      this.clipped(ctx, () => {
        if (r && selected?.band && selected.key !== value?.key) {
          ctx.fillStyle = this.color('var(--color-chart-inspection-pinned)');
          ctx.fillRect(selected.band.x, r.y, selected.band.width, r.height);
        }
        if (r && domain && this.state.range && domain.start < domain.end) {
          const x = (time: number) =>
            r.x + ((time - domain.start) / (domain.end - domain.start)) * r.width;
          ctx.globalAlpha = tokenRangeOpacity;
          ctx.fillStyle = this.color('var(--color-text-brand)');
          ctx.fillRect(
            x(this.state.range.start),
            r.y,
            x(this.state.range.end) - x(this.state.range.start),
            r.height
          );
          ctx.globalAlpha = 1;
        }
        if (r && value && scene.hitMode !== 'axis' && value.band) {
          ctx.fillStyle = this.color(inspectionSurface);
          ctx.fillRect(value.band.x, r.y, value.band.width, r.height);
        }
        if (r && value?.interval) {
          const interval = value.interval;
          if (this.state.inspectionPinned) {
            ctx.setLineDash([2, 3]);
            const guide = 'var(--color-chart-inspection-guide, var(--color-chart-guide))';
            if (!interval.startClipped)
              this.line(ctx, interval.x, r.y, interval.x, r.y + r.height, guide);
            if (!interval.endClipped && interval.width > 0)
              this.line(
                ctx,
                interval.x + interval.width,
                r.y,
                interval.x + interval.width,
                r.y + r.height,
                guide
              );
            ctx.setLineDash([]);
          }
        }
        if (value)
          for (const mark of this.targets.get(value.key) ?? [])
            if (mark.kind === 'rect' && mark.fill === 'transparent') {
              ctx.fillStyle = this.color(inspectionSurface);
              ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
            }
      });
      if (this.cache) ctx.drawImage(this.cache.canvas, 0, 0, scene.width, scene.height);
      else this.base(ctx);
      for (const label of scene.labels ?? []) this.mark(ctx, label);
      if (scene.partial && r && r.width >= 100) {
        ctx.save();
        ctx.font = this.#font;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.color('var(--color-text-tertiary)');
        ctx.fillText('Partial data', r.x + r.width, r.y - 8);
        ctx.restore();
      }
      if (selected && selected.key !== value?.key)
        this.clipped(ctx, () => {
          if (scene.hitMode === 'item') this.targetOutline(ctx, selected, true);
          else if (r && scene.hitMode === 'axis')
            this.line(
              ctx,
              selected.anchor.x,
              r.y,
              selected.anchor.x,
              r.y + r.height,
              'var(--color-chart-inspection-accent)'
            );
        });
      const hover =
        scene.interactive !== false && scene.hitMode === 'item' && this.state.hoverKey
          ? scene.interactionByKey.get(this.state.hoverKey)
          : null;
      if (hover && hover.key !== value?.key)
        this.clipped(ctx, () => this.targetOutline(ctx, hover));
      if (r && selected && selected.key !== value?.key) {
        const left = selected.band?.x ?? selected.anchor.x - 6;
        const width = selected.band?.width ?? 12;
        ctx.fillStyle = this.color('var(--color-chart-inspection-accent)');
        ctx.fillRect(
          Math.max(r.x, left),
          r.y + r.height + 3,
          Math.max(0, Math.min(r.x + r.width, left + width) - Math.max(r.x, left)),
          2
        );
      }
      if (
        r &&
        !this.state.inspectionKey &&
        this.state.linkedCursor != null &&
        scene.interactive !== false
      ) {
        this.clipped(ctx, () => {
          ctx.setLineDash([2, 3]);
          const x = r.x + this.state.linkedCursor! * r.width;
          this.line(
            ctx,
            x,
            r.y,
            x,
            r.y + r.height,
            'var(--color-chart-inspection-guide, var(--color-chart-guide))'
          );
          ctx.setLineDash([]);
        });
      }
      if (!value) return;
      // Bars are read as a whole column. A reading marks that column in the axis gutter;
      // framing each segment would turn a stack/group into a set of selected boxes.
      if (r && scene.hitMode === 'bar' && value.band) {
        const left = Math.max(r.x, value.band.x),
          right = Math.min(r.x + r.width, value.band.x + value.band.width),
          width = Math.min(16, Math.max(0, right - left)),
          y = r.y + r.height + 3,
          height = this.state.inspectionPinned ? 2 : 1;
        if (width > 0 && y + height <= scene.height) {
          ctx.fillStyle = this.color(
            'var(--color-chart-inspection-accent, var(--color-text-primary))'
          );
          ctx.fillRect((left + right - width) / 2, y, width, height);
        }
      }
      this.clipped(ctx, () => {
        if (r && scene.hitMode === 'bar' && value.bars) {
          for (const bar of value.bars) {
            if (this.state.inspectionSeries !== bar.series) continue;
            const paint = this.inspectionFill(bar.color);
            ctx.save();
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = paint;
            this.rectangle(ctx, bar);
            ctx.restore();
            // Foreground annotations must survive transient fill repainting.
            for (const mark of this.targets.get(value.key) ?? [])
              if (
                mark.kind === 'text' &&
                mark.x >= bar.x &&
                mark.x <= bar.x + bar.width &&
                mark.y >= bar.y &&
                mark.y <= bar.y + bar.height
              )
                this.mark(ctx, { ...mark, contrastAgainst: paint });
          }
        }
        if (r && scene.hitMode === 'axis') {
          this.line(
            ctx,
            value.anchor.x,
            r.y,
            value.anchor.x,
            r.y + r.height,
            'var(--color-chart-inspection-guide, var(--color-chart-guide))'
          );
          ctx.setLineDash([]);
          for (const point of value.points) {
            const active = this.state.inspectionSeries === point.series;
            // Stacked boundaries can coincide at zero. One active dot keeps the reading unambiguous.
            if (point.baseY !== undefined && this.state.inspectionSeries && !active) continue;
            ctx.beginPath();
            ctx.arc(
              point.x,
              point.y,
              active ? tokenActiveSampleRadius : tokenSampleRadius,
              0,
              Math.PI * 2
            );
            ctx.fillStyle = this.color(active ? point.color : 'var(--color-surface)');
            ctx.fill();
            ctx.strokeStyle = this.color(point.color);
            ctx.lineWidth = tokenSampleStroke;
            ctx.stroke();
          }
        } else if (scene.hitMode !== 'bar')
          this.targetOutline(ctx, value, this.state.inspectionPinned);
      });
      if (r && value.axisLabel && scene.height >= r.y + r.height + 28) {
        const label = fitLabel(
          value.axisLabel,
          Math.min(r.width, 260) - 12,
          (text) => ctx.measureText(text).width
        );
        const width = Math.min(r.width, 260, ctx.measureText(label).width + 12);
        const left = Math.max(r.x, Math.min(r.x + r.width - width, value.anchor.x - width / 2));
        ctx.fillStyle = this.color('var(--color-text-primary)');
        ctx.fillRect(left, r.y + r.height + 6, width, 20);
        ctx.fillStyle = this.color('var(--color-surface)');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, left + width / 2, r.y + r.height + 16, Math.max(1, width - 10));
      }
    });
    this.frames++;
    this.baseInvalid = false;
    const { strategy, surfaces, backingBytes } = this.diagnostics;
    this.root.dataset.paintStrategy = strategy;
    this.root.dataset.surfaceCount = String(surfaces);
    this.root.dataset.backingBytes = String(backingBytes);
  }
  anchor(interaction: ChartInteraction<Source>) {
    return this.model?.interactionByKey.get(interaction.key)?.anchor ?? null;
  }
  focus(
    interaction: ChartInteraction<Source> | null,
    pinned = false,
    series: string | null = null,
    selectedKey: string | null = pinned ? (interaction?.key ?? null) : null,
    hoverKey: string | null = null
  ) {
    const key = interaction?.key ?? null;
    pinned = key !== null && pinned;
    if (
      key === this.state.inspectionKey &&
      pinned === this.state.inspectionPinned &&
      series === this.state.inspectionSeries &&
      selectedKey === this.state.selectedKey &&
      hoverKey === this.state.hoverKey
    )
      return;
    this.state = {
      ...this.state,
      inspectionKey: key,
      inspectionPinned: pinned,
      inspectionSeries: series,
      selectedKey,
      hoverKey
    };
    this.frame();
  }
  selection(range: TimeWindow | null) {
    if (range?.start === this.state.range?.start && range?.end === this.state.range?.end) return;
    this.state = { ...this.state, range: range && { ...range } };
    this.frame();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
    this.root.remove();
    this.decoration.replaceChildren();
    this.targets.clear();
    this.colors.clear();
    this.inspectionColors.clear();
    this.model = null;
    this.state = { inspectionKey: null, range: null };
    this.output.dispose();
    this.cache?.dispose();
    this.cache = null;
  }
}
