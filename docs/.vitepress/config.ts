import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { nav, sidebar } from './navigation.js';

const repository = 'https://github.com/scopedb/scopeview';
const siteUrl = 'https://scopeview.scopedb.io';
const siteTitle = 'ScopeView';
const siteDescription =
  'Small Canvas charts with exact source readings and no runtime dependencies.';
const ogImageUrl = `${siteUrl}/og-image.png`;
const ogImageAlt =
  'ScopeView — Time-series charts with exact readings. Small Canvas charts for metrics, logs, and sparklines.';
const base = process.env.SCOPEVIEW_DOCS_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('SCOPEVIEW_DOCS_BASE must start and end with a slash, for example /scopeview/.');
}

export default defineConfig({
  title: siteTitle,
  description: siteDescription,
  lang: 'en-US',
  base,
  srcExclude: ['README.md'],
  sitemap: {
    hostname: siteUrl
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
    ['meta', { property: 'og:site_name', content: siteTitle }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { property: 'og:image', content: ogImageUrl }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: ogImageAlt }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: ogImageUrl }],
    ['meta', { name: 'twitter:image:alt', content: ogImageAlt }]
  ],
  transformPageData(pageData) {
    const pageTitle =
      !pageData.title || pageData.title === siteTitle
        ? siteTitle
        : `${pageData.title} | ${siteTitle}`;
    const pageDescription = pageData.description || siteDescription;
    const cleanPath = pageData.relativePath.replace(/(?:^|\/)index\.md$/, '').replace(/\.md$/, '');
    const pageUrl = cleanPath ? `${siteUrl}/${cleanPath}` : `${siteUrl}/`;

    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ['meta', { property: 'og:title', content: pageTitle }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { property: 'og:url', content: pageUrl }],
      ['meta', { name: 'twitter:title', content: pageTitle }],
      ['meta', { name: 'twitter:description', content: pageDescription }]
    );
  },
  themeConfig: {
    logo: {
      light: '/scopedb-symbol-black.svg',
      dark: '/scopedb-symbol-white.svg',
      alt: ''
    },
    siteTitle,
    nav,
    socialLinks: [{ icon: 'github', link: repository }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: 'Search docs...',
            buttonAriaLabel: 'Search docs'
          }
        }
      }
    },
    outline: { level: [2, 3], label: 'On this page' },
    sidebar,
    docFooter: { prev: 'Previous page', next: 'Next page' },
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: {
      message: `Released under the <a href="${repository}/blob/main/LICENSE">Apache-2.0 License</a>.`,
      copyright: `© 2024–${new Date().getFullYear()} <a href="https://www.scopedb.io">ScopeDB</a>. All rights reserved.`
    }
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
