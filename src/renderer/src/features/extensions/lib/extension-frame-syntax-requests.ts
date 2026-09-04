import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type {
  OpenWaggleExtensionSyntaxHighlightInput,
  OpenWaggleExtensionSyntaxHighlightResult,
} from '@shared/extension-sdk'
import { createPlainExtensionSyntaxResult } from '@shared/extension-sdk'
import { highlightExtensionSyntax } from './extension-syntax-sdk'

export function createExtensionFrameSyntaxRequests() {
  const controllers = new Map<string, AbortController>()

  return {
    highlight(
      requestId: string,
      input: OpenWaggleExtensionSyntaxHighlightInput,
      isActive: () => boolean,
      postResult: (result: OpenWaggleExtensionSyntaxHighlightResult) => void,
    ) {
      const existing = controllers.get(requestId)
      existing?.abort()
      if (
        !existing &&
        controllers.size >= WORKSPACE_EDITOR_PERFORMANCE.EXTENSION_FRAME_SYNTAX_MAX_REQUESTS
      ) {
        postResult(
          createPlainExtensionSyntaxResult({
            ...input,
            diagnostic: 'Too many syntax requests are already pending for this extension.',
          }),
        )
        return
      }
      const controller = new AbortController()
      controllers.set(requestId, controller)
      void highlightExtensionSyntax(input, { signal: controller.signal }).then((result) => {
        if (!isActive() || controllers.get(requestId) !== controller) return
        controllers.delete(requestId)
        postResult(result)
      })
    },
    cancel(requestId: string) {
      const controller = controllers.get(requestId)
      if (!controller) return
      controllers.delete(requestId)
      controller.abort()
    },
    dispose() {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    },
  }
}
