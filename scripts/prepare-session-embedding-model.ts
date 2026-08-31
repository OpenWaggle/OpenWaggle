import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { fetch } from 'undici'
import {
  SESSION_EMBEDDING_MODEL,
  SESSION_EMBEDDING_MODEL_FILES,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from '../src/main/adapters/multilingual-e5-session-embedding-model'

const HTTP_SUCCESS_MINIMUM = 200
const HTTP_SUCCESS_MAXIMUM = 300
const JSON_INDENT_SPACES = 2
const MODEL_HOST = 'https://huggingface.co'
const MODEL_SOURCE = 'intfloat/multilingual-e5-small'
const MODEL_SOURCE_REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
const MODEL_DIRECTORY = path.join(
  'build',
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
  SESSION_EMBEDDING_MODEL.id,
)
const TRANSFORMERS_CACHE_DIRECTORY = path.join(
  'node_modules',
  '@huggingface',
  'transformers',
  '.cache',
  SESSION_EMBEDDING_MODEL.id,
  SESSION_EMBEDDING_MODEL.revision,
)

const MODEL_NOTICE = `# Session embedding model notice

OpenWaggle bundles the Q8 ONNX conversion of \`${SESSION_EMBEDDING_MODEL.id}\` at revision
\`${SESSION_EMBEDDING_MODEL.revision}\` for offline session discovery.

The conversion is based on \`${MODEL_SOURCE}\`. Its model card declares the MIT license at
revision \`${MODEL_SOURCE_REVISION}\`. The model authors and contributors retain their copyright.

Sources:

- ${MODEL_HOST}/${SESSION_EMBEDDING_MODEL.id}/tree/${SESSION_EMBEDDING_MODEL.revision}
- ${MODEL_HOST}/${MODEL_SOURCE}/tree/${MODEL_SOURCE_REVISION}

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files, to deal in the Software without restriction, including without
limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject
to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`

async function fileSha256(filePath: string) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function hasExpectedHash(filePath: string, expectedHash: string) {
  try {
    return (await fileSha256(filePath)) === expectedHash
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function copyCachedFileIfValid(
  relativePath: string,
  expectedHash: string,
  destinationPath: string,
) {
  const cachedPath = path.join(TRANSFORMERS_CACHE_DIRECTORY, relativePath)
  if (!(await hasExpectedHash(cachedPath, expectedHash))) return false

  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.copyFile(cachedPath, destinationPath)
  return true
}

async function downloadVerifiedFile(
  relativePath: string,
  expectedHash: string,
  destinationPath: string,
) {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/')
  const url = `${MODEL_HOST}/${SESSION_EMBEDDING_MODEL.id}/resolve/${SESSION_EMBEDDING_MODEL.revision}/${encodedPath}`
  const temporaryPath = `${destinationPath}.${randomUUID()}.download`
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })

  try {
    const response = await fetch(url)
    if (response.status < HTTP_SUCCESS_MINIMUM || response.status >= HTTP_SUCCESS_MAXIMUM) {
      throw new Error(`Model download failed with HTTP ${String(response.status)} for ${url}.`)
    }
    if (response.body === null) {
      throw new Error(`Model download returned no body for ${url}.`)
    }
    await pipeline(
      response.body,
      await fs.open(temporaryPath, 'w').then((file) => file.createWriteStream()),
    )
    const actualHash = await fileSha256(temporaryPath)
    if (actualHash !== expectedHash) {
      throw new Error(
        `Model file ${relativePath} failed integrity verification. Expected ${expectedHash}, received ${actualHash}.`,
      )
    }
    await fs.rm(destinationPath, { force: true })
    await fs.rename(temporaryPath, destinationPath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

async function prepareModelFile(relativePath: string, expectedHash: string) {
  const destinationPath = path.join(MODEL_DIRECTORY, relativePath)
  if (await hasExpectedHash(destinationPath, expectedHash)) return 'ready'
  if (await copyCachedFileIfValid(relativePath, expectedHash, destinationPath)) return 'copied'
  await downloadVerifiedFile(relativePath, expectedHash, destinationPath)
  return 'downloaded'
}

export async function prepareSessionEmbeddingModel() {
  const results = []
  for (const file of SESSION_EMBEDDING_MODEL_FILES) {
    results.push({ path: file.path, status: await prepareModelFile(file.path, file.sha256) })
  }

  const manifest = {
    model: SESSION_EMBEDDING_MODEL,
    source: {
      id: MODEL_SOURCE,
      revision: MODEL_SOURCE_REVISION,
      license: 'MIT',
    },
    files: SESSION_EMBEDDING_MODEL_FILES,
  }
  await fs.writeFile(
    path.join(MODEL_DIRECTORY, 'openwaggle-model-manifest.json'),
    `${JSON.stringify(manifest, null, JSON_INDENT_SPACES)}\n`,
  )
  await fs.writeFile(path.join(MODEL_DIRECTORY, 'THIRD_PARTY_NOTICE.md'), MODEL_NOTICE)
  return results
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareSessionEmbeddingModel()
    .then((results) => {
      process.stdout.write(`${JSON.stringify(results, null, JSON_INDENT_SPACES)}\n`)
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
      process.exitCode = 1
    })
}
