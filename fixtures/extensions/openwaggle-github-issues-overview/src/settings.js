const STORAGE_CONFIG = 'config'
const STORAGE_STATE = 'state'
const CONFIG_KEY = 'github.issues.config'
const SUMMARY_KEY = 'github.issues.summary'

const DEFAULT_CONFIG = {
  owner: 'OpenWaggle',
  repo: 'OpenWaggle',
  labels: ['enhancement', 'ready-for-agent'],
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

function normalizeLabels(value) {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_CONFIG
  }

  const owner =
    typeof value.owner === 'string' && value.owner.trim() ? value.owner.trim() : 'OpenWaggle'
  const repo =
    typeof value.repo === 'string' && value.repo.trim() ? value.repo.trim() : 'OpenWaggle'
  const labels = Array.isArray(value.labels)
    ? value.labels
        .filter((label) => typeof label === 'string' && label.trim())
        .map((label) => label.trim())
    : DEFAULT_CONFIG.labels

  return { owner, repo, labels }
}

function stableNumber(seed) {
  let total = 0
  for (const char of seed) {
    total = (total + char.charCodeAt(0)) % 997
  }
  return total
}

function makeSummary(config) {
  const seed = `${config.owner}/${config.repo}:${config.labels.join(',')}`
  const base = stableNumber(seed)
  const open = (base % 37) + 3
  const stale = Math.floor(open / 3)
  const ready = Math.max(1, Math.floor(open / 4))

  return {
    repository: `${config.owner}/${config.repo}`,
    open,
    stale,
    ready,
    labels: config.labels,
    updatedAt: new Date().toISOString(),
  }
}

function field(label, value) {
  const wrapper = element('label', { className: 'field' })
  wrapper.append(element('span', { text: label }))
  const input = element('input')
  input.value = value
  wrapper.append(input)
  return { wrapper, input }
}

function renderError(root, message) {
  root.replaceChildren()
  root.append(element('div', { className: 'error', text: message }))
}

function renderSettings(context, config, summary) {
  const root = context.root
  root.replaceChildren()

  const style = element('style')
  style.textContent = `
    .card { display: grid; gap: 14px; padding: 14px; border: 1px solid #2d333b; border-radius: 12px; background: #0f1318; color: #d6dde7; }
    .eyebrow { color: #f0a000; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .title { margin: 0; font-size: 18px; line-height: 1.2; }
    .muted { color: #8b949e; font-size: 12px; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .metric { border: 1px solid #252b33; border-radius: 10px; padding: 10px; background: #121820; }
    .metric strong { display: block; font-size: 20px; color: #f4f7fb; }
    .metric span { color: #8b949e; font-size: 11px; }
    .field { display: grid; gap: 6px; color: #aeb7c2; font-size: 12px; }
    input { width: 100%; border: 1px solid #303844; border-radius: 9px; background: #0b0f14; color: #e6edf3; padding: 9px 10px; outline: none; }
    input:focus { border-color: #f0a000; box-shadow: 0 0 0 2px rgba(240, 160, 0, .18); }
    button { justify-self: start; border: 1px solid #b77900; border-radius: 9px; background: #f0a000; color: #1a1200; font-weight: 700; padding: 9px 12px; cursor: pointer; }
    .saved { min-height: 18px; color: #7ee787; font-size: 12px; }
    .error { color: #ff7b72; border: 1px solid rgba(255, 123, 114, .3); border-radius: 10px; padding: 12px; background: rgba(255, 123, 114, .08); }
  `

  const card = element('section', { className: 'card' })
  const ownerField = field('Repository owner', config.owner)
  const repoField = field('Repository name', config.repo)
  const labelsField = field('Tracked labels', config.labels.join(', '))
  const status = element('div', { className: 'saved' })
  const save = element('button', { text: 'Save fixture state' })

  save.addEventListener('click', async () => {
    try {
      save.textContent = 'Saving...'
      const nextConfig = {
        owner: ownerField.input.value.trim(),
        repo: repoField.input.value.trim(),
        labels: normalizeLabels(labelsField.input.value),
      }
      const nextSummary = makeSummary(nextConfig)
      await setStoredValue(context, STORAGE_CONFIG, CONFIG_KEY, nextConfig)
      await setStoredValue(context, STORAGE_STATE, SUMMARY_KEY, nextSummary)
      renderSettings(context, nextConfig, nextSummary)
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      save.textContent = 'Save fixture state'
    }
  })

  card.append(
    element('div', { className: 'eyebrow', text: 'Development fixture' }),
    element('h2', { className: 'title', text: 'GitHub Issues Overview' }),
    element('p', {
      className: 'muted',
      text: 'This settings surface writes project-scoped config and issue summary state through the brokered extension storage capability. The side panel reads the same package state.',
    }),
  )

  const metrics = element('div', { className: 'grid' })
  for (const metric of [
    ['Open', summary.open],
    ['Stale', summary.stale],
    ['Ready', summary.ready],
  ]) {
    const box = element('div', { className: 'metric' })
    box.append(element('strong', { text: String(metric[1]) }), element('span', { text: metric[0] }))
    metrics.append(box)
  }

  card.append(metrics, ownerField.wrapper, repoField.wrapper, labelsField.wrapper, save, status)
  root.append(style, card)
}

export async function mount(context) {
  try {
    const storedConfig = await getStoredValue(context, STORAGE_CONFIG, CONFIG_KEY)
    const config = normalizeConfig(storedConfig)
    const storedSummary = await getStoredValue(context, STORAGE_STATE, SUMMARY_KEY)
    const summary =
      storedSummary && typeof storedSummary === 'object' ? storedSummary : makeSummary(config)
    renderSettings(context, config, summary)
  } catch (error) {
    renderError(context.root, error instanceof Error ? error.message : String(error))
  }
}
