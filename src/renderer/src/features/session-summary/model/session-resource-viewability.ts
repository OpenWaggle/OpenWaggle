import type { SessionResource } from '@shared/types/session-resource'

export function isViewableSessionImage(resource: SessionResource) {
  if (resource.kind !== 'image' || resource.locator?.startsWith('http://')) return false
  return resource.available || resource.locator?.startsWith('https://') === true
}
