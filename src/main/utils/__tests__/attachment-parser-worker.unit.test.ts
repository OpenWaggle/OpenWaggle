import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { runAttachmentParserWorker } from '../attachment-parser-worker'

describe('attachment parser worker', () => {
  it('terminates through the abort boundary before parser work can outlive its slot', async () => {
    const controller = new AbortController()
    const parsing = runAttachmentParserWorker(
      { kind: 'pdf', buffer: Buffer.from('not-a-pdf') },
      controller.signal,
    )

    controller.abort()

    await expect(parsing).rejects.toThrow('exceeded')
  })

  it('resolves parser dependencies independently of the process working directory', async () => {
    const JSZip = (await import('jszip')).default
    const archive = new JSZip()
    archive.file('content.xml', '<text:p>Worker parser</text:p>')
    const buffer = await archive.generateAsync({ type: 'nodebuffer' })
    const previousWorkingDirectory = process.cwd()

    try {
      process.chdir(os.tmpdir())
      await expect(
        runAttachmentParserWorker({ kind: 'odt', buffer }, new AbortController().signal),
      ).resolves.toBe('<text:p>Worker parser</text:p>')
    } finally {
      process.chdir(previousWorkingDirectory)
    }
  })
})
