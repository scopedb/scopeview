import type { PaintRenderOptions, PaintState, ScenePainter } from '../../core/painter.js';
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

const SURFACE = 'var(--color-surface)';
const TEXT_PRIMARY = 'var(--color-text-primary)';
const ACCENT = 'var(--color-chart-inspection-accent)';
const GUIDE = 'var(--color-chart-inspection-guide)';
const BASELINE = 'var(--color-chart-baseline)';
const PINNED = 'var(--color-chart-inspection-pinned)';
const DASH = [2, 3];

/** Paints immutable scenes in CSS pixels; all interaction is projected host state. */
export class CanvasRenderer<Source = ResultRow> implements ScenePainter<Source> {
  model: ChartScene<Source> | null = null;
  private root = document.createElement('div');
  private output = new CanvasSurface('marks');
  private cache: CanvasSurface | null = null;
  private probe = document.createElement('span');
  private colors = new Map<string, string>();
  private inspectionColors = new Map<string, string>();
  private inkColors = new Map<string, string>();
  private targets = new Map<string, SceneMark[]>();
  private input: SceneInput<Source>;
  private state: PaintState = { inspectionKey: null, range: null };
  #font = '';
  #fontFamily = 'sans-serif';
  #fontSize: number = tokenLabelSize;
  #scaleX = 1;
  #scaleY = 1;
  #currentFont = '';
  #centerKey: string | null = null;
  private disposed = false;
  private baseInvalid = true;
  private basePaints = 0;
  private frames = 0;
  private cacheContext = '';
  private allMarksKeyed = false;

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
      paint = inspectionFill(this.color(fill), this.color(SURFACE), step);
      this.inspectionColors.set(key, paint);
    }
    return paint;
  }
  render(scene: ChartScene<Source>, state: PaintState = this.state, options?: PaintRenderOptions) {
    if (this.disposed) return;
    if (!(scene.width > 0 && scene.height > 0 && Number.isFinite(scene.width + scene.height)))
      throw new Error('Scene dimensions must be finite and positive.');
    if (!this.container.contains(this.root)) this.container.prepend(this.root);
    const geometryChanged = scene !== this.model;
    if (geometryChanged) {
      this.input.update(scene);
      this.targets.clear();
      let allKeyed = true;
      for (const mark of scene.marks) {
        if (!mark.key) {
          allKeyed = false;
          continue;
        }
        const targets = this.targets.get(mark.key) ?? [];
        targets.push(mark);
        this.targets.set(mark.key, targets);
      }
      this.allMarksKeyed = allKeyed;
    }
    this.model = scene;
    this.state = {
      ...state,
      hoverKey: state.hoverKey ?? null,
      inspectionPinned: state.inspectionPinned ?? false,
      inspectionSeries: state.inspectionSeries ?? null,
      selectedKey: state.selectedKey ?? (state.inspectionPinned ? state.inspectionKey : null),
      range: state.range && { ...state.range }
    };
    let paintsChanged = false;
    if (!options?.keepColors || this.baseInvalid || !this.colors.size) {
      const previousColors = this.colors;
      this.colors = new Map();
      this.inspectionColors.clear();
      this.inkColors.clear();
      for (const [value, resolved] of previousColors)
        if (this.color(value) !== resolved) paintsChanged = true;
    }
    const font = options?.font ?? canvasFont(this.container);
    const fontChanged = font !== this.#font;
    if (fontChanged) {
      this.#font = font;
      this.#fontSize = parseFloat(font) || tokenLabelSize;
      this.#fontFamily = font.slice(font.indexOf(' ') + 1);
    }
    this.root.style.pointerEvents = scene.interactive === false ? 'none' : '';
    this.root.dataset.hitMode = scene.hitMode;
    const density = window.devicePixelRatio || 1;
    const pixelsChanged = this.output.resize(scene.width, scene.height, density);
    // Row count is unrelated to painting cost (a line can contain 10,000 vertices).
    const dense =
      scene.marks.length >= 512 ||
      scene.marks.some((mark) => mark.kind === 'path' && mark.d.length >= 8192);
    const cached = scene.interactive !== false && dense;
    if (cached) {
      const cacheMissing = !this.cache;
      this.cache ??= new CanvasSurface('cache');
      this.cache.resize(scene.width, scene.height, density);
      if (cacheMissing || geometryChanged || fontChanged || pixelsChanged || paintsChanged)
        this.baseInvalid = true;
    } else {
      this.cache?.dispose();
      this.cache = null;
    }
    this.frame();
    const centerKey = scene.center ? JSON.stringify([scene.center.value, scene.center.label]) : '';
    if (centerKey !== this.#centerKey) {
      this.#centerKey = centerKey;
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
      this.#currentFont = this.#font;
    }
  }
  private base(
    ctx: CanvasRenderingContext2D,
    withAxes = true,
    context: { key: string | null; series: string | null } | null = null
  ) {
    this.basePaints++;
    if (withAxes) this.axes(ctx);
    const scene = this.model!;
    this.clipped(ctx, () => {
      if (scene.partial) {
        const partial = scene.partial;
        ctx.globalAlpha = tokenPartialOpacity;
        this.fillRect(ctx, partial.x, partial.y, partial.width, partial.height, TEXT_PRIMARY);
        ctx.globalAlpha = 1;
      }
      for (const mark of scene.marks) {
        const muted =
          !!context &&
          ((context.key &&
            mark.key &&
            mark.key !== context.key &&
            mark.key !== this.state.selectedKey) ||
            (context.series && mark.series && mark.series !== context.series));
        this.mark(
          ctx,
          mark,
          muted ? (scene.emphasis === 'point' ? tokenPointMutedOpacity : tokenMutedOpacity) : 1
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
    if (mark.kind === 'rect' && mark.fill === 'none') return;
    const alpha = ('opacity' in mark ? (mark.opacity ?? 1) : 1) * prominence;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.fillStyle =
      mark.kind === 'text' && mark.contrastAgainst
        ? this.ink(mark.contrastAgainst, mark.fill, mark.contrastInks)
        : this.color(mark.fill);
    if (mark.kind === 'rect') this.fillRect(ctx, mark.x, mark.y, mark.width, mark.height);
    else if (mark.kind === 'text') {
      const font = `${mark.fontWeight ?? 400} ${mark.fontSize ?? this.#fontSize}px ${this.#fontFamily}`;
      if (font !== this.#currentFont) ctx.font = this.#currentFont = font;
      ctx.textAlign = mark.align === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark.text, mark.x, mark.y);
    } else if (mark.kind === 'circle') {
      ctx.lineWidth = tokenPointStroke;
      ctx.strokeStyle = this.color(SURFACE);
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
      if (mark.fill !== 'none') ctx.fill();
      ctx.stroke();
    } else {
      ctx.save();
      const path = this.input.path(mark);
      if (mark.fill !== 'none') ctx.fill(path);
      if (mark.stroke && mark.stroke !== 'none') {
        ctx.lineWidth =
          mark.strokeWidth ?? (mark.fill === 'none' ? tokenLineWidth : tokenSeamWidth);
        ctx.strokeStyle = this.color(mark.stroke);
        ctx.lineCap = 'round';
        ctx.setLineDash(mark.dashed ? [5, 4] : []);
        ctx.stroke(path);
      }
      ctx.restore();
    }
    if (alpha !== 1) ctx.globalAlpha = 1;
  }
  private ink(background: string, fallback = TEXT_PRIMARY, preferred: readonly string[] = []) {
    const key = `${background}\0${fallback}\0${preferred.join('\0')}`;
    let paint = this.inkColors.get(key);
    if (!paint) {
      paint = contrastingInk(
        this.color(background),
        this.color(SURFACE),
        this.color(fallback),
        preferred.map((color) => this.color(color))
      );
      this.inkColors.set(key, paint);
    }
    return paint;
  }
  /** Snap straight edges in backing pixels, preserving marks narrower than one pixel. */
  private fillRect(
    ctx: CanvasRenderingContext2D,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    color?: string
  ) {
    if (rw <= 0 || rh <= 0) return;
    if (color) ctx.fillStyle = this.color(color);
    const sx = this.#scaleX,
      sy = this.#scaleY,
      x0 = Math.round(rx * sx),
      y0 = Math.round(ry * sy);
    ctx.fillRect(
      rw * sx < 1 ? rx : x0 / sx,
      rh * sy < 1 ? ry : y0 / sy,
      rw * sx < 1 ? rw : (Math.round((rx + rw) * sx) - x0) / sx,
      rh * sy < 1 ? rh : (Math.round((ry + rh) * sy) - y0) / sy
    );
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
    this.fillRect(ctx, rect.x, y, rect.width, tokenRailHeight, ACCENT);
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
    const outer = this.ink(SURFACE) === '#ffffff' ? tokenFrameDark : tokenFrameLight;
    const frame = (inset: number, weight: number, color: string) => {
      const left = rect.startClipped ? 0 : inset,
        right = rect.endClipped ? 0 : inset;
      const x = rect.x + left,
        y = rect.y + inset,
        width = rect.width - left - right,
        height = rect.height - inset * 2;
      ctx.fillStyle = color;
      this.fillRect(ctx, x, y, width, weight);
      this.fillRect(ctx, x, y + height - weight, width, weight);
      if (!rect.startClipped) this.fillRect(ctx, x, y + weight, weight, height - weight * 2);
      if (!rect.endClipped)
        this.fillRect(ctx, x + width - weight, y + weight, weight, height - weight * 2);
    };
    ctx.globalAlpha = 1;
    frame(0, outer, this.color(ACCENT));
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
    if (mark.kind === 'path' && mark.fill === 'none') {
      ctx.strokeStyle = this.color(mark.stroke ?? TEXT_PRIMARY);
      ctx.lineWidth = pinned ? tokenLinePinnedWidth : tokenLineHoverWidth;
      ctx.lineCap = 'round';
      ctx.setLineDash(mark.dashed ? [5, 4] : []);
      ctx.stroke(this.input.path(mark));
    } else {
      ctx.globalAlpha = 1;
      ctx.lineWidth =
        pinned && this.model?.emphasis === 'radial'
          ? tokenDonutPinnedWidth
          : pinned
            ? tokenPinnedWidth
            : tokenHoverWidth;
      ctx.strokeStyle = this.ink(mark.fill);
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
    }
    ctx.restore();
  }
  private emphasizeRectangle(
    ctx: CanvasRenderingContext2D,
    mark: PlotRect,
    fill: string,
    composite?: GlobalCompositeOperation
  ) {
    ctx.save();
    if (composite) ctx.globalCompositeOperation = composite;
    ctx.fillStyle = fill;
    this.fillRect(ctx, mark.x, mark.y, mark.width, mark.height);
    ctx.restore();
  }
  private targetOutline(
    ctx: CanvasRenderingContext2D,
    value: SceneInteraction<Source>,
    pinned = false
  ) {
    const marks = this.targets.get(value.key) ?? [],
      emphasis = this.model?.emphasis;
    for (const mark of marks) {
      if (mark.kind === 'path' && emphasis === 'radial' && value.radial && !pinned) {
        // The outer edge is the hover cue; retain the quiet surface-colored seams.
        this.mark(ctx, { ...mark, d: value.radial.expandedPath });
      } else if (mark.kind === 'rect') {
        if (emphasis === 'row') {
          if (mark.fill === 'transparent') {
            if (pinned) this.readingRail(ctx, { ...mark, height: mark.height - tokenRailHeight });
          } else if (!pinned) this.emphasizeRectangle(ctx, mark, this.inspectionFill(mark.fill));
        } else if (emphasis === 'cell') {
          if (pinned) this.outline(ctx, mark, true);
          else {
            const paint = this.inspectionFill(mark.fill, tokenCellHoverLightness);
            this.emphasizeRectangle(ctx, mark, paint, 'source-atop');
            for (const label of marks)
              if (label.kind === 'text') this.mark(ctx, { ...label, contrastAgainst: paint });
          }
        } else if (value.interval)
          this.entityOutline(
            ctx,
            {
              ...mark,
              startClipped: value.interval.startClipped,
              endClipped: value.interval.endClipped
            },
            mark.fill
          );
        else this.outline(ctx, mark, pinned);
      } else if (mark.kind === 'circle' && emphasis === 'point') {
        // Transient readings use the source hue; a neutral ring identifies durable selection.
        ctx.save();
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
        ctx.strokeStyle = this.color(SURFACE);
        ctx.stroke();
        ctx.lineWidth = pinned ? tokenPinnedWidth : tokenHoverWidth;
        ctx.strokeStyle = this.color(pinned ? ACCENT : mark.fill);
        ctx.stroke();
        ctx.restore();
      } else this.outline(ctx, mark, pinned);
    }
  }
  private line(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    dash?: readonly number[]
  ) {
    ctx.strokeStyle = this.color(color);
    const a = this.#scaleX,
      d = this.#scaleY,
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
    if (dash?.length) ctx.setLineDash(dash.map((value) => value * (vertical ? d : a)));
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
    ctx.save();
    ctx.fillStyle = this.color('var(--color-chart-label)');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of scene.yTicks) {
      if (scene.axisStyle !== 'minimal' && tick.position !== scene.baseline)
        this.line(ctx, r.x, tick.position, r.x + r.width, tick.position, 'var(--color-chart-grid)');
      ctx.fillText(tick.label, r.x - 8, tick.position);
    }
    if (scene.baseline !== undefined)
      this.line(ctx, r.x, scene.baseline, r.x + r.width, scene.baseline, BASELINE);
    ctx.textAlign = 'left';
    const xTickY = r.y + r.height + 11.5 + this.#fontSize / 2;
    for (const tick of scene.xTicks) {
      if (scene.axisStyle !== 'minimal')
        this.line(ctx, tick.position, r.y + r.height, tick.position, r.y + r.height + 3, BASELINE);
      ctx.fillText(tick.label, tick.labelPosition ?? tick.position, xTickY);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = this.color('var(--color-text-secondary)');
    const titleOffset = this.#fontSize / 2 + 2;
    if (scene.xTitle)
      ctx.fillText(scene.xTitle, r.x + r.width / 2, scene.height - Math.max(10, titleOffset));
    if (scene.yTitle) {
      ctx.translate(Math.max(14, titleOffset), r.y + r.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(scene.yTitle, 0, 0);
    }
    ctx.restore();
  }
  private frame() {
    const scene = this.model;
    if (this.disposed || !scene) return;
    const pointCached =
      !!this.cache && scene.emphasis === 'point' && !scene.partial && this.allMarksKeyed;
    const context = this.emphasisContext(),
      contextKey = pointCached
        ? 'point'
        : JSON.stringify([
            context.key,
            context.series,
            context.key ? this.state.selectedKey : null
          ]);
    if (this.cache && (this.baseInvalid || contextKey !== this.cacheContext)) {
      this.#scaleX = this.cache.scaleX;
      this.#scaleY = this.cache.scaleY;
      this.#currentFont = this.#font;
      this.cache.paint(this.#font, (ctx) =>
        this.base(ctx, !pointCached, pointCached ? null : context)
      );
      this.cacheContext = contextKey;
    }
    this.#scaleX = this.output.scaleX;
    this.#scaleY = this.output.scaleY;
    this.#currentFont = this.#font;
    this.output.paint(this.#font, (ctx) => {
      const r = scene.rect,
        domain = scene.time?.domain,
        interactive = scene.interactive !== false,
        map = interactive ? scene.interactionByKey : null,
        activeKey = this.state.inspectionKey ?? this.state.linkedInspectionKey;
      const value = activeKey != null && map ? (map.get(activeKey) ?? null) : null;
      const inspectionSurface = this.state.inspectionPinned
        ? PINNED
        : 'var(--color-chart-inspection-hover)';
      const selected =
        this.state.selectedKey != null && map ? (map.get(this.state.selectedKey) ?? null) : null;
      const valueMarks = value ? (this.targets.get(value.key) ?? []) : [];
      // Background state is painted before the static scene; never cover labels/fills.
      this.clipped(ctx, () => {
        if (r && selected?.band && selected.key !== value?.key)
          this.fillRect(ctx, selected.band.x, r.y, selected.band.width, r.height, PINNED);
        if (r && domain && this.state.range && domain.start < domain.end) {
          const span = domain.end - domain.start,
            left = r.x + ((this.state.range.start - domain.start) / span) * r.width;
          ctx.globalAlpha = tokenRangeOpacity;
          this.fillRect(
            ctx,
            left,
            r.y,
            ((this.state.range.end - this.state.range.start) / span) * r.width,
            r.height,
            'var(--color-text-brand)'
          );
          ctx.globalAlpha = 1;
        }
        if (r && value && scene.hitMode !== 'axis' && value.band)
          this.fillRect(ctx, value.band.x, r.y, value.band.width, r.height, inspectionSurface);
        if (r && value?.interval && this.state.inspectionPinned) {
          const interval = value.interval;
          if (!interval.startClipped)
            this.line(ctx, interval.x, r.y, interval.x, r.y + r.height, GUIDE, DASH);
          if (!interval.endClipped && interval.width > 0)
            this.line(
              ctx,
              interval.x + interval.width,
              r.y,
              interval.x + interval.width,
              r.y + r.height,
              GUIDE,
              DASH
            );
        }
        for (const mark of valueMarks)
          if (mark.kind === 'rect' && mark.fill === 'transparent')
            this.fillRect(ctx, mark.x, mark.y, mark.width, mark.height, inspectionSurface);
      });
      if (this.cache) {
        if (pointCached) {
          this.axes(ctx);
          if (context.key) ctx.globalAlpha = tokenPointMutedOpacity;
        }
        ctx.drawImage(this.cache.canvas, 0, 0, scene.width, scene.height);
        ctx.globalAlpha = 1;
      } else this.base(ctx, true, context);
      if (scene.labels?.length) {
        ctx.save();
        for (const label of scene.labels) this.mark(ctx, label);
        ctx.restore();
        this.#currentFont = this.#font;
      }
      if (scene.partial && r && r.width >= 100) {
        ctx.save();
        ctx.font = this.#font;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.color('var(--color-text-tertiary)');
        ctx.fillText('Partial data', r.x + r.width, Math.max(this.#fontSize / 2 + 2, r.y - 8));
        ctx.restore();
      }
      if (selected && selected.key !== value?.key)
        this.clipped(ctx, () => {
          if (scene.hitMode === 'item') this.targetOutline(ctx, selected, true);
          else if (r && scene.hitMode === 'axis')
            this.line(ctx, selected.anchor.x, r.y, selected.anchor.x, r.y + r.height, ACCENT);
        });
      const hover =
        scene.hitMode === 'item' && this.state.hoverKey != null && map
          ? (map.get(this.state.hoverKey) ?? null)
          : null;
      if (hover && hover.key !== value?.key)
        this.clipped(ctx, () => this.targetOutline(ctx, hover));
      if (r && selected && selected.key !== value?.key) {
        const left = selected.band?.x ?? selected.anchor.x - 6,
          width = selected.band?.width ?? 12,
          railLeft = Math.max(r.x, left);
        this.fillRect(
          ctx,
          railLeft,
          r.y + r.height + 3,
          Math.min(r.x + r.width, left + width) - railLeft,
          tokenRailHeight,
          ACCENT
        );
      }
      if (r && !this.state.inspectionKey && this.state.linkedCursor != null && interactive) {
        this.clipped(ctx, () => {
          const x = r.x + this.state.linkedCursor! * r.width;
          this.line(ctx, x, r.y, x, r.y + r.height, GUIDE, DASH);
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
          height = this.state.inspectionPinned ? tokenRailHeight : tokenRuleWidth;
        if (width > 0 && y + height <= scene.height)
          this.fillRect(ctx, (left + right - width) / 2, y, width, height, ACCENT);
      }
      this.clipped(ctx, () => {
        if (r && scene.hitMode === 'bar' && value.bars) {
          for (const bar of value.bars) {
            if (this.state.inspectionSeries !== bar.series) continue;
            const paint = this.inspectionFill(bar.color);
            this.emphasizeRectangle(ctx, bar, paint, 'source-atop');
            // Foreground annotations must survive transient fill repainting.
            for (const mark of valueMarks)
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
          this.line(ctx, value.anchor.x, r.y, value.anchor.x, r.y + r.height, GUIDE);
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
            ctx.fillStyle = this.color(active ? point.color : SURFACE);
            ctx.fill();
            ctx.strokeStyle = this.color(point.color);
            ctx.lineWidth = tokenSampleStroke;
            ctx.stroke();
          }
        } else if (scene.hitMode !== 'bar')
          this.targetOutline(ctx, value, this.state.inspectionPinned);
      });
      if (r && value.axisLabel) {
        const badgeHeight = this.#fontSize + 9,
          badgeTop = r.y + r.height + 6,
          maxW = Math.min(r.width, 260);
        if (scene.height >= badgeTop + badgeHeight + 2) {
          const label = fitLabel(value.axisLabel, maxW - 12, (text) => ctx.measureText(text).width);
          const width = Math.min(maxW, ctx.measureText(label).width + 12);
          const left = Math.max(r.x, Math.min(r.x + r.width - width, value.anchor.x - width / 2));
          this.fillRect(ctx, left, badgeTop, width, badgeHeight, TEXT_PRIMARY);
          ctx.fillStyle = this.color(SURFACE);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            label,
            left + width / 2,
            badgeTop + badgeHeight / 2,
            Math.max(1, width - 10)
          );
        }
      }
    });
    this.frames++;
    this.baseInvalid = false;
    this.root.dataset.paintStrategy = this.cache ? 'cached' : 'direct';
    this.root.dataset.surfaceCount = this.cache ? '2' : '1';
    this.root.dataset.backingBytes = String(
      this.output.backingBytes + (this.cache?.backingBytes ?? 0)
    );
  }
  link(inspectionKey: string | null, cursor: number | null) {
    if (
      inspectionKey === (this.state.linkedInspectionKey ?? null) &&
      cursor === (this.state.linkedCursor ?? null)
    )
      return;
    this.state.linkedInspectionKey = inspectionKey;
    this.state.linkedCursor = cursor;
    this.frame();
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
    const key = interaction?.key ?? null,
      s = this.state;
    pinned = key !== null && pinned;
    if (
      key === s.inspectionKey &&
      pinned === s.inspectionPinned &&
      series === s.inspectionSeries &&
      selectedKey === s.selectedKey &&
      hoverKey === s.hoverKey
    )
      return;
    s.inspectionKey = key;
    s.inspectionPinned = pinned;
    s.inspectionSeries = series;
    s.selectedKey = selectedKey;
    s.hoverKey = hoverKey;
    this.frame();
  }
  selection(range: TimeWindow | null) {
    if (range?.start === this.state.range?.start && range?.end === this.state.range?.end) return;
    this.state.range = range && { ...range };
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
    this.inkColors.clear();
    this.#centerKey = null;
    this.model = null;
    this.state = { inspectionKey: null, range: null };
    this.output.dispose();
    this.cache?.dispose();
    this.cache = null;
  }
}
