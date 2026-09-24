import type {
  ActionCatalog,
  ActionDefinition,
  DiscoveredProjectTask,
} from '@shared/types/action-definitions'

export const TEST_ACTION: ActionDefinition = {
  id: 'test',
  name: 'Test',
  icon: 'test',
  invocation: { type: 'command', command: 'pnpm test', directory: '.' },
  kind: 'task',
  allowConcurrent: false,
  autoOpenPreview: false,
}
export const TEST_TASK: DiscoveredProjectTask = {
  reference: {
    provider: 'package-script',
    source: 'website/package.json',
    task: 'test',
    directory: 'website',
  },
  group: 'Website',
  description: 'vitest run',
  runner: 'pnpm',
}
export function actionCatalog(): ActionCatalog {
  return {
    revision: 'catalog-1',
    actions: [{ source: 'local', definition: TEST_ACTION }],
    profiles: [{ source: 'local', definition: { id: 'default', name: 'Default' } }],
    preparation: [],
  }
}
