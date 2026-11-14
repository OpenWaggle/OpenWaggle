import type { CommandLine } from 'electron'

type FeatureSwitch = 'enable-features' | 'disable-features'

/**
 * Adds `feature` to Chromium's `--enable-features` or `--disable-features` list. A second
 * `appendSwitch` of the same name replaces the value, so this keeps every feature the command line
 * (or an earlier call) already names.
 */
export function addChromiumFeature(
  commandLine: Pick<CommandLine, 'appendSwitch' | 'getSwitchValue'>,
  name: FeatureSwitch,
  feature: string,
) {
  const features = commandLine
    .getSwitchValue(name)
    .split(',')
    .filter((entry) => entry !== '')
  if (features.includes(feature)) return
  commandLine.appendSwitch(name, [...features, feature].join(','))
}
