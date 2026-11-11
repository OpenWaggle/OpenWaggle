/**
 * Where a document's Content Security Policy goes on the Electrobun shell (ADR 0064).
 *
 * CEF gets the webview preload into a page by writing it as an inline script right after the
 * document's `<head>` (Electrobun's CEF response filter). A policy in the response header refuses
 * that script: it carries no nonce, and its text holds a per-webview key, so no hash of it is known
 * in advance. A policy in a `<meta>` governs only what the parser meets after it, so the full policy
 * goes in a `<meta>` as the head's first child, behind where CEF puts the preload, and the header
 * keeps every directive except the ones that govern scripts. Both policies are enforced, so a page
 * gets the full policy whichever renderer it runs in. The system webviews inject the preload as a
 * user script, which no policy governs, so they need nothing of this but are served the same way.
 *
 * A document without a `<head>` keeps the whole policy in its header: CEF would then put the preload
 * where a `<meta>` could not come after it.
 */
const SCRIPT_DIRECTIVES: ReadonlySet<string> = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
])
const HEAD_TAG = /<head(?:\s[^>]*)?>/iu
const DIRECTIVE_SEPARATOR = ';'

export interface PlacedContentSecurityPolicy {
  readonly html: string
  /** The `Content-Security-Policy` header the document is served with. */
  readonly header: string
}

function attributeValue(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** The policy without its script directives, for the header in front of a `<meta>` policy. */
export function withoutScriptDirectives(policy: string) {
  return policy
    .split(DIRECTIVE_SEPARATOR)
    .map((directive) => directive.trim())
    .filter((directive) => {
      const name = directive.split(/\s/u, 1)[0]?.toLowerCase() ?? ''
      return directive.length > 0 && !SCRIPT_DIRECTIVES.has(name)
    })
    .join(`${DIRECTIVE_SEPARATOR} `)
}

/** `html` with `policy` as the head's first child, and the header it is served with. */
export function placeContentSecurityPolicy(
  html: string,
  policy: string,
): PlacedContentSecurityPolicy {
  const head = HEAD_TAG.exec(html)
  if (!head) return { html, header: policy }
  const end = head.index + head[0].length
  const meta = `<meta http-equiv="content-security-policy" content="${attributeValue(policy)}">`
  return {
    html: `${html.slice(0, end)}${meta}${html.slice(end)}`,
    header: withoutScriptDirectives(policy),
  }
}
