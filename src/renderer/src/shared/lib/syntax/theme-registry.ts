import type { SyntaxThemeResource } from '@shared/types/syntax-resources'

const resourcesById = new Map<string, SyntaxThemeResource>()
const resourcesByRuntimeName = new Map<string, SyntaxThemeResource>()

export function registerImportedSyntaxThemeResources(resources: readonly SyntaxThemeResource[]) {
  resourcesById.clear()
  resourcesByRuntimeName.clear()
  for (const resource of resources) {
    resourcesById.set(resource.id, resource)
    resourcesByRuntimeName.set(resource.theme.name, resource)
  }
}

export function importedSyntaxThemeResource(theme: string) {
  return resourcesById.get(theme) ?? resourcesByRuntimeName.get(theme)
}
