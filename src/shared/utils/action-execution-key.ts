import type { ActionDefinition } from '../types/action-definitions'

/** Agent approval covers execution and preview side effects, excluding cosmetic labels and icons. */
export function actionExecutionKey(action: ActionDefinition): string {
  return JSON.stringify({
    invocation: action.invocation,
    kind: action.kind,
    allowConcurrent: action.allowConcurrent,
    previewUrl: action.previewUrl,
    autoOpenPreview: action.autoOpenPreview,
  })
}
