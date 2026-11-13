import type { Plugin } from 'vite'

/**
 * Puts the renderer's stylesheets ahead of its module scripts in the built `index.html`. Vite
 * writes them after the entry script and every `modulepreload`, and WebKit fetches a page's head
 * resources about one at a time in document order, so the stylesheet arrived after 133 module
 * chunks and the startup frame (`index.html`) could not paint styled until they had all loaded.
 * Ahead of them, the startup frame paints once the HTML and the stylesheet are in.
 */
const STYLESHEET_LINK = /<link rel="stylesheet"[^>]*>\s*/gu
const FIRST_MODULE_SCRIPT = /<script type="module"/u

export function stylesheetsFirst(html: string) {
  const stylesheets = html.match(STYLESHEET_LINK)
  const firstModule = FIRST_MODULE_SCRIPT.exec(html)
  if (!stylesheets || !firstModule) return html
  const withoutStylesheets = html.replaceAll(STYLESHEET_LINK, '')
  const insertAt = FIRST_MODULE_SCRIPT.exec(withoutStylesheets)?.index ?? firstModule.index
  const block = stylesheets.map((link) => link.trim()).join('\n    ')
  return `${withoutStylesheets.slice(0, insertAt)}${block}\n    ${withoutStylesheets.slice(insertAt)}`
}

export function stylesheetsFirstPlugin(): Plugin {
  return {
    name: 'openwaggle:stylesheets-first',
    enforce: 'post',
    transformIndexHtml: { order: 'post', handler: stylesheetsFirst },
  }
}
