import { ATTACHMENT } from '@shared/constants/resource-limits'

interface ExtractionJob {
  readonly controller: AbortController
  readonly extractText: (signal: AbortSignal) => Promise<string>
  readonly reject: (error: Error) => void
  readonly resolve: (text: string) => void
  readonly timer: NodeJS.Timeout
  started: boolean
  settled: boolean
}

const extractionQueue: ExtractionJob[] = []
let activeExtractionCount = 0

export function attachmentExtractionTimeoutError() {
  return new Error(
    `Attachment text extraction exceeded ${String(ATTACHMENT.EXTRACTION_TIMEOUT_MS)} ms.`,
  )
}

function pumpExtractionQueue() {
  while (
    activeExtractionCount < ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS &&
    extractionQueue.length > 0
  ) {
    const job = extractionQueue.shift()
    if (!job || job.settled) continue
    job.started = true
    activeExtractionCount += 1
    void job
      .extractText(job.controller.signal)
      .then(
        (text) => {
          if (job.settled) return
          job.settled = true
          clearTimeout(job.timer)
          job.resolve(text)
        },
        (error: unknown) => {
          if (job.settled) return
          job.settled = true
          clearTimeout(job.timer)
          job.reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
      .finally(() => {
        activeExtractionCount -= 1
        pumpExtractionQueue()
      })
  }
}

export function scheduleAttachmentExtraction(
  extractText: (signal: AbortSignal) => Promise<string>,
) {
  if (extractionQueue.length >= ATTACHMENT.MAX_QUEUED_EXTRACTIONS) {
    return Promise.reject(new Error('Attachment text extraction queue is full.'))
  }
  return new Promise<string>((resolve, reject) => {
    const controller = new AbortController()
    const job: ExtractionJob = {
      controller,
      extractText,
      reject,
      resolve,
      timer: setTimeout(() => {
        if (job.settled) return
        job.settled = true
        controller.abort()
        reject(attachmentExtractionTimeoutError())
        if (!job.started) {
          const queueIndex = extractionQueue.indexOf(job)
          if (queueIndex >= 0) extractionQueue.splice(queueIndex, 1)
          pumpExtractionQueue()
        }
      }, ATTACHMENT.EXTRACTION_TIMEOUT_MS),
      started: false,
      settled: false,
    }
    job.timer.unref()
    extractionQueue.push(job)
    pumpExtractionQueue()
  })
}
