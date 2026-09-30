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

  it('names the evidence directory that outlives the Session for screenshots', () => {
    const prompt = scratchDirectorySystemPrompt('/tmp/ow-scratch-501/37a8eec1/0123456789ab')

    expect(prompt).toContain('"/tmp/ow-scratch-501/evidence/0123456789ab"')
    expect(prompt).toContain('$OPENWAGGLE_EVIDENCE_DIR')
    expect(prompt).toContain('kept after this session is archived')
  })
})
