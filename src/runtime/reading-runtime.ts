import { interactionFor } from '../core/interaction.js';
import { ChartSession } from '../core/session.js';
import type { ChartInteraction, ChartScene } from '../core/scene.js';
import { RuntimeLifecycle } from './lifecycle.js';
import type { ReadingOptions } from './types.js';
import { inspectKey } from './inspection-input.js';

/** Report lifecycle and transient reading. Range, links and viewport controllers stay optional. */
export class ReadingRuntime<Source> extends RuntimeLifecycle<Source> {
  protected declare readonly options: ReadingOptions<Source>;
  readonly session = new ChartSession<Source>('compare');
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
    interactionFor(this.session).batch(() => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        this.model?.interactive === false
      )
        return;
      inspectKey(event, this.session, this.selectable, this.signal, this.options, () => {
        this.focus(this.session.active);
        this.announce();
        this.options.onInspect?.(this.session.active, null, this.session.pinned);
      });
    });
  }
  protected release() {
    this.session.reset();
    this.canvas.removeAttribute('tabindex');
  }
}
