import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { applicationCliArguments } from '../../../../src/main/application-cli-arguments'
import { prepareDesktopUi } from '../../../../src/main/desktop-window-policy'

prepareDesktopUi(app)
const directory = process.env.OPENWAGGLE_QA_CLI_BOUNDARY_DIR
if (!directory) throw new Error('CLI boundary fixture requires its private directory.')
app.setPath('userData', path.join(directory, 'profile'))

// Publish entry evidence before readiness: a native validator rejection never executes this code.
fs.writeFileSync(
  path.join(directory, 'entered.json'),
  JSON.stringify({
    identity: {
      pid: process.pid,
      electron: process.versions.electron,
      node: process.versions.node,
      uv: process.versions.uv,
    },
    arguments: applicationCliArguments(process.argv, { isPackaged: app.isPackaged }),
    chromiumApplicationSwitch: app.commandLine.hasSwitch('openwaggle-qa-argument-switch'),
  }),
)

void app.whenReady().then(
  () => app.quit(),
  () => app.exit(1),
)
