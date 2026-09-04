import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { attachmentExtractionTimeoutError } from './attachment-extraction-scheduler'

export type AttachmentParserKind = 'docx' | 'odt' | 'pdf'

interface ParserWorkerMessage {
  readonly ok: boolean
  readonly text?: string
  readonly error?: string
}

export interface AttachmentParserWorkerPort {
  once(event: 'message', listener: (message: unknown) => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
  off(event: 'error', listener: (error: Error) => void): this
  off(event: 'exit', listener: (code: number) => void): this
  terminate(): Promise<number>
}

type ParserWorkerFactory = (input: {
  readonly kind: AttachmentParserKind
  readonly buffer: Buffer
}) => AttachmentParserWorkerPort

const PARSER_MAX_OLD_GENERATION_MB = 128
const PARSER_MAX_YOUNG_GENERATION_MB = 32
const PARSER_STACK_MB = 4
const resolveParserDependency = createRequire(__filename).resolve
const PARSER_MODULE_URLS = {
  mammoth: pathToFileURL(resolveParserDependency('mammoth')).href,
  jszip: pathToFileURL(resolveParserDependency('jszip')).href,
  unpdf: pathToFileURL(resolveParserDependency('unpdf')).href,
} as const

const ATTACHMENT_PARSER_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')

async function parse() {
  const buffer = Buffer.from(workerData.buffer)
  if (workerData.kind === 'docx') {
    const mammoth = await import(workerData.moduleUrls.mammoth)
    const result = await mammoth.extractRawText({ buffer })
    return result.value || ''
  }
  if (workerData.kind === 'odt') {
    const JSZip = (await import(workerData.moduleUrls.jszip)).default
    const archive = await JSZip.loadAsync(buffer)
    return (await archive.file('content.xml')?.async('string')) || ''
  }
  const { extractText } = await import(workerData.moduleUrls.unpdf)
  const result = await extractText(new Uint8Array(buffer), { mergePages: true })
  return result.text || ''
}

parse().then(
  (text) => parentPort.postMessage({ ok: true, text }),
  (error) => parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }),
)
`

const createParserWorker: ParserWorkerFactory = (input) =>
  new Worker(ATTACHMENT_PARSER_WORKER_SOURCE, {
    eval: true,
    workerData: { ...input, moduleUrls: PARSER_MODULE_URLS },
    resourceLimits: {
      maxOldGenerationSizeMb: PARSER_MAX_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: PARSER_MAX_YOUNG_GENERATION_MB,
      stackSizeMb: PARSER_STACK_MB,
    },
  })

function parserWorkerMessage(value: unknown): ParserWorkerMessage | undefined {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return undefined
  if (value.ok === true && 'text' in value && typeof value.text === 'string') {
    return { ok: true, text: value.text }
  }
  if (value.ok === false && 'error' in value && typeof value.error === 'string') {
    return { ok: false, error: value.error }
  }
  return undefined
}

export function runAttachmentParserWorker(
  input: { readonly kind: AttachmentParserKind; readonly buffer: Buffer },
  signal: AbortSignal,
  workerFactory: ParserWorkerFactory = createParserWorker,
) {
  return new Promise<string>((resolve, reject) => {
    const worker = workerFactory(input)
    let settled = false
    let aborting = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      complete()
    }
    const onMessage = (value: unknown) => {
      const message = parserWorkerMessage(value)
      if (!message) {
        finish(() => reject(new Error('Attachment parser worker returned an invalid response.')))
        return
      }
      finish(() =>
        message.ok
          ? resolve(message.text ?? '')
          : reject(new Error(message.error ?? 'Attachment parser failed.')),
      )
    }
    const onError = (error: Error) => finish(() => reject(error))
    const onExit = (code: number) => {
      if (aborting) return
      finish(() =>
        reject(
          code === 0
            ? new Error('Attachment parser worker exited without a response.')
            : new Error(`Attachment parser worker exited with code ${String(code)}.`),
        ),
      )
    }
    const onAbort = () => {
      if (aborting) return
      aborting = true
      void worker.terminate().then(
        () => finish(() => reject(attachmentExtractionTimeoutError())),
        (error: unknown) =>
          finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
      )
    }
    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
