import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'

const INLINE_SCRIPT_FLAG = '__OPENWAGGLE_INLINE_SCRIPT_EXECUTED__'

test('CSP blocks inline script execution in renderer', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-csp-')

  try {
    const window = app.window()

    const inlineScriptExecuted = await window.evaluate((scriptFlag) => {
      Reflect.set(window, scriptFlag, false)
      const script = document.createElement('script')
      script.textContent = `window.${scriptFlag} = true;`
      document.body.appendChild(script)
      return Reflect.get(window, scriptFlag) === true
    }, INLINE_SCRIPT_FLAG)

    expect(inlineScriptExecuted).toBe(false)
  } finally {
    await app.cleanup()
  }
})
