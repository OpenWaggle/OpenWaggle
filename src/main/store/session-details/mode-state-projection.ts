import {
  PI_WAGGLE_MODE_STATE_CUSTOM_TYPE,
  parsePiWaggleModeState,
} from '@openwaggle/pi-waggle/protocol'
import { isRecord } from '@shared/utils/validation'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { hydrateWaggleConfig, parseJsonValue } from './json'
import type { DerivedSessionBranch } from './types'

function getNodePath(input: {
  readonly headNodeId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
}) {
  const path: ProjectedSessionNodeInput[] = []
  let currentNodeId = input.headNodeId
  while (currentNodeId) {
    const node = input.nodeById.get(currentNodeId)
    if (!node) break
    path.unshift(node)
    currentNodeId = node.parentId
  }
  return path
}

function modeStateFromNode(node: ProjectedSessionNodeInput) {
  if (node.piEntryType !== 'custom') return null

  const content = parseJsonValue(node.contentJson)
  if (!isRecord(content) || content.customType !== PI_WAGGLE_MODE_STATE_CUSTOM_TYPE) {
    return null
  }

  const state = parsePiWaggleModeState(content.data)
  if (!state) return null

  const config = hydrateWaggleConfig(state.config)
  return {
    enabled: state.enabled,
    ...(state.presetId ? { presetId: state.presetId } : {}),
    ...(config ? { config } : {}),
  }
}

function latestModeStateFromPath(path: readonly ProjectedSessionNodeInput[]) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index]
    if (!node) continue

    const modeState = modeStateFromNode(node)
    if (modeState) return modeState
  }

  return null
}

export function latestModeStateForBranch(input: {
  readonly branch: DerivedSessionBranch
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
}) {
  return latestModeStateFromPath(
    getNodePath({ headNodeId: input.branch.headNodeId, nodeById: input.nodeById }),
  )
}

export function latestModeStateForActiveNode(input: {
  readonly activeNodeId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
}) {
  return latestModeStateFromPath(
    getNodePath({ headNodeId: input.activeNodeId, nodeById: input.nodeById }),
  )
}
