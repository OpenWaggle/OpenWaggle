import type { Message } from '@shared/types/agent'
import type { ToolCallResult } from '@shared/types/tools'
import { toolResultOutputGroups } from './session-resource-capture-tool'
import { collectExplicitResources } from './session-resource-extraction'

type CollectedResources = ReturnType<typeof collectExplicitResources>
type Positions = ReturnType<typeof imageDisplayPositions>

/** One display sequence for generated images and image links; ordinary links do not take a slot. */
export function imageDisplayPositions(resources: CollectedResources, startOrder: number) {
  const images: Array<number | null> = Array.from({ length: resources.images.length }, () => null)
  const links: Array<number | null> = Array.from({ length: resources.links.length }, () => null)
  let nextOrder = startOrder
  for (const entry of resources.order) {
    if (entry.kind === 'image') {
      images[entry.index] = nextOrder++
      continue
    }
    if (resources.links[entry.index]?.image) links[entry.index] = nextOrder++
  }
  return { images, links, nextOrder }
}

interface PlannedToolGroup {
  readonly label: string | null
  readonly resources: CollectedResources
  readonly positions: Positions
}

interface PlannedToolResult {
  readonly toolResult: ToolCallResult
  readonly groups: readonly PlannedToolGroup[]
}

/** Preserve tool-first occurrence indexes while deriving display order from message-part order. */
export function assistantMessageResourcePlan(message: Message) {
  const toolResults: PlannedToolResult[] = []
  const textPositions: {
    images: Array<number | null>
    links: Array<number | null>
  } = { images: [], links: [] }
  let nextOrder = 0
  for (const part of message.parts) {
    if (part.type === 'tool-result') {
      const groups = toolResultOutputGroups(part.toolResult).map((group) => {
        const resources = collectExplicitResources(group.result)
        const positions = imageDisplayPositions(resources, nextOrder)
        nextOrder = positions.nextOrder
        return { label: group.label, resources, positions }
      })
      toolResults.push({ toolResult: part.toolResult, groups })
      continue
    }
    if (part.type !== 'text') continue
    const resources = collectExplicitResources(part)
    const positions = imageDisplayPositions(resources, nextOrder)
    nextOrder = positions.nextOrder
    textPositions.images.push(...positions.images)
    textPositions.links.push(...positions.links)
  }
  const textResources = collectExplicitResources(
    message.parts.filter((part) => part.type === 'text'),
  )
  return {
    toolResults,
    textResources,
    textPositions: {
      images: textResources.images.map((_, index) => textPositions.images[index] ?? null),
      links: textResources.links.map((_, index) => textPositions.links[index] ?? null),
    },
  }
}
