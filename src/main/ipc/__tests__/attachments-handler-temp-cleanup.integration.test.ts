import { TIME_UNIT } from '@shared/constants/time'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  files,
  readdirMock,
  registerDirectory,
  registerFile,
  resetAttachmentHandlerMocks,
} from './attachments-handler.test-harness'

const TEMP_ATTACHMENTS_DIRECTORY = '/tmp/user-data/temp-attachments'
const DAY_MS =
  TIME_UNIT.HOURS_PER_DAY *
  TIME_UNIT.MINUTES_PER_HOUR *
  TIME_UNIT.SECONDS_PER_MINUTE *
  TIME_UNIT.MILLISECONDS_PER_SECOND

// Cleanup reaches a file only when its name is one the app writes, so this test is what keeps a
// new writer (a decoded HEIC, a pasted screenshot) from leaving copies behind forever.
describe('temp attachment cleanup', () => {
  beforeEach(() => {
    resetAttachmentHandlerMocks()
  })

  it('removes the copies the app wrote and leaves every other name alone', async () => {
    const staleTimestamp = Date.now() - 2 * DAY_MS
    const preparedImage = `${TEMP_ATTACHMENTS_DIRECTORY}/attachment-11111111-1111-4111-8111-111111111111.jpg`
    const resourceCopy = `${TEMP_ATTACHMENTS_DIRECTORY}/resource-22222222-2222-4222-8222-222222222222.png`
    const prompt = `${TEMP_ATTACHMENTS_DIRECTORY}/prompt-1700000000000.md`
    const foreign = `${TEMP_ATTACHMENTS_DIRECTORY}/notes.txt`
    for (const filePath of [preparedImage, resourceCopy, prompt, foreign]) {
      registerFile(filePath, 'bytes', 5, staleTimestamp)
    }
    readdirMock.mockResolvedValue([
      'attachment-11111111-1111-4111-8111-111111111111.jpg',
      'resource-22222222-2222-4222-8222-222222222222.png',
      'prompt-1700000000000.md',
      'notes.txt',
    ])
    const { cleanupTempAttachments } = await import('../attachment-temp-files')

    await cleanupTempAttachments()

    expect(files.has(preparedImage)).toBe(false)
    expect(files.has(resourceCopy)).toBe(false)
    expect(files.has(prompt)).toBe(false)
    expect(files.has(foreign)).toBe(true)
  })

  it('removes a stale pasted image together with the directory that names it', async () => {
    const staleTimestamp = Date.now() - 2 * DAY_MS
    const directory = `${TEMP_ATTACHMENTS_DIRECTORY}/resource-44444444-4444-4444-8444-444444444444`
    const pastedImage = `${directory}/pasted-image.png`
    registerDirectory(directory, staleTimestamp)
    registerFile(pastedImage, 'bytes', 5, staleTimestamp)
    readdirMock.mockResolvedValue(['resource-44444444-4444-4444-8444-444444444444'])
    const { cleanupTempAttachments } = await import('../attachment-temp-files')

    await cleanupTempAttachments()

    expect(files.has(directory)).toBe(false)
    expect(files.has(pastedImage)).toBe(false)
  })

  it('keeps a copy written within the retention window', async () => {
    const freshImage = `${TEMP_ATTACHMENTS_DIRECTORY}/attachment-33333333-3333-4333-8333-333333333333.jpg`
    registerFile(freshImage, 'bytes', 5, Date.now())
    readdirMock.mockResolvedValue(['attachment-33333333-3333-4333-8333-333333333333.jpg'])
    const { cleanupTempAttachments } = await import('../attachment-temp-files')

    await cleanupTempAttachments()

    expect(files.has(freshImage)).toBe(true)
  })
})
