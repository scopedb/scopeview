import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { nav, sidebar } from './navigation.js';

const repository = 'https://github.com/scopedb/scopeview';
const base = process.env.SCOPEVIEW_DOCS_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('SCOPEVIEW_DOCS_BASE must start and end with a slash, for example /scopeview/.');
}

export default defineConfig({
  title: 'ScopeView',
  description: 'Small Canvas charts with exact source readings and no runtime dependencies.',
  lang: 'en-US',
  base,
  srcExclude: ['README.md'],
  sitemap: {
    hostname: 'https://scopeview.scopedb.io'
  },
  outDir: fileURLToPath(new URL('../../.local/docs-site', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../.local/docs-cache', import.meta.url)),
  vite: {
    build: {
      chunkSizeWarningLimit: 1000
    }
  },
  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: `${base}icon.svg`
      }
    ],
    ['meta', { property: 'og:site_name', content: 'ScopeView' }],
    ['meta', { property: 'og:type', content: 'website' }]
  ],
  themeConfig: {
    logo: '/icon.svg',
    siteTitle: 'ScopeView',
    nav,
    socialLinks: [{ icon: 'github', link: repository }],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
    sidebar,
    docFooter: { prev: 'Previous page', next: 'Next page' },
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Apache-2.0 · ScopeView' }
  },
  markdown: {
    config(md) {
      // Keep repository Markdown readable while resolving source files outside the site.
      const renderLink = md.renderer.rules.link_open!;
      md.renderer.rules.link_open = (tokens, index, options, env, self) => {
        const token = tokens[index];
        const href = token.attrGet('href');
        if (href && !/^(?:[a-z]+:|#|\/)/i.test(href)) {
          const normalized = href.replace(/^\.\//, '');
          if (normalized.startsWith('../') || !/\.md(?:#|$)/.test(normalized)) {
            const path = normalized.startsWith('../')
              ? normalized.slice(3)
              : /^(?:examples|src|node|scripts|tests)\//.test(normalized)
                ? normalized
                : `docs/${normalized}`;
            token.attrSet('href', `${repository}/blob/main/${path}`);
          } else if (normalized.startsWith('docs/')) {
            token.attrSet('href', `/${normalized.slice(5)}`);
          }
        }
        return renderLink(tokens, index, options, env, self);
      };
    }
  }
});
