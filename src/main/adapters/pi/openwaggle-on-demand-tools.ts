import type { ExtensionAPI, ToolNamespace } from '@earendil-works/pi-coding-agent'

/** Pi's `tool_search` tool (`extensions/tool-search`), which OpenWaggle loads into every session. */
export const TOOL_SEARCH_TOOL_NAME = 'tool_search'

/**
 * The namespace of OpenWaggle's on-demand tools, so codemode's `describeNamespace('openwaggle')`
 * and `searchTools(query, { namespace: 'openwaggle' })` find them, and tool search ranks them by
 * it too.
 */
export const OPENWAGGLE_ON_DEMAND_TOOL_NAMESPACE: ToolNamespace = {
  name: 'openwaggle',
  description:
    'OpenWaggle tools: browser preview, project actions, source control host setup, and docs.',
}

type ToolRegistration = Pick<ExtensionAPI, 'registerTool'>

/**
 * Registers OpenWaggle tools the model rarely needs as `deferred`: they are not declared to the
 * model until `tool_search` loads them, and codemode scripts can call them at any time (ADR 0051
 * amendment, decision 1 of the v1 performance plan). Each family costs one short rule instead of
 * its schemas on every request. Prompt snippets and guidelines are left out: they would change the
 * system prompt, and its cache, the moment `tool_search` loads the tool. Put what the model needs
 * in the description, which arrives with the tool.
 */
export function onDemandToolRegistration(pi: ExtensionAPI): ToolRegistration {
  return {
    registerTool: (tool) => {
      const { promptSnippet: _snippet, promptGuidelines: _guidelines, ...definition } = tool
      pi.registerTool({
        ...definition,
        exposure: 'deferred',
        namespace: OPENWAGGLE_ON_DEMAND_TOOL_NAMESPACE,
      })
    },
  }
}

function activateToolSearch(pi: ExtensionAPI) {
  // Only Pi's tool search declares `reachesTools`; another extension's tool of the same name
  // could not load anything, so it is never activated (as Pi's MCP extension decides).
  const toolSearch = pi
    .getAllTools()
    .some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME && tool.reachesTools !== undefined)
  const active = pi.getActiveTools()
  if (!toolSearch || active.includes(TOOL_SEARCH_TOOL_NAME)) return
  pi.setActiveTools([...active, TOOL_SEARCH_TOOL_NAME])
}

/** How a family of on-demand tools tells the model it exists. */
export type OnDemandToolAnnouncement =
  /** One rule in `<rules>` naming the tools and when to load them. */
  | { readonly rule: string }
  /** Replaces one of Pi's system prompt sections in place, such as `docs`. */
  | { readonly section: { readonly name: string; readonly text: string } }

/**
 * Makes a family of on-demand tools discoverable: activates `tool_search` when the session starts
 * and announces the family, the same way on every turn so the system prompt stays byte-stable.
 */
export function announceOnDemandTools(pi: ExtensionAPI, announcement: OnDemandToolAnnouncement) {
  pi.on('session_start', () => {
    activateToolSearch(pi)
  })
  pi.on('before_agent_start', (event) => {
    const options = event.systemPromptOptions
    if ('rule' in announcement) options.promptGuidelines.push(announcement.rule)
    else options.sections[announcement.section.name] = announcement.section.text
    return undefined
  })
}
