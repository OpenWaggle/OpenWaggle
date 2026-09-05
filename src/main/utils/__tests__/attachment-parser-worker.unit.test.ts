import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { describe, expect, it } from 'vitest'
import { runAttachmentParserWorker } from '../attachment-parser-worker'

describe('attachment parser worker', () => {
  it('ships every dynamically resolved parser as a production dependency', () => {
    const packageSource = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    const dependenciesStart = packageSource.indexOf('"dependencies"')
    const developmentDependenciesStart = packageSource.indexOf('"devDependencies"')

    for (const packageName of ['jszip', 'mammoth', 'sharp', 'tesseract.js', 'unpdf']) {
      const dependencyPosition = packageSource.indexOf(`"${packageName}"`, dependenciesStart)
      expect(dependencyPosition).toBeGreaterThan(dependenciesStart)
      expect(dependencyPosition).toBeLessThan(developmentDependenciesStart)
    }
  })

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
      ).resolves.toBe('Worker parser')
    } finally {
      process.chdir(previousWorkingDirectory)
    }
  })

  it('normalizes and bounds expanded parser output before crossing the worker boundary', async () => {
    const JSZip = (await import('jszip')).default
    const archive = new JSZip()
    archive.file(
      'content.xml',
      `<text:p>${'expanded &amp; content '.repeat(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)}</text:p>`,
    )
    const buffer = await archive.generateAsync({ type: 'nodebuffer' })

    const result = await runAttachmentParserWorker(
      { kind: 'odt', buffer },
      new AbortController().signal,
    )

    expect(result.length).toBeLessThanOrEqual(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)
    expect(result).toContain('expanded & content')
    expect(result.endsWith('...[truncated]')).toBe(true)
  })

  it('extracts RTF inside the parser worker', async () => {
    await expect(
      runAttachmentParserWorker(
        { kind: 'rtf', buffer: Buffer.from('{\\rtf1\\ansi Hello\\par world}') },
        new AbortController().signal,
      ),
    ).resolves.toBe('Hello\nworld')
  })
})
