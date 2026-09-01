import type { SyntaxLanguageResource } from '@shared/types/syntax-resources'
import { isSyntaxWorkerResponse, type SyntaxWorkerRequest } from './protocol'

const VALIDATION_TIMEOUT_MS = 10_000

function validateLanguage(worker: Worker, language: SyntaxLanguageResource, requestId: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('message', handleMessage)
      reject(new Error(`Grammar validation timed out for ${language.label}.`))
    }, VALIDATION_TIMEOUT_MS)
    function handleMessage(event: MessageEvent<unknown>) {
      if (!isSyntaxWorkerResponse(event.data) || event.data.requestId !== requestId) return
      window.clearTimeout(timeout)
      worker.removeEventListener('message', handleMessage)
      if (event.data.type === 'language-validated') {
        resolve()
        return
      }
      reject(
        new Error(
          event.data.type === 'failed'
            ? `Grammar validation failed for ${language.label}: ${event.data.message}`
            : `Grammar validation returned an unexpected result for ${language.label}.`,
        ),
      )
    }
    worker.addEventListener('message', handleMessage)
    const request: SyntaxWorkerRequest = {
      type: 'validate-language',
      requestId,
      language,
    }
    worker.postMessage(request)
  })
}

export async function validateImportedSyntaxLanguages(
  languages: readonly SyntaxLanguageResource[],
) {
  if (languages.length === 0) return
  if (typeof Worker === 'undefined') {
    throw new Error('A syntax worker is required to validate imported grammars safely.')
  }
  const worker = new Worker(new URL('./syntax.worker.ts', import.meta.url), { type: 'module' })
  try {
    for (const [index, language] of languages.entries()) {
      await validateLanguage(worker, language, index + 1)
    }
  } finally {
    worker.terminate()
  }
}
