import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { completeJournaledSessionFileDeletion } from '../file-deletion'

describe('journaled Pi Session file deletion', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('resumes from an already staged file after a process boundary', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-delete-'))
    const original = path.join(temporaryRoot, 'session.jsonl')
    const staged = `${original}.journal.delete`
    await fs.writeFile(original, 'sensitive transcript')
    await fs.rename(original, staged)

    await completeJournaledSessionFileDeletion(original, staged)

    await expect(fs.stat(staged)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
