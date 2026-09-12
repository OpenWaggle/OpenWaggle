import path from 'node:path'
import type {
  DesktopFenceRecord,
  DesktopMutationScope,
  DesktopServiceCommand,
} from '@shared/types/desktop-service'

export function desktopPathContains(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export function desktopScopesOverlap(a: DesktopMutationScope, b: DesktopMutationScope) {
  if (a.kind === 'owner' && b.kind === 'owner') return a.ownerKey === b.ownerKey
  if (a.kind === 'path' && b.kind === 'path')
    return (
      desktopPathContains(a.directoryPath, b.directoryPath) ||
      desktopPathContains(b.directoryPath, a.directoryPath)
    )
  // Owner/path intersections are additionally serialized by the actual GUI native fences.
  return false
}

export function desktopCommandTouchesFence(
  command: DesktopServiceCommand,
  fence: DesktopFenceRecord,
) {
  if (command.service !== 'browser' || command.operation === 'deleteOwner') return false
  return fence.scope.kind === 'owner'
    ? command.scope.sessionId === fence.scope.ownerKey
    : desktopPathContains(fence.scope.directoryPath, command.scope.workingPath)
}

/** Only narrow cleanup can execute without a native owner or during orderly shutdown. */
export function desktopCleanupMatchesFence(
  command: DesktopServiceCommand,
  fence: DesktopFenceRecord,
) {
  if (fence.state !== 'active') return false
  if (command.service === 'browser' && command.operation === 'deleteOwner') {
    return fence.scope.kind === 'owner' && command.ownerKey === fence.scope.ownerKey
  }
  if (command.service !== 'terminal') return false
  if (command.operation === 'closeAllForOwner') {
    return fence.scope.kind === 'owner' && command.input.ownerKey === fence.scope.ownerKey
  }
  return (
    command.operation === 'closeAllUnderPath' &&
    fence.scope.kind === 'path' &&
    desktopPathContains(fence.scope.directoryPath, command.input.directoryPath)
  )
}
