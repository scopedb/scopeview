import { node } from '../ui/dom.js';

export const DATA_TABLE_PAGE_SIZE = 50;

export interface DataTableElements {
  raw: HTMLElement;
  toggle: HTMLElement;
  pagination: HTMLElement;
  pageLabel: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
}

export interface DataTableRowCell {
  text: string;
  ariaLabel?: string;
}

export interface DataTableModel {
  caption: string;
  headers: readonly string[];
  total: number;
  rows(start: number, end: number): Iterable<readonly DataTableRowCell[]>;
}

export function dataTablePage(total: number, page: number, pageSize = DATA_TABLE_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return {
    pages,
    page: Math.max(0, Math.min(page, pages - 1))
  };
}

export function setDataTableOpen(
  elements: DataTableElements,
  open: boolean,
  enabled: boolean,
  page: number,
  buildModel: () => DataTableModel | null
): number {
  elements.raw.hidden = !open;
  elements.toggle.setAttribute('aria-expanded', String(open));
  elements.toggle.textContent = open ? 'Hide data' : 'View data';
  return renderDataTable(elements, enabled, page, buildModel);
}

/** Shared paginated raw-source table renderer for metric and hierarchy shells. */
export function renderDataTable(
  elements: DataTableElements,
  enabled: boolean,
  page: number,
  buildModel: () => DataTableModel | null
): number {
  const { raw, toggle, pagination, pageLabel, previous, next } = elements;
  if (!enabled) {
    raw.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'View data';
  }
  raw.replaceChildren();
  const model = raw.hidden ? null : buildModel();
  if (raw.hidden || !model) {
    pagination.hidden = true;
    return page;
  }
  const { pages, page: nextPage } = dataTablePage(model.total, page);
  pagination.hidden = model.total <= DATA_TABLE_PAGE_SIZE;
  const table = node('table');
  const head = node('thead');
  const headerRow = node('tr');
  table.append(node('caption', '', model.caption));
  for (const header of model.headers) {
    const th = node('th', '', header);
    th.scope = 'col';
    headerRow.append(th);
  }
  head.append(headerRow);
  table.append(head);
  const body = node('tbody');
  const start = nextPage * DATA_TABLE_PAGE_SIZE;
  for (const cells of model.rows(start, start + DATA_TABLE_PAGE_SIZE)) {
    const tr = node('tr');
    for (const cell of cells) {
      const td = node('td', '', cell.text);
      if (cell.ariaLabel) td.setAttribute('aria-label', cell.ariaLabel);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  raw.append(table);
  pageLabel.textContent = `Page ${nextPage + 1} of ${pages}`;
  previous.disabled = nextPage === 0;
  next.disabled = nextPage >= pages - 1;
  return nextPage;
}
