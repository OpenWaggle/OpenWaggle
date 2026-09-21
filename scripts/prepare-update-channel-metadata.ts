import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isMatching, P } from '@diegogbrisa/ts-match'
import type { BuildChannel } from '../src/shared/types/build-identity'
import { updaterFeedChannel, type UpdateChannel } from '../src/shared/types/update-channel'

type ReleasePlatform = 'mac' | 'linux' | 'windows'
type ReleaseFeedChannel = UpdateChannel | 'rc'

function releaseFeedChannel(channel: BuildChannel): ReleaseFeedChannel {
  if (channel === 'stable') return 'stable'
  if (channel === 'alpha') return 'alpha'
  if (channel === 'beta') return 'beta'
  if (channel === 'rc') return 'rc'
  throw new Error('Development builds do not publish update metadata.')
}

function eligibleChannels(channel: ReleaseFeedChannel): readonly ReleaseFeedChannel[] {
  if (channel === 'stable') return ['stable', 'beta', 'alpha']
  if (channel === 'beta') return ['beta', 'alpha']
  if (channel === 'rc') return ['rc']
  return ['alpha']
}

function metadataFilename(channel: ReleaseFeedChannel, platform: ReleasePlatform) {
  const suffix = platform === 'mac' ? '-mac' : platform === 'linux' ? '-linux' : ''
  const feedName = channel === 'rc' ? channel : updaterFeedChannel(channel)
  return `${feedName}${suffix}.yml`
}

export async function prepareUpdateChannelMetadata(input: {
  readonly directory: string
  readonly buildChannel: BuildChannel
  readonly platform: ReleasePlatform
}) {
  const releaseChannel = releaseFeedChannel(input.buildChannel)
  const sourceName = metadataFilename(releaseChannel, input.platform)
  const source = path.join(input.directory, sourceName)
  await fs.access(source)
  const written = [sourceName]
  for (const channel of eligibleChannels(releaseChannel)) {
    const targetName = metadataFilename(channel, input.platform)
    if (targetName === sourceName) continue
    await fs.copyFile(source, path.join(input.directory, targetName))
    written.push(targetName)
  }
  return written
}

async function main() {
  const [, , directory, buildChannel, platform] = process.argv
  if (!directory || !buildChannel || !platform) {
    throw new Error(
      'Usage: prepare-update-channel-metadata.ts <directory> <stable|rc|beta|alpha> <mac|linux|windows>',
    )
  }
  if (!isMatching(P.union('stable', 'rc', 'beta', 'alpha'), buildChannel)) {
    throw new Error(`Unsupported release build channel: ${buildChannel}.`)
  }
  if (!isMatching(P.union('mac', 'linux', 'windows'), platform)) {
    throw new Error(`Unsupported release platform: ${platform}.`)
  }
  await prepareUpdateChannelMetadata({
    directory: path.resolve(directory),
    buildChannel,
    platform,
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
