import type { DefaultTheme } from 'vitepress';

// Keep usage guides, API lookup and component examples in reading order.
export const sidebar = [
  {
    text: 'Start here',
    items: [
      { text: 'Overview', link: '/overview' },
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Data format', link: '/data' },
      { text: 'Chart families', link: '/charts' }
    ]
  },
  {
    text: 'Integration',
    items: [
      { text: 'Frameworks', link: '/frameworks' },
      { text: 'Styling', link: '/styling' },
      { text: 'HTML export', link: '/embedding' }
    ]
  },
  {
    text: 'API reference',
    items: [
      { text: 'Headless API', link: '/headless' },
      { text: 'Document options', link: '/options' },
      { text: 'CLI reference', link: '/cli' },
      { text: 'Web Components', link: '/api' },
      { text: 'View state & coordination', link: '/view-state' },
      { text: 'Design tokens', link: '/design-tokens' },
      { text: 'Custom rendering', link: '/canvas-infra' }
    ]
  },
  {
    text: 'Examples',
    items: [
      { text: 'Gallery', link: '/examples' },
      { text: 'CLI example', link: '/cli-example' },
      { text: 'Metric charts', link: '/chart-component' },
      { text: 'Trace timeline', link: '/trace-component' },
      { text: 'Flame graph', link: '/flame-component' }
    ]
  }
] satisfies DefaultTheme.SidebarItem[];

export const nav = [
  {
    text: 'Guide',
    link: '/overview',
    activeMatch: '^/(overview|getting-started|data|charts|frameworks|styling|embedding)(\\.|$)'
  },
  {
    text: 'Examples',
    link: '/examples',
    activeMatch: '^/(examples|cli-example|chart-component|trace-component|flame-component)(\\.|$)'
  },
  {
    text: 'API reference',
    link: '/headless',
    activeMatch: '^/(headless|options|cli|api|view-state|design-tokens|canvas-infra)(\\.|$)'
  }
] satisfies DefaultTheme.NavItem[];
