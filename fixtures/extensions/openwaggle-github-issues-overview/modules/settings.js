import {
  CONFIG_KEY,
  fetchIssueSummary,
  getStoredValue,
  normalizeConfig,
  normalizeLabels,
  normalizeSummary,
  STORAGE_CONFIG,
  STORAGE_STATE,
  SUMMARY_KEY,
  setStoredValue,
} from './github-api.js'

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

function renderMetrics(summary) {
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
  return metrics
}

async function loadLiveSummary(context, config) {
  try {
    const summary = await fetchIssueSummary(config)
    await setStoredValue(context, STORAGE_STATE, SUMMARY_KEY, summary)
    return { summary, warning: null }
  } catch (error) {
    const storedSummary = normalizeSummary(
      await getStoredValue(context, STORAGE_STATE, SUMMARY_KEY),
    )
    if (storedSummary) {
      const message = error instanceof Error ? error.message : String(error)
      return { summary: storedSummary, warning: `GitHub refresh failed: ${message}` }
    }
    throw error
  }
}

function renderSettings(context, config, summary, warning) {
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
    .warning { color: #f7c45f; font-size: 12px; }
    .error { color: #ff7b72; border: 1px solid rgba(255, 123, 114, .3); border-radius: 10px; padding: 12px; background: rgba(255, 123, 114, .08); }
  `

  const card = element('section', { className: 'card' })
  const ownerField = field('Repository owner', config.owner)
  const repoField = field('Repository name', config.repo)
  const labelsField = field('Tracked labels', config.labels.join(', '))
  const status = element('div', { className: 'saved' })
  const save = element('button', { text: 'Fetch and save GitHub issues' })

  save.addEventListener('click', async () => {
    try {
      save.textContent = 'Fetching...'
      const nextConfig = {
        owner: ownerField.input.value.trim(),
        repo: repoField.input.value.trim(),
        labels: normalizeLabels(labelsField.input.value),
      }
      const nextSummary = await fetchIssueSummary(nextConfig)
      await setStoredValue(context, STORAGE_CONFIG, CONFIG_KEY, nextConfig)
      await setStoredValue(context, STORAGE_STATE, SUMMARY_KEY, nextSummary)
      renderSettings(context, normalizeConfig(nextConfig), nextSummary, null)
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      save.textContent = 'Fetch and save GitHub issues'
    }
  })

  card.append(
    element('div', { className: 'eyebrow', text: 'Development fixture' }),
    element('h2', { className: 'title', text: 'GitHub Issues Overview' }),
    element('p', {
      className: 'muted',
      text: 'This settings surface fetches public GitHub issues and stores the live summary through the brokered extension storage capability. The side panel reads and refreshes the same package state.',
    }),
    renderMetrics(summary),
    ownerField.wrapper,
    repoField.wrapper,
    labelsField.wrapper,
    save,
    element('div', { className: 'muted', text: summary.updatedAt }),
    status,
  )

  if (warning) {
    card.append(element('div', { className: 'warning', text: warning }))
  }

  root.append(style, card)
}

export async function mount(context) {
  try {
    const storedConfig = await getStoredValue(context, STORAGE_CONFIG, CONFIG_KEY)
    const config = normalizeConfig(storedConfig)
    const { summary, warning } = await loadLiveSummary(context, config)
    renderSettings(context, config, summary, warning)
  } catch (error) {
    renderError(context.root, error instanceof Error ? error.message : String(error))
  }
}
