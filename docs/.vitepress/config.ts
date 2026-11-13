import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { nav, sidebar } from './navigation.js';

const repository = 'https://github.com/scopedb/scopeview';
const siteUrl = 'https://scopeview.scopedb.io';
const siteTitle = 'ScopeView';
const siteDescription =
  'Exact telemetry charts for coding agents and apps: metrics, traces, and profiles under 39 KiB with zero runtime dependencies.';
const ogImageUrl = `${siteUrl}/og-image.png`;
const ogImageAlt =
  'ScopeView — Exact telemetry charts for coding agents and apps: metrics, traces, and profiles.';
const base = process.env.SCOPEVIEW_DOCS_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('SCOPEVIEW_DOCS_BASE must start and end with a slash, for example /scopeview/.');
}

const landingFixtures = ['trace', 'line', 'profile'] as const;
type LandingFixture = (typeof landingFixtures)[number];
const examplesDir = fileURLToPath(new URL('../../examples/documents/', import.meta.url));
const embedModuleUrl = new URL('../../node/embed.mjs', import.meta.url).href;

async function renderFixtureHTML(document: unknown): Promise<string> {
  const mod = (await import(/* @vite-ignore */ embedModuleUrl)) as {
    createEmbed: (input: unknown, options?: Record<string, unknown>) => Promise<string>;
  };
  return mod.createEmbed(document, { format: 'html', theme: 'system' });
}

async function readFixturePair(name: LandingFixture): Promise<{ json: string; html: string }> {
  const json = await readFile(join(examplesDir, `${name}.json`), 'utf8');
  const html = await renderFixtureHTML(JSON.parse(json));
  return { json, html };
}

function scopeviewLandingDownloads() {
  return {
    name: 'scopeview-landing-downloads',
    configureServer(server: {
      middlewares: {
        use: (
          handler: (
            req: { url?: string },
            res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
            next: (error?: unknown) => void
          ) => void
        ) => void;
      };
    }) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url?.split('?')[0] ?? '';
        const stripped =
          base !== '/' && rawUrl.startsWith(base) ? `/${rawUrl.slice(base.length)}` : rawUrl;
        const match = /^\/downloads\/(trace|line|profile)\.(json|html)$/.exec(stripped);
        if (!match) {
          next();
          return;
        }
        try {
          const [, name, ext] = match as unknown as [string, LandingFixture, 'json' | 'html'];
          const pair = await readFixturePair(name);
          res.setHeader(
            'Content-Type',
            ext === 'json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'
          );
          res.end(ext === 'json' ? pair.json : pair.html);
        } catch (error) {
          next(error);
        }
      });
    }
  };
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
    plugins: [scopeviewLandingDownloads()],
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
  },
  async buildEnd(siteConfig) {
    const downloadsDir = join(siteConfig.outDir, 'downloads');
    await mkdir(downloadsDir, { recursive: true });
    await Promise.all(
      landingFixtures.map(async (name) => {
        const pair = await readFixturePair(name);
        await Promise.all([
          writeFile(join(downloadsDir, `${name}.json`), pair.json, 'utf8'),
          writeFile(join(downloadsDir, `${name}.html`), pair.html, 'utf8')
        ]);
      })
    );
  }
});
