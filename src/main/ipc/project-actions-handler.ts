import { hostHandle } from './typed-ipc'

export function registerProjectActionHandlers(): void {
  hostHandle('project-actions:manage')
}
