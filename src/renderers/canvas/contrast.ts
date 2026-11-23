/** Resolved sRGB paint, composited onto the host surface for readable Canvas ink. */
function channels(color: string): number[] | null {
  const match = /^(rgba?\(|color\(\s*srgb\s+)([^)]+)\)$/.exec(color.toLowerCase());
  if (!match) return null;
  const srgb = match[1][0] === 'c';
  const [head, alpha, extra] = match[2].split('/');
  const comma = !srgb && head.includes(',');
  if (comma && alpha !== undefined) return null;
  const parts = (comma ? head.split(',') : head.trim().split(/\s+/)).map((t) => t.trim());
  if (
    extra !== undefined ||
    parts.length < 3 ||
    parts.length > (alpha === undefined && comma ? 4 : 3)
  )
    return null;
  if (alpha !== undefined) parts.push(alpha.trim());
  const values = parts.map((t, i) => {
    if (!t || (i === 3 && /\s/.test(t))) return NaN;
    if (t === 'none' && !comma) return 0;
    const pct = t.endsWith('%');
    const n = (pct ? Number(t.slice(0, -1)) / 100 : Number(t)) * (i < 3 && (pct || srgb) ? 255 : 1);
    return i < 3 ? Math.max(0, Math.min(255, n)) : Math.max(0, Math.min(1, n));
  });
  return values.every(Number.isFinite) ? values : null;
}
const srgb = (c: number[]) => c.slice(0, 3).map((v) => linear(v / 255));
const luminance = (color: number[]) => {
  const [r, g, b] = srgb(color);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
};
const composite = (paint: number[], base: number[]) => {
  const alpha = paint[3] ?? 1;
  return paint.slice(0, 3).map((value, i) => value * alpha + base[i] * (1 - alpha));
};
export function contrastingInk(
  background: string,
  surface: string,
  fallback: string,
  preferred: readonly string[] = []
): string {
  const paint = channels(background),
    base = channels(surface);
  if (!paint || !base) return fallback;
  const fill = composite(paint, base),
    backgroundLuminance = luminance(fill);
  let ink: string | undefined,
    best = 4.5;
  for (const candidate of preferred) {
    const color = channels(candidate);
    if (!color) continue;
    const foreground = luminance(composite(color, fill));
    const contrast =
      (Math.max(foreground, backgroundLuminance) + 0.05) /
      (Math.min(foreground, backgroundLuminance) + 0.05);
    if (contrast >= best) {
      best = contrast;
      ink = candidate;
    }
  }
  return (
    ink ??
    ((backgroundLuminance + 0.05) / 0.05 >= 1.05 / (backgroundLuminance + 0.05)
      ? '#000000'
      : '#ffffff')
  );
}

const linear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const encoded = (channel: number) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

/** Oklab matrices published by Björn Ottosson (public domain).
 * https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab */
function lab(paint: number[]) {
  const [r, g, b] = srgb(paint);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}
function rgb(lightness: number, a: number, b: number) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

/** Emphasize the source hue by moving one perceptual lightness step. Chroma is
 * retained until sRGB gamut requires reduction; opacity and custom paints survive. */
export function inspectionFill(
  background: string,
  surface: string,
  lightnessStep?: number
): string {
  const paint = channels(background),
    base = channels(surface);
  if (!paint || !base) return background;
  const [l, a, b] = lab(paint),
    dark = lab(base)[0] < 0.6,
    step = lightnessStep ?? (dark ? tokenBarHoverLightnessDark : tokenBarHoverLightnessLight);
  const lightness = dark
    ? l > 0.86
      ? l - step
      : Math.max(0.35, l + step)
    : l < 0.3
      ? Math.max(0.35, l + step)
      : l - step;
  let color = rgb(lightness, a, b);
  const inGamut = (color: number[]) => color.every((channel) => channel >= 0 && channel <= 1);
  if (!inGamut(color)) {
    let low = 0,
      high = 1;
    // Reduce chroma at fixed hue/lightness instead of independently clipping RGB.
    for (let i = 0; i < 12; i++) {
      const scale = (low + high) / 2;
      if (inGamut(rgb(lightness, a * scale, b * scale))) low = scale;
      else high = scale;
    }
    color = rgb(lightness, a * low, b * low);
  }
  const output = color.map((channel) =>
    Math.round(Math.max(0, Math.min(1, encoded(channel))) * 255)
  );
  return `rgba(${output.join(', ')}, ${paint[3] ?? 1})`;
}
import {
  barHoverLightnessDark as tokenBarHoverLightnessDark,
  barHoverLightnessLight as tokenBarHoverLightnessLight
} from '../../theme/visual-tokens.js';
