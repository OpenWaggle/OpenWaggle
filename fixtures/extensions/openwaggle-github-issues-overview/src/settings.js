import {
  CONFIG_KEY,
  getStoredValue,
  normalizeConfig,
  normalizeLabels,
  STORAGE_CONFIG,
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

function field(label, value, helperText) {
  const wrapper = element('label', { className: 'field' })
  wrapper.append(element('span', { text: label }))
  const input = element('input')
  input.value = value
  wrapper.append(input)
  if (helperText) {
    wrapper.append(element('small', { text: helperText }))
  }
  return { wrapper, input }
}

function renderError(root, message) {
  root.replaceChildren()
  root.append(element('div', { className: 'error', text: message }))
}

function renderSettings(context, config, initialStatus = '') {
  const root = context.root
  root.replaceChildren()

  const style = element('style')
  style.textContent = `
    .card { box-sizing: border-box; display: grid; gap: 16px; padding: 14px; border: 1px solid #2d333b; border-radius: 12px; background: #0f1318; color: #d6dde7; }
    .eyebrow { color: #f0a000; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .title { margin: 0; font-size: 18px; line-height: 1.2; color: #f4f7fb; }
    .muted { margin: 0; color: #8b949e; font-size: 12px; line-height: 1.55; }
    .form { display: grid; gap: 12px; }
    .field { display: grid; gap: 6px; color: #aeb7c2; font-size: 12px; }
    .field span { font-weight: 650; color: #d6dde7; }
    .field small { color: #707a86; font-size: 11px; line-height: 1.45; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #303844; border-radius: 9px; background: #0b0f14; color: #e6edf3; padding: 9px 10px; outline: none; }
    input:focus { border-color: #f0a000; box-shadow: 0 0 0 2px rgba(240, 160, 0, .18); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    button { border: 1px solid #b77900; border-radius: 9px; background: #f0a000; color: #1a1200; font-weight: 750; padding: 9px 12px; cursor: pointer; }
    button:disabled { cursor: wait; opacity: .7; }
    .status { min-height: 18px; color: #7ee787; font-size: 12px; }
    .error { color: #ff7b72; border: 1px solid rgba(255, 123, 114, .3); border-radius: 10px; padding: 12px; background: rgba(255, 123, 114, .08); }
  `

  const card = element('section', { className: 'card' })
  const form = element('div', { className: 'form' })
  const ownerField = field('Repository owner', config.owner, 'GitHub owner or organization.')
  const repoField = field(
    'Repository name',
    config.repo,
    'Repository used by the side panel and tool renderers.',
  )
  const labelsField = field(
    'Tracked labels',
    config.labels.join(', '),
    'Comma-separated labels used to calculate the ready count.',
  )
  const actions = element('div', { className: 'actions' })
  const status = element('div', { className: 'status' })
  status.textContent = initialStatus
  const save = element('button', { text: 'Save configuration' })

  save.addEventListener('click', async () => {
    try {
      save.disabled = true
      save.textContent = 'Saving...'
      const nextConfig = normalizeConfig({
        owner: ownerField.input.value,
        repo: repoField.input.value,
        labels: normalizeLabels(labelsField.input.value),
      })
      await setStoredValue(context, STORAGE_CONFIG, CONFIG_KEY, nextConfig)
      renderSettings(
        context,
        nextConfig,
        'Configuration saved. The side panel will use it on the next refresh.',
      )
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      save.disabled = false
      save.textContent = 'Save configuration'
    }
  })

  form.append(ownerField.wrapper, repoField.wrapper, labelsField.wrapper)
  actions.append(save, status)
  card.append(
    element('div', { className: 'eyebrow', text: 'Extension configuration' }),
    element('h2', { className: 'title', text: 'GitHub Issues' }),
    element('p', {
      className: 'muted',
      text: 'Choose the repository and labels used by the GitHub Issues side panel, chat extension cards, and Pi tool.',
    }),
    form,
    actions,
  )

  root.append(style, card)
}

export async function mount(context) {
  try {
    const storedConfig = await getStoredValue(context, STORAGE_CONFIG, CONFIG_KEY)
    renderSettings(context, normalizeConfig(storedConfig))
  } catch (error) {
    renderError(context.root, error instanceof Error ? error.message : String(error))
  }
}
