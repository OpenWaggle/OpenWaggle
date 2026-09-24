// Throwaway prototype server. Serves only this study, without Electron or project access.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const root = new URL('./', import.meta.url)
const files = new Map([
  ['/', ['index.html', 'text/html']],
])
const port = 4318
createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const file = files.get(pathname)
  if (!file) { response.writeHead(404).end('Not found'); return }
  const [name, mime] = file
  if (!name || !mime) { response.writeHead(404).end(); return }
  const source = await readFile(new URL(name, root), 'utf8')
  response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(source)
}).listen(port, '127.0.0.1', () => {
  console.log(`Project Actions prototype: http://127.0.0.1:${port}/`)
  console.log('Session hub, run sidebar, project settings and action creation. All state is simulated.')
})
