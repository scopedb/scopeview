/** Shared DOM construction keeps supplied text out of HTML parsing. */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function actionButton(text: string, action: () => void, className = '') {
  const button = node('button', className, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

export function appendSwatch(parent: HTMLElement, color?: string) {
  if (!color) return;
  const swatch = node('span', 'swatch');
  swatch.style.setProperty('--series-color', color);
  parent.append(swatch);
}
