/** Owned pixels and context state, independent of chart/session semantics. */
export class CanvasSurface {
  readonly canvas = document.createElement('canvas');
  readonly context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;

  constructor(name: string) {
    this.canvas.dataset.layer = name;
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    this.context = context;
  }
  resize(width: number, height: number, density: number) {
    this.width = width;
    this.height = height;
    const pixelsWide = Math.max(1, Math.round(width * density));
    const pixelsHigh = Math.max(1, Math.round(height * density));
    // Changing dimensions destroys context state and may reallocate its backing store.
    if (this.canvas.width !== pixelsWide) this.canvas.width = pixelsWide;
    if (this.canvas.height !== pixelsHigh) this.canvas.height = pixelsHigh;
  }
  paint(font: string, draw: (context: CanvasRenderingContext2D) => void) {
    const ctx = this.context;
    // reset() clears pixels, clip, transform, dash and all other mutable context state.
    // Dimension assignment gives older Canvas implementations the same clean frame.
    if (typeof ctx.reset === 'function') ctx.reset();
    else this.canvas.width = this.canvas.width;
    ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
    ctx.font = font;
    ctx.lineJoin = 'round';
    ctx.save();
    try {
      draw(ctx);
    } finally {
      ctx.restore();
    }
  }
  get backingBytes() {
    return this.canvas.width * this.canvas.height * 4;
  }
  dispose() {
    this.canvas.remove();
    this.canvas.width = this.canvas.height = 0;
  }
}
