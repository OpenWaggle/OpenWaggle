import path from 'node:path'
import type { SessionContentTree } from '@shared/types/session'
import { extractInlineVisualizationReferences } from '@shared/utils/inline-visualization'
import { isPathInsideDirectory } from '../utils/project-path-validation'

export function sessionTreeReferencesWorktreeVisualization(
  tree: SessionContentTree,
  worktreePath: string,
) {
  const normalizedWorktreePath = path.resolve(worktreePath)
  return tree.nodes.some((node) =>
    node.message?.parts.some(
      (part) =>
        part.type === 'text' &&
        extractInlineVisualizationReferences(part.text).some((reference) =>
          isPathInsideDirectory(normalizedWorktreePath, path.resolve(reference.path)),
        ),
    ),
  )
}
