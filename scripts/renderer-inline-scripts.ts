/**
 * The renderer page's inline scripts against the CSP hash that allows them
 * (`STARTUP_APPEARANCE_SCRIPT_HASH`). The unit test hashes the source page; this checks the page
 * electron-vite built, so a build step that rewrites an inline script (a minifier, a Vite plugin)
 * fails `pnpm check` instead of blanking the startup scale in packaged builds.
 */
import { createHash } from 'node:crypto'

const SCRIPT_ELEMENT = /<script(?<attributes>\s[^>]*)?>(?<body>[\s\S]*?)<\/script>/giu
const SOURCE_ATTRIBUTE = /\ssrc\s*=/iu

/** The CSP source of every inline script in `html`, in order. */
export function inlineScriptHashes(html: string) {
  return [...html.matchAll(SCRIPT_ELEMENT)]
    .filter((match) => !SOURCE_ATTRIBUTE.test(match.groups?.attributes ?? ''))
    .map((match) => {
      const digest = createHash('sha256')
        .update(match.groups?.body ?? '')
        .digest('base64')
      return `'sha256-${digest}'`
    })
}

/** Why the page's inline scripts do not match the CSP, or nothing when they do. */
export function inlineScriptHashFailures(input: {
  readonly html: string
  readonly page: string
  readonly allowedHash: string
}) {
  const hashes = inlineScriptHashes(input.html)
  if (hashes.length !== 1) {
    return [`${input.page} has ${String(hashes.length)} inline scripts; the CSP allows exactly one.`]
  }
  if (hashes[0] !== input.allowedHash) {
    return [
      `${input.page}'s inline script hashes to ${String(hashes[0])}, but the CSP allows ` +
        `${input.allowedHash} (STARTUP_APPEARANCE_SCRIPT_HASH): the build rewrote it, or the hash is stale.`,
    ]
  }
  return []
}
