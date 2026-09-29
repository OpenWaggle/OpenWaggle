import { describe, expect, it } from 'vitest'
import { scratchDirectorySystemPrompt } from '../pi-provider-resources'

describe('Session scratch directory system prompt', () => {
  it('names the absolute scratch path and warns against fixed /tmp names', () => {
    const prompt = scratchDirectorySystemPrompt('/private/var/folders/T/openwaggle-scratch-501/s1')

    expect(prompt).toContain('## Session scratch directory')
    expect(prompt).toContain('"/private/var/folders/T/openwaggle-scratch-501/s1"')
    expect(prompt).toContain('TMPDIR, TMP, and TEMP point to it')
    expect(prompt).toContain('"$TMPDIR/push.log"')
    expect(prompt).toContain('never write fixed file names directly under /tmp')
  })
})
