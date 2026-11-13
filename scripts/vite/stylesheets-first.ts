import type { Plugin } from 'vite'

/**
 * Puts the renderer's stylesheets ahead of its module scripts in the built `index.html`. Vite
 * writes them after the entry script and every `modulepreload` (about 130 of them), so the page's
 * one render-blocking resource is the last the head names. Ahead of them, the stylesheet is
 * requested first and the startup frame (`index.html`) can paint styled once it is in.
 */
const STYLESHEET_LINK = /<link rel="stylesheet"[^>]*>\s*/gu
const FIRST_MODULE_SCRIPT = /<script type="module"/u

export function stylesheetsFirst(html: string) {
  const stylesheets = html.match(STYLESHEET_LINK)
  if (!stylesheets || !FIRST_MODULE_SCRIPT.test(html)) return html
  const withoutStylesheets = html.replaceAll(STYLESHEET_LINK, '')
  const insertAt = FIRST_MODULE_SCRIPT.exec(withoutStylesheets)?.index
  if (insertAt === undefined) return html
  const block = stylesheets.map((link) => link.trim()).join('\n    ')
  return `${withoutStylesheets.slice(0, insertAt)}${block}\n    ${withoutStylesheets.slice(insertAt)}`
}

export function stylesheetsFirstPlugin() {
  const plugin: Plugin = {
    name: 'openwaggle:stylesheets-first',
    enforce: 'post',
    transformIndexHtml: { order: 'post', handler: stylesheetsFirst },
  }
  return plugin
}
