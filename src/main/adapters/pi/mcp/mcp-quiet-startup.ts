import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'

/**
 * Pi's MCP extension, without its "MCP servers are still connecting" notice.
 *
 * Pi's `before_agent_start` handler waits briefly for servers with direct tools and, when one is
 * slower, notifies at `info` level on every new Session. OpenWaggle already reports a server that
 * is still connecting as a launch step and in Settings > MCP, so the toast only repeated that on
 * every Session. Only `info` notices from `before_agent_start` are dropped: warnings and errors
 * (servers that need attention, failed loads) and every other event's notices still show.
 */
export function withoutMcpStartupNotice(factory: ExtensionFactory): ExtensionFactory {
  return (pi) => factory(quietBeforeAgentStart(pi))
}

function quietBeforeAgentStart(pi: ExtensionAPI): ExtensionAPI {
  const on = (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
    Reflect.apply(pi.on, pi, [
      event,
      event === 'before_agent_start'
        ? (payload: unknown, ctx: ExtensionContext) => handler(payload, withoutInfoNotices(ctx))
        : handler,
    ])
  return new Proxy(pi, {
    get: (target, property) => (property === 'on' ? on : boundMember(target, property)),
  })
}

function withoutInfoNotices(ctx: ExtensionContext): ExtensionContext {
  return new Proxy(ctx, {
    // Pi's context reads its fields through getters that check the runner is still active, so the
    // UI is read when the handler uses it, not when the event starts.
    get: (target, property) =>
      property === 'ui' ? quietUi(target.ui) : boundMember(target, property),
  })
}

function quietUi(ui: ExtensionUIContext): ExtensionUIContext {
  const notify: ExtensionUIContext['notify'] = (message, level) => {
    if (level === undefined || level === 'info') return
    ui.notify(message, level)
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
