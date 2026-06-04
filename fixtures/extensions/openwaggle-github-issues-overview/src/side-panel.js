const STORAGE_CONFIG = 'config'
const STORAGE_STATE = 'state'
const CONFIG_KEY = 'github.issues.config'
const SUMMARY_KEY = 'github.issues.summary'
const VIEWED_KEY = 'github.issues.sidePanelViewedAt'

const FALLBACK_SUMMARY = {
  repository: 'OpenWaggle/OpenWaggle',
  open: 0,
  stale: 0,
  ready: 0,
  labels: ['enhancement', 'ready-for-agent'],
  updatedAt: 'Not generated yet',
}

function element(tagName, options = {}) {
  const node = document.createElement(tagName)
  if (options.className) {
    node.className = options.className
  }
  if (options.text) {
    node.textContent = options.text
  }
  return node
}

function firstProjectPath(context) {
  return context.projectPaths[0] ?? null
}

function projectScope(context) {
  const projectPath = firstProjectPath(context)
  if (!projectPath) {
    throw new Error('GitHub Issues Overview fixture requires a project-scoped mount.')
  }
  return { kind: 'project', projectPath }
}

function packageStorage(context, storageKind) {
  return storageKind === STORAGE_CONFIG
    ? context.sdk.storage.packageConfig
    : context.sdk.storage.packageState
}

function storedResultValue(result) {
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.value
}

async function getStoredValue(context, storageKind, key) {
  const value = await packageStorage(context, storageKind).project.get(projectScope(context), key)
  return storedResultValue(value).value
}

async function setStoredValue(context, storageKind, key, value) {
  const result = await packageStorage(context, storageKind).project.set(
    projectScope(context),
    key,
    value,
  )
  return storedResultValue(result)
}

function normalizeSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return FALLBACK_SUMMARY
  }

  return {
    repository:
      typeof value.repository === 'string' ? value.repository : FALLBACK_SUMMARY.repository,
    open: typeof value.open === 'number' ? value.open : FALLBACK_SUMMARY.open,
    stale: typeof value.stale === 'number' ? value.stale : FALLBACK_SUMMARY.stale,
    ready: typeof value.ready === 'number' ? value.ready : FALLBACK_SUMMARY.ready,
    labels: Array.isArray(value.labels)
      ? value.labels.filter((label) => typeof label === 'string')
      : FALLBACK_SUMMARY.labels,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : FALLBACK_SUMMARY.updatedAt,
  }
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const owner = typeof value.owner === 'string' ? value.owner : ''
  const repo = typeof value.repo === 'string' ? value.repo : ''
  return owner && repo ? `${owner}/${repo}` : null
}

function metric(label, value) {
  const box = element('div', { className: 'metric' })
  box.append(element('strong', { text: String(value) }), element('span', { text: label }))
  return box
}

function renderLabels(labels) {
  const list = element('div', { className: 'labels' })
  for (const label of labels) {
    list.append(element('span', { text: label }))
  }
  return list
}

function renderError(root, message) {
  root.replaceChildren()
  root.append(element('div', { className: 'error', text: message }))
}

function renderPanel(context, configRepository, summary) {
  const root = context.root
  root.replaceChildren()

  const style = element('style')
  style.textContent = `
    .panel { display: grid; gap: 14px; min-height: 100%; padding: 14px; border: 1px solid #2d333b; border-radius: 12px; background: #0f1318; color: #d6dde7; }
    .eyebrow { color: #f0a000; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    h2 { margin: 0; font-size: 16px; line-height: 1.25; color: #f4f7fb; }
    .repo { color: #aeb7c2; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .metric { border: 1px solid #252b33; border-radius: 10px; padding: 9px; background: #121820; }
    .metric strong { display: block; font-size: 19px; color: #f4f7fb; }
    .metric span { color: #8b949e; font-size: 10px; }
    .labels { display: flex; flex-wrap: wrap; gap: 6px; }
    .labels span { border: 1px solid rgba(240, 160, 0, .3); border-radius: 999px; background: rgba(240, 160, 0, .1); color: #f7c45f; padding: 4px 7px; font-size: 10px; }
    .muted { color: #8b949e; font-size: 11px; line-height: 1.55; }
    button { border: 1px solid #303844; border-radius: 9px; background: #121820; color: #d6dde7; padding: 8px 10px; cursor: pointer; }
    .error { color: #ff7b72; border: 1px solid rgba(255, 123, 114, .3); border-radius: 10px; padding: 12px; background: rgba(255, 123, 114, .08); }
  `

  const panel = element('section', { className: 'panel' })
  const repository = configRepository ?? summary.repository
  const refresh = element('button', { text: 'Mark viewed' })

  refresh.addEventListener('click', async () => {
    await setStoredValue(context, STORAGE_STATE, VIEWED_KEY, new Date().toISOString())
    refresh.textContent = 'Viewed just now'
  })

  const metrics = element('div', { className: 'metrics' })
  metrics.append(
    metric('Open', summary.open),
    metric('Stale', summary.stale),
    metric('Ready', summary.ready),
  )

  panel.append(
    element('div', { className: 'eyebrow', text: 'GitHub fixture' }),
    element('h2', { text: 'Issues overview' }),
    element('div', { className: 'repo', text: repository }),
    metrics,
    renderLabels(summary.labels),
    element('p', {
      className: 'muted',
      text: `Shared state updated: ${summary.updatedAt}. Configure this fixture from Settings > Extensions.`,
    }),
    refresh,
  )

  root.append(style, panel)
}

export async function mount(context) {
  try {
    const storedConfig = await getStoredValue(context, STORAGE_CONFIG, CONFIG_KEY)
    const storedSummary = await getStoredValue(context, STORAGE_STATE, SUMMARY_KEY)
    renderPanel(context, normalizeConfig(storedConfig), normalizeSummary(storedSummary))
  } catch (error) {
    renderError(context.root, error instanceof Error ? error.message : String(error))
  }
}
