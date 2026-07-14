import { defineExtensionManifest, validateExtensionManifest } from '@openwaggle/extension-sdk'
import { Button } from '@openwaggle/extension-react'
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

  createRoot(mount).render(
    createElement(Button, { id: 'browser-smoke-button' }, 'Browser package smoke'),
  )
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

  const button = document.querySelector('#browser-smoke-button')
  if (!(button instanceof HTMLButtonElement) || button.textContent !== 'Browser package smoke') {
    throw new Error('Extension React button did not render in Chromium.')
  }

  document.documentElement.dataset.openwagglePackageSmoke = 'passed'
}

runBrowserSmoke().catch((error: unknown) => {
  document.documentElement.dataset.openwagglePackageSmoke = 'failed'
  console.error(error)
})
