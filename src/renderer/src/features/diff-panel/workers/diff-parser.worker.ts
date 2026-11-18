/// <reference lib="webworker" />

import type {
  DiffParserWorkerRequest,
  DiffParserWorkerResponse,
} from '@/features/diff-panel/lib/code-view-items'
import { parseCodeViewItems } from '@/features/diff-panel/lib/code-view-items'

self.onmessage = (event: MessageEvent<DiffParserWorkerRequest>) => {
  let response: DiffParserWorkerResponse
  try {
    response = { ok: true, items: parseCodeViewItems(event.data.files) }
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
