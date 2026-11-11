import { describe, expect, it } from 'vitest'
import { placeContentSecurityPolicy, withoutScriptDirectives } from '../electrobun-document-policy'

const POLICY =
  "default-src 'self'; script-src 'self' 'sha256-a'; script-src-elem 'self'; img-src 'self' data:"

describe('Electrobun document policy', () => {
  it('puts the full policy first in the head, after where CEF writes the preload', () => {
    const placed = placeContentSecurityPolicy(
      '<!doctype html><html><HEAD class="x"><meta charset="UTF-8"><script>1</script></HEAD></html>',
      POLICY,
    )
    expect(placed.html).toBe(
      `<!doctype html><html><HEAD class="x"><meta http-equiv="content-security-policy" content="${POLICY}"><meta charset="UTF-8"><script>1</script></HEAD></html>`,
    )
    expect(placed.header).toBe("img-src 'self' data:")
  })

  it('leaves a document without a head alone and keeps the whole policy in its header', () => {
    expect(placeContentSecurityPolicy('<p>frame</p>', POLICY)).toEqual({
      html: '<p>frame</p>',
      header: POLICY,
    })
  })

  it('escapes the policy as an attribute value and drops only the script directives', () => {
    const placed = placeContentSecurityPolicy('<head>', `img-src "x"&<y>; SCRIPT-SRC 'none'`)
    expect(placed.html).toBe(
      '<head><meta http-equiv="content-security-policy" content="img-src &quot;x&quot;&amp;&lt;y&gt;; SCRIPT-SRC \'none\'">',
    )
    expect(withoutScriptDirectives(`img-src "x"; SCRIPT-SRC 'none';; connect-src ws:`)).toBe(
      'img-src "x"; connect-src ws:',
    )
  })

  it('does not take a <header> element for the head', () => {
    expect(placeContentSecurityPolicy('<header>x</header>', POLICY).header).toBe(POLICY)
  })
})
