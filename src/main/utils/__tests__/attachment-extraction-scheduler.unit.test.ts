import { ATTACHMENT } from '@shared/constants/resource-limits'
import { describe, expect, it, vi } from 'vitest'
import { scheduleAttachmentExtraction } from '../attachment-extraction-scheduler'

describe('attachment extraction scheduler', () => {
  it('bounds both active and waiting extraction work across callers', async () => {
    const releases: Array<() => void> = []
    const schedulePendingExtraction = () =>
      scheduleAttachmentExtraction(
        () =>
          new Promise((resolve) => {
            releases.push(() => resolve('done'))
          }),
      )
    const accepted = Array.from(
      {
        length: ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS + ATTACHMENT.MAX_QUEUED_EXTRACTIONS,
      },
      schedulePendingExtraction,
    )

    await vi.waitFor(() => {
      expect(releases).toHaveLength(ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS)
    })
    await expect(schedulePendingExtraction()).rejects.toThrow('extraction queue is full')

    let releasedCount = 0
    while (releasedCount < accepted.length) {
      await vi.waitFor(() => {
        expect(releases.length).toBeGreaterThan(0)
      })
      releasedCount += releases.length
      for (const release of releases.splice(0)) release()
    }

    await expect(Promise.all(accepted)).resolves.toHaveLength(
      ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS + ATTACHMENT.MAX_QUEUED_EXTRACTIONS,
    )
  })
})
