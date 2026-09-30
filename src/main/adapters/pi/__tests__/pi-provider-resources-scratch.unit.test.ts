import { describe, expect, it } from 'vitest'
import { scratchDirectorySystemPrompt } from '../pi-provider-resources'

describe('Session scratch directory system prompt', () => {
  it('names the absolute scratch path and warns against fixed /tmp names', () => {
    const prompt = scratchDirectorySystemPrompt('/tmp/ow-scratch-501/0123456789abcdef')

    expect(prompt).toContain('## Session scratch directory')
    expect(prompt).toContain('"/tmp/ow-scratch-501/0123456789abcdef"')
    expect(prompt).toContain('TMPDIR, TMP, and TEMP point to it')
    expect(prompt).toContain('"$TMPDIR/push.log"')
    expect(prompt).toContain('never write fixed file names directly under /tmp')
  })
})
