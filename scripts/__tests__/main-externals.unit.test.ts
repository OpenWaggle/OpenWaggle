import { describe, expect, it } from 'vitest'
import { prunedRuntimeIssues } from '../electron-builder-runtime-trim'
import { BUNDLED_DEPS } from '../vite/main-externals'

/**
 * R6 P3-12: the main bundle's bundled-dependency list names only packages the main process uses.
 * A renderer-only package (which the packaged-app check refuses to ship) listed there is stale.
 */
describe('main bundle dependencies', () => {
  it('bundles no renderer-only package', () => {
    const stale = BUNDLED_DEPS.filter((dependency) =>
      prunedRuntimeIssues([`/node_modules/${dependency}/package.json`]).some((issue) => issue.startsWith('ships ')),
    )
    expect(stale).toEqual([])
  })
})
