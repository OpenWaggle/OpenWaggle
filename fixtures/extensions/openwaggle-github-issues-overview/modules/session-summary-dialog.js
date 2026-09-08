function element(tagName, text) {
  const node = document.createElement(tagName)
  if (text) node.textContent = text
  return node
}

export function mount(context) {
  const payload = context.surfacePayload ?? {}
  const section = element('section')
  section.append(
    element('h2', 'Session Summary context'),
    element('p', `Surface: ${payload.surface ?? 'unavailable'}`),
    element('p', `Session: ${payload.sessionId ?? 'unavailable'}`),
    element('p', `Project: ${payload.projectPaths?.[0] ?? 'unavailable'}`),
    element('p', `Messages: ${payload.messageCount ?? 'unavailable'}`),
  )
  context.root.replaceChildren(section)
}
