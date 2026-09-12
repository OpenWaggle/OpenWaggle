import type {
  ProjectAction,
  ProjectActionInput,
  ProjectActionUpdate,
  T3ProjectActionsDiscovery,
} from './project-actions'

export interface IpcProjectActionInvokeChannelMap {
  'project-actions:list': {
    args: [projectPath: string]
    return: readonly ProjectAction[]
  }
  'project-actions:add': {
    args: [projectPath: string, input: ProjectActionInput]
    return: readonly ProjectAction[]
  }
  'project-actions:update': {
    args: [projectPath: string, actionId: string, update: ProjectActionUpdate]
    return: readonly ProjectAction[]
  }
  'project-actions:delete': {
    args: [projectPath: string, actionId: string]
    return: readonly ProjectAction[]
  }
  'project-actions:discover-t3': {
    args: [projectPath: string]
    return: T3ProjectActionsDiscovery
  }
  'project-actions:import-t3': {
    args: [projectPath: string, sourceIndex: number]
    return: readonly ProjectAction[]
  }
}
