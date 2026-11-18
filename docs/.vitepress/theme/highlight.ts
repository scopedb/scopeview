import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import css from 'shiki/langs/css.mjs';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import shellscript from 'shiki/langs/shellscript.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import dark from 'shiki/themes/github-dark.mjs';
import light from 'shiki/themes/github-light.mjs';
import type { SourceLanguage } from './demo-source.js';

export type HighlightLanguage = SourceLanguage | 'typescript' | 'shellscript';

const highlighter = createHighlighterCore({
  langs: [html, javascript, typescript, shellscript, css, json],
  themes: [light, dark],
  engine: createOnigurumaEngine(import('shiki/wasm'))
});

export async function highlight(
  code: string,
  language: HighlightLanguage,
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
