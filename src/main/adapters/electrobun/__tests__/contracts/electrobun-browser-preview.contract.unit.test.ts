import { describe, it } from 'vitest'
import { browserPreviewViewsContract } from '../../../../ports/desktop-shell/__tests__/contracts/browser-preview-views.contract'
import { prepareElectrobunShell } from './electrobun-shell'

describe(`${browserPreviewViewsContract.port} contract (Electrobun)`, () => {
  it.for(Object.entries(browserPreviewViewsContract.cases))('%s', async ([, check]) => {
    const { electrobun } = await prepareElectrobunShell()
    const { createElectrobunBrowserPreviewViews } =
      await import('../../electrobun-browser-preview-views')
    await check({
      subject: createElectrobunBrowserPreviewViews({
        appPaths: { userData: () => '/openwaggle-contract/user-data' },
        clipboard: { writeImage: async () => 'written' },
        osShell: { showItemInFolder: () => undefined },
      }),
      closedPage: () => {
        const page = electrobun.browserPreview.openOwnerPage()
        page.close()
        return page.surface
      },
    })
  })
})
