import { hostHandle } from './typed-ipc'

export function registerProjectActionHandlers() {
  hostHandle('project-actions:manage')
}
