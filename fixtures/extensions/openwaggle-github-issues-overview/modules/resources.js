function element(tagName, options = {}) {
  const node = document.createElement(tagName)
  if (options.text) node.textContent = options.text
  return node
}

export function mount(context) {
  const section = element('section')
  const title = element('h2', { text: 'Session resource publisher' })
  const status = element('p', { text: 'Ready to publish to this session.' })
  const publish = element('button', { text: 'Publish session report' })

  publish.addEventListener('click', async () => {
    if (!context.sessionId) {
      status.textContent = 'No session is available.'
      return
    }
    publish.disabled = true
    const projectPath = context.projectPaths[0]
    if (!projectPath) {
      status.textContent = 'No project is available.'
      publish.disabled = false
      return
    }
    const scope = { kind: 'session', projectPath, sessionId: context.sessionId }
    const result = await context.sdk.openWaggle.resources.publish(scope, {
      key: 'github-session-report',
      title: 'GitHub session report',
      kind: 'link',
      role: 'output',
      locator: 'https://github.com/OpenWaggle/OpenWaggle/issues',
    })
    status.textContent = result.ok ? 'Published to Outputs.' : result.error.message
    publish.disabled = false
  })

  section.append(title, publish, status)
  context.root.replaceChildren(section)
}
