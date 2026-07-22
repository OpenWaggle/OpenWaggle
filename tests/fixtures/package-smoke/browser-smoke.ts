import { defineExtensionManifest, validateExtensionManifest } from '@openwaggle/extension-sdk'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Panel,
  Select,
  Stack,
  Textarea,
} from '@openwaggle/extension-react'
import '@openwaggle/extension-react/styles.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const browserManifest = defineExtensionManifest({
  manifestVersion: 1,
  id: 'browser-package-smoke',
  name: 'Browser package smoke',
  version: '0.1.0',
  sdk: { openwaggle: '0.1.0' },
  sourceFiles: [],
  builtArtifacts: [],
  capabilities: [],
  contributions: {},
})

async function runBrowserSmoke() {
  validateExtensionManifest(browserManifest)
  const mount = document.querySelector('#browser-smoke-root')
  if (!(mount instanceof HTMLElement)) {
    throw new Error('Browser package smoke root is missing.')
  }

  createRoot(mount).render(createElement(
    Panel,
    {},
    createElement(
      Stack,
      { gap: '8px' },
      createElement(Badge, { tone: 'success' }, 'Ready'),
      createElement(Alert, { tone: 'info' }, 'Browser package smoke'),
      createElement(
        Field,
        { htmlFor: 'browser-smoke-input', label: 'Name', description: 'Package fixture' },
        createElement(Input, { id: 'browser-smoke-input', defaultValue: 'OpenWaggle' }),
      ),
      createElement(Textarea, { id: 'browser-smoke-textarea', defaultValue: 'Details' }),
      createElement(
        Select,
        { id: 'browser-smoke-select', defaultValue: 'one' },
        createElement('option', { value: 'one' }, 'One'),
      ),
      createElement(Checkbox, { id: 'browser-smoke-checkbox', defaultChecked: true }),
      createElement(Button, { id: 'browser-smoke-button' }, 'Browser package smoke'),
    ),
  ))
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

  const button = document.querySelector('#browser-smoke-button')
  if (!(button instanceof HTMLButtonElement) || button.textContent !== 'Browser package smoke') {
    throw new Error('Extension React button did not render in Chromium.')
  }
  for (const elementId of [
    'browser-smoke-input',
    'browser-smoke-textarea',
    'browser-smoke-select',
    'browser-smoke-checkbox',
  ]) {
    if (!(document.querySelector(`#${elementId}`) instanceof HTMLElement)) {
      throw new Error(`Extension React ${elementId} did not render in Chromium.`)
    }
  }
  if (!(document.querySelector('.ow-extension-panel') instanceof HTMLElement)) {
    throw new Error('Extension React panel did not render in Chromium.')
  }

  document.documentElement.dataset.openwagglePackageSmoke = 'passed'
}

runBrowserSmoke().catch((error: unknown) => {
  document.documentElement.dataset.openwagglePackageSmoke = 'failed'
  console.error(error)
})
