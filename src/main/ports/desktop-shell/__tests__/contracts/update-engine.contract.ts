import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { UpdateEngineShape } from '../../update-engine'

export interface UpdateEngineContractHarness {
  readonly subject: UpdateEngineShape
  /** The feed offers `version` on the next check (`null`: nothing newer). */
  readonly offerOnNextCheck: (version: string | null) => void
  /** The engine reports progress as the shell's engine would. */
  readonly engineReports: {
    readonly available: (version: string) => void
    readonly progress: (percent: number) => void
    readonly downloaded: (version: string) => void
    readonly failed: (error: Error) => void
  }
  /** Whether an install is scheduled for the next quit. */
  readonly installsOnQuit: () => boolean
  /** The installs requested so far. */
  readonly installs: () => readonly { readonly silent: boolean; readonly relaunch: boolean }[]
  /** Whether the download of the last offered update was cancelled. */
  readonly downloadCancelled: () => boolean
}

export const updateEngineContract = definePortContract<UpdateEngineContractHarness>(
  'UpdateEngine',
  {
    'reports an offered update and lets the caller cancel its download': async ({
      subject,
      offerOnNextCheck,
      downloadCancelled,
    }) => {
      offerOnNextCheck(null)
      await expect(subject.checkForUpdates()).resolves.toBeNull()
      offerOnNextCheck('1.2.0')
      const check = await subject.checkForUpdates()
      expect(check?.version).toBe('1.2.0')
      check?.cancelDownload()
      expect(downloadCancelled()).toBe(true)
    },

    'forwards engine events in OpenWaggle terms until unsubscribed': async ({
      subject,
      engineReports,
    }) => {
      const seen: string[] = []
      const stops = [
        subject.onUpdateAvailable((version) => seen.push(`available ${version}`)),
        subject.onDownloadProgress((percent) => seen.push(`progress ${percent}`)),
        subject.onUpdateDownloaded((version) => seen.push(`downloaded ${version}`)),
        subject.onError((error) => seen.push(`error ${error.message}`)),
      ]
      engineReports.available('1.2.0')
      engineReports.progress(42.5)
      engineReports.downloaded('1.2.0')
      engineReports.failed(new Error('checksum'))
      for (const stop of stops) stop()
      engineReports.available('1.3.0')
      expect(seen).toEqual([
        'available 1.2.0',
        'progress 42.5',
        'downloaded 1.2.0',
        'error checksum',
      ])
    },

    'never installs on quit unless asked, and installs as asked': async ({
      subject,
      installsOnQuit,
      installs,
    }) => {
      subject.configure({ feedChannel: 'beta', allowPrerelease: true })
      subject.cancelInstallOnQuit()
      expect(installsOnQuit()).toBe(false)
      subject.quitAndInstall({ silent: true, relaunch: false })
      expect(installs()).toEqual([{ silent: true, relaunch: false }])
    },
  },
)
