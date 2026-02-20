import { describe, expect, it } from 'vitest'
import { inferAgentsCandidatePaths } from './agents-path-inference'

describe('inferAgentsCandidatePaths', () => {
  it('prioritizes attachment paths before text-derived paths', () => {
    const result = inferAgentsCandidatePaths({
      text: 'Please edit packages/a/src/index.ts and path:packages/b/src/main.ts',
      attachmentPaths: ['/repo/packages/c/README.md'],
    })

    expect(result[0]).toBe('/repo/packages/c/README.md')
    expect(result).toContain('packages/b/src/main.ts')
    expect(result).toContain('packages/a/src/index.ts')
  })

  it('extracts path-like lines from code fences', () => {
    const result = inferAgentsCandidatePaths({
      text: '```\npackages/a/src/index.ts\npackages/a/AGENTS.md\n```',
    })

    expect(result).toContain('packages/a/src/index.ts')
    expect(result).toContain('packages/a/AGENTS.md')
  })

  it('ignores URLs and deduplicates repeated candidates', () => {
    const result = inferAgentsCandidatePaths({
      text: 'See https://agents.md/ and path:packages/a/src/index.ts packages/a/src/index.ts',
    })

    expect(result).toEqual(['packages/a/src/index.ts'])
  })

  it('caps returned candidates', () => {
    const result = inferAgentsCandidatePaths({
      text: [
        'path:packages/a/src/index.ts',
        'path:packages/b/src/index.ts',
        'path:packages/c/src/index.ts',
      ].join(' '),
      maxCandidates: 2,
    })

    expect(result).toHaveLength(2)
    expect(result).toEqual(['packages/a/src/index.ts', 'packages/b/src/index.ts'])
  })
})
