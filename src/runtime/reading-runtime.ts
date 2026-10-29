import { interactionFor, readingPhase } from '../core/interaction.js';
import { readingState } from '../core/reading-state.js';
import { ReadingSession } from '../core/reading-session.js';
import type { ChartInteraction, ChartScene } from '../core/scene.js';
import { RuntimeLifecycle } from './lifecycle.js';
import type { ReadingOptions } from './types.js';

/** Report lifecycle and transient reading. Range, links and viewport controllers stay optional. */
export class ReadingRuntime<Source> extends RuntimeLifecycle<Source> {
  protected declare readonly options: ReadingOptions<Source>;
  readonly session = new ReadingSession<Source>();
  selectable = false;

  constructor(canvas: HTMLElement, decoration: HTMLElement, options: ReadingOptions<Source>) {
    super(
      canvas,
      decoration,
      (target, position, pin, series) => {
        if (options.inputConsumed?.()) return;
        interactionFor(this.session).batch(() => {
          if (!this.session.inspect(target?.key ?? null, pin && this.selectable, false, series))
            return;
          this.focus(this.session.active);
          this.announce();
          options.onInspect?.(this.session.active, position, this.session.pinned, series);
        });
      },
      options
    );
    canvas.setAttribute('role', 'group');
    this.refresh();
  }
  get model() {
    return this.painter.model;
  }
  focus(target: ChartInteraction<Source> | null) {
    this.painter.focus(
      target,
      this.session.pinned,
      this.session.series,
      this.session.selected?.key ?? null
    );
  }
  protected draw(scene: ChartScene<Source>) {
    this.painter.render(scene, {
      inspectionKey: this.session.active?.key ?? null,
      inspectionPinned: this.session.pinned,
      inspectionSeries: this.session.series,
      selectedKey: this.session.selected?.key ?? null,
      range: null
    });
    if (scene.interactive === false) this.canvas.removeAttribute('tabindex');
    else this.canvas.tabIndex = 0;
    this.announce();
  }
  protected keyboard(event: KeyboardEvent) {
    interactionFor(this.session).batch(() => this.#keyboard(event));
  }
  #keyboard(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      this.model?.interactive === false
    )
      return;
    const interaction = interactionFor(this.session);
    let target: ChartInteraction<Source> | null = null;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const direction =
        event.key === 'Home' || event.key === 'End'
          ? event.key
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? 'previous'
            : 'next';
      target = this.session.next(direction);
      this.session.inspect(target?.key ?? null, false, true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      target = this.session.active ?? this.session.next('Home');
      this.session.inspect(target?.key ?? null, this.selectable, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.session.clearInspection();
    } else return;
    if (target) {
      const navigate = target;
      const intent = readingState(this.session).intent;
      interaction.effect(() => {
        if (!this.signal.aborted && intent === readingState(this.session).intent)
          this.options.onNavigate?.(navigate);
      });
    }
    interaction.effect(
      () => {
        if (this.signal.aborted) return;
        this.focus(this.session.active);
        this.announce();
        this.options.onInspect?.(this.session.active, null, this.session.pinned);
      },
      {},
      readingPhase
    );
  }
  protected release() {
    this.session.reset();
    this.canvas.removeAttribute('tabindex');
  }
}
