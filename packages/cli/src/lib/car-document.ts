import { carTerminalText } from './car-browser.js';

/** Preserve remote text safely with predictable terminal cell widths. */
export function carDocumentLines(document: string[], width: number): string[] {
  const escaped = document.map(carTerminalText).join('\n').split('').map(character => character.charCodeAt(0) > 126
    ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}` : character).join('');
  return escaped.split('\n').flatMap(line => {
    const lines: string[] = [];
    while (line.length > width) {
      const space = line.lastIndexOf(' ', width), end = space > 0 ? space : width;
      lines.push(line.slice(0, end)); line = line.slice(end + (space > 0 ? 1 : 0));
    }
    return [...lines, line];
  });
}
