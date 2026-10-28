import type {
  ChartLinkGroup,
  ChartLinkMember,
  ChartLinkUpdate,
  LinkedHighlight,
  LinkedSelection,
  LinkedTimeWindow
} from '../core/link-group.js';

export interface ChartLinkTarget extends EventTarget {
  linkedHighlight: LinkedHighlight | null;
}
export interface ChartLinkBindingOptions<Detail> {
  id: string;
  cursor?(detail: Detail): string | null;
  selection?(detail: Detail): LinkedSelection | null;
  /** Map each peer update into this chart's family and current domain. */
  project(update: ChartLinkUpdate): LinkedHighlight | null;
  /** The host may apply a linked window to its viewport or request new source data. */
  receive?(update: ChartLinkUpdate): void;
  viewportWindow?(detail: unknown): LinkedTimeWindow | null;
}

/** Thin browser binding. It owns listeners, never queries, source mapping or local pins. */
export function bindChartLinks<Detail>(
  target: ChartLinkTarget,
  group: ChartLinkGroup,
  options: ChartLinkBindingOptions<Detail>
): ChartLinkMember {
  let applying = false;
  const apply = (update: ChartLinkUpdate, receive = true) => {
    applying = true;
    try {
      target.linkedHighlight = options.project(update);
      if (receive) options.receive?.(update);
    } finally {
      applying = false;
    }
  };
  const member = group.connect(options.id, apply);
  const events = new AbortController();
  let connected = true;
  const signal = events.signal;
  target.addEventListener(
    'scope-ready',
    () => {
      // Geometry/domain may change after resize or data replacement. Reproject without
      // reapplying viewport commands, which would schedule another ready transaction.
      apply(
        {
          origin: null,
          changed: 'restore',
          state: group.state
        },
        false
      );
    },
    { signal }
  );
  target.addEventListener(
    'scope-inspect',
    (event) => {
      if (!applying && options.cursor)
        member.cursor(options.cursor((event as CustomEvent<Detail>).detail));
    },
    { signal }
  );
  target.addEventListener(
    'scope-select',
    (event) => {
      if (!applying && options.selection)
        member.select(options.selection((event as CustomEvent<Detail>).detail));
    },
    { signal }
  );
  target.addEventListener(
    'scope-viewport-change',
    (event) => {
      if (!applying && options.viewportWindow)
        member.window(options.viewportWindow((event as CustomEvent).detail));
    },
    { signal }
  );
  return {
    ...member,
    disconnect() {
      if (!connected) return;
      connected = false;
      events.abort();
      target.linkedHighlight = null;
      member.disconnect();
    }
  };
}
