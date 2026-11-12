import { type Env, env } from './env'
import type { UpdateFeedEngine, UpdateFeedSelection } from './update-feed'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

type AutomationUpdateEnvironment = Pick<
  Env,
  'OPENWAGGLE_AUTOMATION' | 'OPENWAGGLE_AUTOMATION_UPDATE_FEED'
>

/**
 * The release directory CI's update proof serves (.github/workflows/electrobun-package.yml), which
 * the updater reads instead of the GitHub release its channel would pick. Only under automation
 * (`OPENWAGGLE_AUTOMATION=1`) and only over loopback HTTP, so the shipped app updates from GitHub
 * alone and a link or setting can never point it elsewhere.
 */
export function automationUpdateReleaseUrl(
  environment: AutomationUpdateEnvironment = env,
): string | null {
  const value = environment.OPENWAGGLE_AUTOMATION_UPDATE_FEED
  if (environment.OPENWAGGLE_AUTOMATION !== '1' || value === undefined) return null
  const url = new URL(value)
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(url.hostname)) return null
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return null
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

/**
 * Whether the desktop app starts its updater. Automation runs stay off GitHub's releases, except
 * one given a loopback release directory: without the started updater a check would not know the
 * Update channel (a Beta build would refuse its own Beta release) and stay idle.
 */
export function startsGuiAutoUpdater(
  automationMode: boolean,
  environment: AutomationUpdateEnvironment = env,
) {
  return !automationMode || automationUpdateReleaseUrl(environment) !== null
}

/** Points the engine at the automation release directory, as `configureUpdaterFeed` does a release. */
export function configureAutomationUpdateFeed(
  engine: Pick<UpdateFeedEngine, 'setFeed'>,
  releaseUrl: string,
): Promise<UpdateFeedSelection> {
  engine.setFeed({ releaseUrl })
  return Promise.resolve({ type: 'release', tag: releaseUrl })
}
