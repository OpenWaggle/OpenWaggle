export type WorkspaceMutationAction =
  | 'create-file'
  | 'create-directory'
  | 'move'
  | 'duplicate'
  | 'trash'

export function retargetRelativePath(candidate: string, previousPath: string, nextPath: string) {
  return candidate === previousPath || candidate.startsWith(`${previousPath}/`)
    ? `${nextPath}${candidate.slice(previousPath.length)}`
    : candidate
}
