import {
  CONFIG_KEY,
  fetchIssueSummary,
  getStoredValue,
  normalizeConfig,
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

async function loadConfig(context) {
  return normalizeConfig(await getStoredValue(context, STORAGE_CONFIG, CONFIG_KEY))
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

function renderPanel(context, config, summary, warning) {
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
    .warning { color: #f7c45f; font-size: 11px; line-height: 1.55; }
    button { border: 1px solid #303844; border-radius: 9px; background: #121820; color: #d6dde7; padding: 8px 10px; cursor: pointer; }
    .error { color: #ff7b72; border: 1px solid rgba(255, 123, 114, .3); border-radius: 10px; padding: 12px; background: rgba(255, 123, 114, .08); }
  `

  const panel = element('section', { className: 'panel' })
  const refresh = element('button', { text: 'Refresh from GitHub' })

  refresh.addEventListener('click', async () => {
    try {
      refresh.textContent = 'Refreshing...'
      const nextConfig = await loadConfig(context)
      const nextSummary = await fetchIssueSummary(nextConfig)
      await setStoredValue(context, STORAGE_STATE, SUMMARY_KEY, nextSummary)
      renderPanel(context, nextConfig, nextSummary, null)
    } catch (error) {
      refresh.textContent = error instanceof Error ? error.message : String(error)
    }
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
    element('div', { className: 'repo', text: summary.repository }),
    metrics,
    renderLabels(config.labels),
    element('p', {
      className: 'muted',
      text: summary.updatedAt,
    }),
    refresh,
  )

  if (warning) {
    panel.append(element('div', { className: 'warning', text: warning }))
  }

  root.append(style, panel)
}

export async function mount(context) {
  try {
    const config = await loadConfig(context)
    const { summary, warning } = await loadLiveSummary(context, config)
    renderPanel(context, config, summary, warning)
  } catch (error) {
    renderError(context.root, error instanceof Error ? error.message : String(error))
  }
}
