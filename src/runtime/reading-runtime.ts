import { ChartSession } from '../core/session.js';
import type { ChartInteraction, ChartScene, Position } from '../core/scene.js';
import { handleInspectionKey } from './keyboard.js';
import { RuntimeLifecycle } from './lifecycle.js';
import type { ReadingOptions } from './types.js';

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
        if (!this.session.inspect(target?.key ?? null, pin && this.selectable, false, series))
          return;
        this.#emit(position, series);
      },
      options
    );
    canvas.setAttribute('role', 'group');
    this.refresh();
  }
  get model() {
    return this.painter.model;
  }
  #emit(position: Position | null, series?: string | null) {
    this.focus(this.session.active);
    this.announce();
    this.options.onInspect?.(this.session.active, position, this.session.pinned, series);
  }
  focus(target: ChartInteraction<Source> | null) {
    this.painter.focus(
      target,
      this.session.pinned,
      this.session.series,
      this.session.selected?.key ?? null
    );
  }
  protected draw(scene: ChartScene<Source>, keepColors: boolean, font?: string) {
    this.painter.render(
      scene,
      {
        inspectionKey: this.session.active?.key ?? null,
        inspectionPinned: this.session.pinned,
        inspectionSeries: this.session.series,
        selectedKey: this.session.selected?.key ?? null,
        range: null
      },
      { font, keepColors }
    );
    if (scene.interactive === false) this.canvas.removeAttribute('tabindex');
    else this.canvas.tabIndex = 0;
    this.announce();
  }
  protected keyboard(event: KeyboardEvent) {
    handleInspectionKey(
      event,
      this.session,
      this.model?.interactive,
      this.selectable,
      () => this.#emit(null),
      this.options.onNavigate,
      this.signal
    );
  }
  protected release() {
    this.session.reset();
    this.canvas.removeAttribute('tabindex');
  }
}
