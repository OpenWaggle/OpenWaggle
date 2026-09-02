import type {
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'
import { isSyntaxWorkerResponse, type SyntaxWorkerResponse } from './protocol'
import type { SyntaxWorkerSlot } from './syntax-worker-slot'

export function createSyntaxWorkerSlot({
  themes,
  languages,
  onResponse,
  onFailure,
}: {
  readonly themes: readonly SyntaxThemeRegistration[]
  readonly languages: readonly SyntaxLanguageResource[]
  readonly onResponse: (slot: SyntaxWorkerSlot, response: SyntaxWorkerResponse) => void
  readonly onFailure: (slot: SyntaxWorkerSlot, message: string) => void
}) {
  const worker = new Worker(new URL('./syntax.worker.ts', import.meta.url), { type: 'module' })
  const slot: SyntaxWorkerSlot = {
    worker,
    current: null,
    currentSourceSent: false,
    knownSourceKeys: new Set(),
    timeout: null,
  }
  if (themes.length > 0) worker.postMessage({ type: 'register-themes', themes })
  if (languages.length > 0) worker.postMessage({ type: 'register-languages', languages })
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isSyntaxWorkerResponse(event.data)) {
      onFailure(slot, 'Syntax worker returned an invalid response.')
      return
    }
    onResponse(slot, event.data)
  })
  worker.addEventListener('error', (event) => {
    onFailure(slot, event.message || 'Syntax worker failed.')
  })
  return slot
}
