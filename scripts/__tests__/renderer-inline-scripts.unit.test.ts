import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STARTUP_APPEARANCE_SCRIPT_HASH } from '../../src/main/security/electron-security'
import { inlineScriptHashes, inlineScriptHashFailures } from '../renderer-inline-scripts'

const SOURCE_PAGE = readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8')

/** What electron-vite writes: the entry becomes a bundled module script with a hashed name. */
function builtPage(inlineScript: string) {
  return [
    '<!doctype html><html><head>',
    `<script>${inlineScript}</script>`,
    '<script type="module" crossorigin src="./assets/index-abc123.js"></script>',
    '</head><body></body></html>',
  ].join('')
}

function sourceInlineScript() {
  return /<script>([\s\S]*?)<\/script>/u.exec(SOURCE_PAGE)?.[1] ?? ''
}

describe('the built renderer page against its CSP hash', () => {
  it('accepts a build that keeps the inline script as written', () => {
    expect(
      inlineScriptHashFailures({
        html: builtPage(sourceInlineScript()),
        page: 'out/renderer/index.html',
        allowedHash: STARTUP_APPEARANCE_SCRIPT_HASH,
      }),
    ).toEqual([])
  })

  it('fails a build that rewrote the inline script, which the CSP would then block', () => {
    const rewritten = sourceInlineScript().replace('try{', 'try {')

    const failures = inlineScriptHashFailures({
      html: builtPage(rewritten),
      page: 'out/renderer/index.html',
      allowedHash: STARTUP_APPEARANCE_SCRIPT_HASH,
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('STARTUP_APPEARANCE_SCRIPT_HASH')
  })

  it('fails a build that adds an inline script, and ignores bundled ones', () => {
    const html = builtPage(sourceInlineScript()).replace('</head>', '<script>void 0</script></head>')

    expect(inlineScriptHashes(builtPage(sourceInlineScript()))).toHaveLength(1)
    expect(
      inlineScriptHashFailures({ html, page: 'page', allowedHash: STARTUP_APPEARANCE_SCRIPT_HASH }),
    ).toEqual(['page has 2 inline scripts; the CSP allows exactly one.'])
  })
})
