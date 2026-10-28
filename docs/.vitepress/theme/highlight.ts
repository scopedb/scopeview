import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import css from 'shiki/langs/css.mjs';
import json from 'shiki/langs/json.mjs';
import light from 'shiki/themes/github-light.mjs';
import dark from 'shiki/themes/github-dark.mjs';
import type { SourceLanguage } from './demo-source.js';

const highlighter = createHighlighterCore({
  langs: [html, javascript, css, json],
  themes: [light, dark],
  engine: createOnigurumaEngine(import('shiki/wasm'))
});

export async function highlight(
  code: string,
  language: SourceLanguage,
  theme: 'light' | 'dark',
  label: string
) {
  return (await highlighter).codeToHtml(code, {
    lang: language,
    theme: `github-${theme}`,
    transformers: [
      {
        pre(node) {
          node.properties.tabindex = 0;
          node.properties['aria-label'] = label;
        }
      }
    ]
  });
}
