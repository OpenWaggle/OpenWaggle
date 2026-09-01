import type {
  OpenWaggleExtensionSyntaxHighlightInput,
  OpenWaggleExtensionSyntaxHighlightResult,
} from '@shared/extension-sdk'
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
      controllers.get(requestId)?.abort()
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
