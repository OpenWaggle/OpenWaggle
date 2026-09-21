import type { ActionDefinition } from '../types/action-definitions'

/** Agent approval covers execution settings; labels and display preferences do not widen it. */
export function actionExecutionKey(action: ActionDefinition): string {
  return JSON.stringify({
    invocation: action.invocation,
    kind: action.kind,
    allowConcurrent: action.allowConcurrent,
  })
}
