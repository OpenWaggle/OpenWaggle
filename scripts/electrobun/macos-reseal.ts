/**
 * Makes the macOS update archive carry the signed, stapled app. Hutch writes the app's final
 * `Contents/Resources/version.json` (content hash, base URL, name) after the postBuild hook signed
 * the app and before it packs `stable-macos-<arch>-*.tar.zst`, so the archive's app has a broken
 * resource seal (`codesign --verify`: "a sealed resource is missing or invalid"). Hutch has no hook
 * between the two, and its signing is off (ADR 0064: OpenWaggle signs `bun` as the app). So after
 * Hutch, on the bundle the postBuild hook kept:
 *
 * 1. copy Hutch's `version.json` in and re-seal the app bundle (the nested code is unchanged);
 * 2. notarize and staple it when Apple credentials are configured;
 * 3. repack the archive as Hutch packs it (ustar, zstd, the `.app` at the top) and record its
 *    SHA-256 and size in `update-v2.json`, which Electrobun's updater checks before it installs.
 *
 * The content hash stays Hutch's, so update detection is unchanged. Hutch's delta patches target
 * its own archive, which no install receives any more, so they are dropped on macOS: every macOS
 * update is a full download until patches are generated against the repacked archive.
 */
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { isRecord } from '../../src/shared/utils/validation'
import { notarizeMacos, notaryCredentials } from './notarize-macos'
import { ELECTROBUN_ENTITLEMENTS, signMacosApp } from './sign-macos'

const run = promisify(execFile)
const VERSION_JSON = ['Contents', 'Resources', 'version.json']
const ARCHIVE = /^stable-macos-(arm64|x64)-.+\.tar\.zst$/u
const PATCH = /^stable-macos-(arm64|x64)-.+\.patch$/u
const MANIFEST_V2 = /^stable-macos-(arm64|x64)-update-v2\.json$/u
const JSON_INDENT = 0

export interface ResealOptions {
  readonly app: string
  /** Where Hutch's archive and manifests were copied (package.ts, the release directory). */
  readonly release: string
  readonly bundleId: string
  readonly environment: NodeJS.ProcessEnv
}

function only(directory: string, pattern: RegExp) {
  const matches = fs.readdirSync(directory).filter((name) => pattern.test(name))
  const [match] = matches
  if (matches.length !== 1 || match === undefined) {
    throw new Error(`Expected one ${String(pattern)} in ${directory}, found ${matches.length}.`)
  }
  return path.join(directory, match)
}

/** Reads one entry of a `.tar.zst` without unpacking the rest. */
async function readArchiveEntry(archive: string, entry: string) {
  const tar = spawn('tar', ['-xOf', '-', entry], { stdio: ['pipe', 'pipe', 'inherit'] })
  const chunks: Buffer[] = []
  tar.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  const exited = new Promise<number | null>((resolve) => tar.on('close', resolve))
  await pipeline(fs.createReadStream(archive), zlib.createZstdDecompress(), tar.stdin)
  if ((await exited) !== 0) throw new Error(`tar could not read ${entry} from ${archive}.`)
  return Buffer.concat(chunks)
}

/** Packs `app` as Hutch does and returns the uncompressed tar's SHA-256 and size. */
async function packArchive(app: string, archive: string) {
  const tar = spawn(
    'tar',
    [
      '--format',
      'ustar',
      '--no-mac-metadata',
      '-cf',
      '-',
      '-C',
      path.dirname(app),
      path.basename(app),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, COPYFILE_DISABLE: '1' } },
  )
  const exited = new Promise<number | null>((resolve) => tar.on('close', resolve))
  const hash = createHash('sha256')
  let size = 0
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    },
  })
  const partial = `${archive}.partial`
  await pipeline(tar.stdout, measure, zlib.createZstdCompress(), fs.createWriteStream(partial))
  if ((await exited) !== 0) throw new Error(`tar could not pack ${app}.`)
  fs.renameSync(partial, archive)
  return { tarSha256: hash.digest('hex'), tarSize: size }
}

function recordArchive(manifestPath: string, archive: { tarSha256: string; tarSize: number }) {
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const artifact = isRecord(manifest) ? manifest['artifact'] : null
  if (!isRecord(manifest) || !isRecord(artifact)) {
    throw new Error(`${manifestPath} has no artifact entry.`)
  }
  const updated = { ...manifest, artifact: { ...artifact, ...archive } }
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, JSON_INDENT))
}

export async function resealMacosUpdate(options: ResealOptions) {
  const archive = only(options.release, ARCHIVE)
  const entry = [path.basename(options.app), ...VERSION_JSON].join('/')
  const versionJson = await readArchiveEntry(archive, entry)
  fs.writeFileSync(path.join(options.app, ...VERSION_JSON), versionJson)
  const configured = options.environment['OPENWAGGLE_MACOS_SIGN_IDENTITY'] ?? ''
  const identity = configured === '' ? '-' : configured
  const keychain = options.environment['OPENWAGGLE_MACOS_SIGN_KEYCHAIN'] ?? ''
  await signMacosApp({
    app: options.app,
    identity,
    bundleId: options.bundleId,
    entitlements: path.resolve(ELECTROBUN_ENTITLEMENTS),
    timestamp: identity !== '-' && options.environment['OPENWAGGLE_MACOS_SIGN_TIMESTAMP'] !== '0',
    sealOnly: true,
    ...(keychain === '' ? {} : { keychain }),
  })
  const credentials = identity === '-' ? null : notaryCredentials(options.environment)
  if (credentials !== null) await notarizeMacos(options.app, credentials)
  const packed = await packArchive(options.app, archive)
  recordArchive(only(options.release, MANIFEST_V2), packed)
  const dropped = fs.readdirSync(options.release).filter((name) => PATCH.test(name))
  for (const name of dropped) fs.rmSync(path.join(options.release, name))
  await run('codesign', ['--verify', '--deep', '--strict', options.app])
  return { archive: path.basename(archive), ...packed, notarized: credentials !== null, dropped }
}
