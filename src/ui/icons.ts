/** Inline SVG icons (Lucide-style, 24px grid, stroke = currentColor). */
const paths = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  settings:
    '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  prev: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  next: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  prevChapter: '<path d="M3 19V5M13 6l-6 6 6 6M7 12h14"/>',
  nextChapter: '<path d="M17 12H3M11 18l6-6-6-6M21 5v14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"/>',
} as const;

export type IconName = keyof typeof paths;

export function icon(name: IconName): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

export function iconButton(name: IconName, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-btn ${extraClass}`.trim();
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(name));
  button.addEventListener('click', onClick);
  return button;
}
