// Electrobun postBuild/postWrap hook. Hutch imports hook files instead of running them, so this
// entry applies the launch version at import time; the logic lives in scripts/ where it is tested.
import { applyLaunchVersion } from '../../../scripts/electrobun-macos-launch-version'

for (const bundle of await applyLaunchVersion(process.env)) {
  console.log(`LSMinimumSystemVersion set in ${bundle}`)
}
