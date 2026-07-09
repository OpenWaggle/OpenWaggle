import {
  OPENWAGGLE_EXTENSION,
  openWaggleExtensionClassName,
  type OpenWaggleExtensionManifest,
} from '@openwaggle/extension-sdk'
import { Button, type ButtonProps } from '@openwaggle/extension-react'
import {
  BUILT_IN_WAGGLE_PRESETS,
  startWaggleRun,
  WAGGLE_INHERIT_MODEL,
  type WaggleConfig,
} from '@openwaggle/waggle-core'
import {
  createPiWaggleTurnDetails,
  PI_WAGGLE_TURN_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle'
import defaultPiWaggleExtension from '@openwaggle/pi-waggle/extension'

const manifest: OpenWaggleExtensionManifest = {
  manifestVersion: 1,
  id: 'package-smoke',
  name: 'Package smoke',
  version: '0.1.0',
  sdk: {
    openwaggle: '0.1.0',
  },
  sourceFiles: [],
  builtArtifacts: [],
  capabilities: [],
  contributions: {},
}
const config: WaggleConfig = {
  mode: 'sequential',
  agents: [
    {
      label: 'Driver',
      model: WAGGLE_INHERIT_MODEL,
      roleDescription: 'Moves the work forward.',
      color: 'blue',
    },
    {
      label: 'Reviewer',
      model: WAGGLE_INHERIT_MODEL,
      roleDescription: 'Checks the result.',
      color: 'amber',
    },
  ],
  stop: {
    primary: 'consensus',
    maxTurnsSafety: 4,
  },
}
const buttonProps: ButtonProps = { children: 'Smoke' }
const turnDetails = createPiWaggleTurnDetails({
  runId: 'run-smoke',
  turnNumber: 0,
  agentIndex: 0,
  agentLabel: 'Driver',
  agentModel: WAGGLE_INHERIT_MODEL,
  agentColor: 'blue',
})

void manifest
void Button(buttonProps)
void startWaggleRun({ config, sessionId: 'session-smoke' })
void BUILT_IN_WAGGLE_PRESETS
void OPENWAGGLE_EXTENSION.MANIFEST_FILE
void openWaggleExtensionClassName('ow-extension', 'smoke')
void defaultPiWaggleExtension
void PI_WAGGLE_TURN_CUSTOM_TYPE
void turnDetails
