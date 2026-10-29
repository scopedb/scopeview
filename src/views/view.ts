import { sceneSnapshot } from '../core/scene-snapshot.js';
import { interactionFor } from '../core/interaction.js';
import type { ChartInteraction, Position } from '../core/scene.js';
import type { InspectionContext } from '../core/inspection-context.js';
import { InspectionNotifications } from '../core/inspection-notifications.js';
import type { SceneLayout } from '../runtime/types.js';
import { ReadingRuntime } from '../runtime/reading-runtime.js';
import { node } from '../ui/dom.js';
import { hideInspection, positionInspection } from '../ui/inspection-floating.js';
import { renderPreview } from '../ui/inspection-preview.js';
import styles from '../theme/headless.css?inline';
import baseTokens from '../theme/headless-tokens.css?inline';
import { ViewHost, type ChartView } from './host.js';
import { interactionHosts, type ViewportDriver } from './interactions.js';
export type { ChartTheme, ChartView, ThemeConfig, ThemeMode } from './host.js';
import type { ViewOptions } from './options.js';
export type { ViewOptions } from './options.js';
type ContextProjector<Source, Context> = (
  target: ChartInteraction<Source> | null,
  series: string | null,
  snapshot: object
) => Context | null;

/** A canvas and transient reading. Application UI stays outside this owned child. */
export class View<Source, Context extends InspectionContext> extends ViewHost implements ChartView {
  readonly canvas = node('div', 'canvas');
  readonly runtime: ReadingRuntime<Source>;
  viewport?: ViewportDriver;
  declare update: (document: unknown) => void;
  #tooltip = node('div', 'tooltip');
  #status = node('div', 'status');
  #statusMessage: string | null = null;
  #readingVisible = true;
  #position: Position | null = null;
  #cleanups: (() => void)[] = [];
  #notifications: InspectionNotifications<Source>;
  readonly #contextFor: ContextProjector<Source, Context>;

  constructor(
    host: HTMLElement,
    readonly options: ViewOptions<Source, Context>,
    tokens: string,
    layout: SceneLayout<Source>,
    contextFor: ContextProjector<Source, Context>,
    input?: {
      onNavigate?(target: ChartInteraction<Source>): void;
      inputConsumed?(): boolean;
    }
  ) {
    super(host, styles, baseTokens + tokens, options.theme);
    this.#contextFor = contextFor;
    const signal = this.events.signal;
    const decoration = node('div', 'decoration');
    this.#tooltip.hidden = true;
    this.root.append(this.canvas, decoration, this.#status, this.#tooltip);
    this.runtime = new ReadingRuntime(this.canvas, decoration, {
      layout,
      ...input,
      onInspect: (_target, position) => {
        this.#position = position;
        this.#reading();
      },
      onRender: () => {
        if (this.element.dataset.state === 'error') this.#showStatus(this.#statusMessage);
        this.element.dataset.state = 'ready';
        this.#reading();
      },
      onError: (error) => {
        this.#reading();
        this.#showStatus('Unable to render chart.');
        this.element.dataset.state = 'error';
        options.onError?.(error);
      }
    });
    this.#notifications = new InspectionNotifications(() => {
      const session = this.runtime.session;
      return {
        snapshot: sceneSnapshot(this.runtime.model),
        inspect: {
          target:
            !this.#readingVisible || this.runtime.model?.interactive === false
              ? null
              : session.keyboardInspection
                ? session.active
                : this.#position
                  ? session.hovered
                  : null,
          series: session.series
        },
        select: { target: session.selected, series: session.selectedSeries }
      };
    }, interactionFor(this.runtime.session));
    this.repaint = () => this.runtime.refresh('paint');
    interactionHosts.set(this, {
      select: (enabled) => {
        if (this.disposed) return;
        this.runtime.selectable = enabled;
        if (!enabled) this.clearInspection();
      },
      cleanup: (callback) => this.#cleanups.push(callback)
    });
    const dismiss = (event: Event) => {
      if (event.composedPath().includes(this.element)) return;
      this.clearInspection();
    };
    document.addEventListener('pointerdown', dismiss, { signal });
    document.addEventListener('focusin', dismiss, { signal });
    window.addEventListener(
      'scroll',
      () => {
        if (this.runtime.session.keyboardInspection) this.#reading();
        else this.hideReading();
      },
      { capture: true, signal }
    );
  }
  #reading() {
    this.#readingVisible = true;
    this.#report();
  }
  #presentReading(batch: ReturnType<InspectionNotifications<Source>['capture']>) {
    this.runtime.focus(this.runtime.session.active);
    const { target, series } = batch.state.inspect;
    if (!target || this.options.tooltip === false) {
      hideInspection(this.#tooltip);
    } else {
      renderPreview(this.#tooltip, target, series);
      const bounds = this.canvas.getBoundingClientRect();
      const anchor = this.#position ?? this.runtime.anchor(target);
      if (anchor)
        positionInspection(this.#tooltip, {
          x: bounds.left + anchor.x,
          y: bounds.top + anchor.y
        });
      else hideInspection(this.#tooltip);
    }
  }
  #report() {
    const batch = this.#notifications.capture();
    interactionFor(this.runtime.session).effect(
      () => this.#presentReading(batch),
      this.#tooltip,
      0,
      () => batch.current('inspect')
    );
    for (const channel of ['select', 'inspect'] as const)
      batch.emit(channel, (value, snapshot) =>
        this.options[channel === 'select' ? 'onSelect' : 'onInspect']?.(
          value.target,
          snapshot ? this.#contextFor(value.target, value.series, snapshot) : null
        )
      );
  }

  hideReading() {
    this.#dismiss(false);
  }
  clearInspection() {
    this.#dismiss(true);
  }
  #dismiss(clear: boolean) {
    interactionFor(this.runtime.session).batch(() => {
      this.#notifications.invalidate(clear ? undefined : 'inspect');
      if (clear) this.runtime.session.clearInspection();
      this.#position = null;
      this.#readingVisible = clear;
      this.#report();
    });
  }
  status(message: string | null) {
    this.#statusMessage = message;
    this.#showStatus(message);
  }
  #showStatus(message: string | null) {
    this.#status.textContent = message ?? '';
    this.#status.hidden = message === null;
    this.#status.setAttribute('role', 'status');
    if (message) this.hideReading();
  }
  changed() {
    interactionFor(this.runtime.session).batch(() => {
      this.#notifications.invalidate();
      this.hideReading();
      this.runtime.session.inspect(null);
      this.runtime.refresh();
    });
  }
  dispose() {
    if (this.disposed) return;
    this.#notifications.dispose();
    this.disposed = true;
    this.hideReading();
    for (const cleanup of this.#cleanups) cleanup();
    this.runtime.dispose();
    interactionHosts.delete(this);
    super.dispose();
  }
}
