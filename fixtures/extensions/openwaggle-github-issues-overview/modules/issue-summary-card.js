import {
  CONFIG_KEY,
  getStoredValue,
  normalizeConfig,
  normalizeSummary,
  STORAGE_CONFIG,
  STORAGE_STATE,
  SUMMARY_KEY,
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

function renderIssueRows(summary) {
  const list = element('div', { className: 'issues' })
  if (summary.issues.length === 0) {
    list.append(
      element('div', {
        className: 'empty',
        text: 'GitHub returned no open issues for this repository.',
      }),
    )
    return list
  }

  for (const issue of summary.issues.slice(0, 3)) {
    const row = element('article', { className: 'issue' })
    row.append(
      element('strong', { text: `#${issue.number} ${issue.title}` }),
      element('span', { text: issue.labels.join(', ') || issue.updatedAt }),
    )
    list.append(row)
  }
  return list
}

function renderEmptySummary(config) {
  return element('div', {
    className: 'empty',
    text: `No stored GitHub issue summary yet for ${config.owner}/${config.repo}. Open the side panel or settings to refresh it.`,
  })
}

function renderError(root, message) {
  root.replaceChildren()
  root.append(element('div', { className: 'error', text: message }))
}

async function loadSummary(context) {
  return normalizeSummary(await getStoredValue(context, STORAGE_STATE, SUMMARY_KEY))
}

async function loadConfig(context) {
  return normalizeConfig(await getStoredValue(context, STORAGE_CONFIG, CONFIG_KEY))
}

function renderSurface(context, config, summary) {
  const root = context.root
  root.replaceChildren()

  const style = element('style')
  style.textContent = `
    :root, body { margin: 0; background: transparent; }
    .card { box-sizing: border-box; display: grid; gap: 10px; padding: 12px; border: 1px solid #2d333b; border-radius: 12px; background: #0f1318; color: #d6dde7; }
    .eyebrow { color: #f0a000; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    h2 { margin: 0; color: #f4f7fb; font-size: 14px; line-height: 1.25; }
    .muted { margin: 0; color: #8b949e; font-size: 11px; line-height: 1.5; }
    .issues { display: grid; gap: 7px; }
    .issue { display: grid; gap: 3px; border: 1px solid #252b33; border-radius: 9px; padding: 8px; background: #0b0f14; }
    .issue strong { color: #e6edf3; font-size: 11px; line-height: 1.35; }
    .issue span, .empty { color: #8b949e; font-size: 10px; line-height: 1.45; }
    .error { color: #ff7b72; border: 1px solid rgba(255, 123, 114, .3); border-radius: 10px; padding: 12px; background: rgba(255, 123, 114, .08); }
  `

  const card = element('section', { className: 'card' })
  card.append(
    element('div', { className: 'eyebrow', text: 'GitHub issues' }),
    element('h2', { text: summary ? summary.repository : `${config.owner}/${config.repo}` }),
    element('p', {
      className: 'muted',
      text: summary
        ? `${summary.open} open, ${summary.ready} ready-for-agent, ${summary.stale} stale`
        : 'Issue summary will appear here after a refresh.',
    }),
    summary ? renderIssueRows(summary) : renderEmptySummary(config),
  )

  root.append(style, card)
}

export async function mount(context) {
  try {
    const config = await loadConfig(context)
    const summary = await loadSummary(context)
    renderSurface(context, config, summary)
  } catch (error) {
    renderError(context.root, error instanceof Error ? error.message : String(error))
  }
}
