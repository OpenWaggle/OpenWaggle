import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent'

/**
 * Pi's MCP extension as OpenWaggle shows it. Settings > MCP is where servers are managed in
 * OpenWaggle, so:
 *
 * - Pi's `/mcp` command is not registered. It is a terminal menu; in OpenWaggle it only printed a
 *   status notice, and the slash menu offered it next to commands that do something.
 * - Notices and tool errors that tell the user to run `/mcp` (or `/login <provider>`) name the
 *   Settings section instead (`withOpenWaggleMcpGuidance`).
 * - The "MCP servers are still connecting" notice is dropped. Pi's `before_agent_start` handler
 *   waits briefly for servers with direct tools and, when one is slower, notifies at `info` level
 *   on every new Session; OpenWaggle already reports a server that is still connecting as a launch
 *   step and in Settings > MCP. Only `info` notices from `before_agent_start` are dropped: warnings
 *   and errors (servers that need attention, failed loads) and every other event's notices show.
 */
export function forOpenWaggleMcpSurface(factory: ExtensionFactory): ExtensionFactory {
  return (pi) => {
    pi.on('tool_result', withOpenWaggleMcpGuidanceInResult)
    return factory(openWaggleMcpApi(pi))
  }
}

/** Pi's MCP command, which Settings > MCP replaces in OpenWaggle. */
const PI_MCP_COMMAND = 'mcp'

/**
 * Pi's MCP extension and runtime point the user at its terminal commands. In OpenWaggle the same
 * things are done in Settings: servers in Settings > MCP, provider sign-in in Settings >
 * Connections. Pi's own wording is matched exactly, so a server's own message is left alone.
 */
export function withOpenWaggleMcpGuidance(text: string): string {
  return text
    .replaceAll('Run /mcp to fix.', 'Open Settings > MCP to fix this.')
    .replaceAll('Run /mcp to sign in.', 'Sign in from Settings > MCP.')
    .replace(
      /Run \/login (\S+) to sign in\./g,
      (_match, provider: string) => `Sign in to ${provider} from Settings > Connections.`,
    )
}

/**
 * A tool error that tells the model to have the user run `/mcp`, with OpenWaggle's guidance, so
 * the model repeats instructions that work here. Codemode scripts report the errors of the MCP
 * calls they make in their own result, so every tool's text is checked, not only `mcp__` tools'.
 */
function withOpenWaggleMcpGuidanceInResult(event: ToolResultEvent) {
  let changed = false
  const content = event.content.map((part) => {
    if (part.type !== 'text') return part
    const text = withOpenWaggleMcpGuidance(part.text)
    if (text === part.text) return part
    changed = true
    return { ...part, text }
  })
  return changed ? { content } : undefined
}

/**
 * `on` and `registerCommand` cannot be typed as `ExtensionAPI`'s own (one overload per event), and
 * the Proxy trap returns `any`, so the type system does not check these replacements:
 * `mcp-openwaggle-surface.integration.test.ts` does, against Pi's real MCP extension.
 */
function openWaggleMcpApi(pi: ExtensionAPI): ExtensionAPI {
  const on = (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
    const quiet = event === 'before_agent_start'
    const unsubscribe: unknown = Reflect.apply(pi.on, pi, [
      event,
      (payload: unknown, ctx: ExtensionContext) => handler(payload, openWaggleContext(ctx, quiet)),
    ])
    return unsubscribe
  }
  const registerCommand: ExtensionAPI['registerCommand'] = (name, command) => {
    if (name === PI_MCP_COMMAND) return
    pi.registerCommand(name, command)
  }
  return new Proxy(pi, {
    get: (target, property) => {
      if (property === 'on') return on
      if (property === 'registerCommand') return registerCommand
      return boundMember(target, property)
    },
  })
}

function openWaggleContext(ctx: ExtensionContext, withoutInfoNotices: boolean): ExtensionContext {
  return new Proxy(ctx, {
    // Pi's context reads its fields through getters that check the runner is still active, so the
    // UI is read when the handler uses it, not when the event starts.
    get: (target, property) =>
      property === 'ui'
        ? openWaggleUi(target.ui, withoutInfoNotices)
        : boundMember(target, property),
  })
}

function openWaggleUi(ui: ExtensionUIContext, withoutInfoNotices: boolean): ExtensionUIContext {
  const notify: ExtensionUIContext['notify'] = (message, level) => {
    if (withoutInfoNotices && (level === undefined || level === 'info')) return
    ui.notify(withOpenWaggleMcpGuidance(message), level)
  }
  return new Proxy(ui, {
    get: (target, property) => (property === 'notify' ? notify : boundMember(target, property)),
  })
}

/** A member read as from the target itself, so methods keep their own `this`. */
function boundMember(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property, target)
  return typeof value === 'function' ? value.bind(target) : value
}
