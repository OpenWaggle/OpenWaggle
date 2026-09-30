import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareSessionEvidenceDirectory } from '../../../utils/session-evidence-directory'
import {
  prepareSessionScratchDirectory,
  sessionScratchRoot,
} from '../../../utils/session-scratch-directory'
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
    const prompt = scratchDirectorySystemPrompt(
      '/tmp/ow-scratch-501/37a8eec1/0123456789ab',
      '/tmp/ow-scratch-501/evidence/0123456789ab',
    )

    expect(prompt).toContain('"/tmp/ow-scratch-501/evidence/0123456789ab"')
    expect(prompt).toContain('$OPENWAGGLE_EVIDENCE_DIR')
    expect(prompt).toContain('kept after this session is archived')
  })

  it('does not name an evidence directory that was not prepared', () => {
    const prompt = scratchDirectorySystemPrompt(
      '/tmp/ow-scratch-501/37a8eec1/0123456789ab',
      undefined,
    )

    expect(prompt).not.toContain('OPENWAGGLE_EVIDENCE_DIR')
  })

  it('names the evidence directory a Run prepared when given only the scratch directory', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-prompt-evidence-'))
    try {
      const scratch = await prepareSessionScratchDirectory('session-a', sessionScratchRoot(base))
      const evidence = await prepareSessionEvidenceDirectory(scratch)

      expect(scratchDirectorySystemPrompt(scratch)).toContain(JSON.stringify(evidence))
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})
