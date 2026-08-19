import { readFile } from 'node:fs/promises'
import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

/** Verbs that reach a remote, and therefore must never run unbounded from an interactive path. */
const NETWORK_VERBS = ['fetch', 'push', 'pull', 'ls-remote', 'clone']
/** Enough to cover a multi-line call, short enough not to run into the next statement. */
const WINDOW_CHARS = 220

/**
 * Every `runGit` call using a network verb must pass `networkGitOptions`.
 *
 * Verified by reading the source rather than by review: three separate rounds found a network call added
 * without a bound - the default-ref lookup, the change-request fetch, and then push, pull and the status
 * fetch - each of which blocked an interactive path for git's own connect timeout, or forever on a
 * credential prompt. A new one should fail here rather than in someone's UI.
 */
describe('git commands that reach the network', () => {
  it('all pass networkGitOptions', async () => {
    const files = await fg('src/main/**/*.ts', {
      cwd: process.cwd(),
      ignore: ['**/__tests__/**'],
      absolute: true,
    })

    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      /*
       * A window after each `runGit(` rather than a balanced-paren match: the call may be wrapped over
       * several lines and may or may not end with a separator, and an over-clever pattern is how the first
       * version of this test silently matched nothing.
       */
      for (const match of source.matchAll(/runGit\(/gu)) {
        const window = source.slice(match.index, match.index + WINDOW_CHARS).split('runGit(')[1] ?? ''
        const call = window.split('\n\n')[0] ?? ''
        const usesNetworkVerb = NETWORK_VERBS.some((verb) => call.includes(`'${verb}'`))
        if (usesNetworkVerb && !call.includes('networkGitOptions')) {
          offenders.push(`${file}: ${call.replace(/\s+/gu, ' ').slice(0, 110)}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
