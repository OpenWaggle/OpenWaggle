import http from 'node:http'
import { LOOPBACK_HOST, listenOnLoopback } from './website-screenshot-loopback'

/** A small, self-contained product dashboard for the Browser preview screenshot. */
const JOTTER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Jotter · Overview</title>
<style>
  :root { color-scheme: light; --ink: #1f2a24; --muted: #5d6b63; --line: #dfe5df; --brand: #2f5d46; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: #f6f7f3; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 20px 32px; background: #fff; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 700; }
  .logo { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--brand); color: #fff; font-weight: 700; }
  header span { color: var(--muted); font-size: 13px; }
  main { padding: 36px 32px; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 8px 0 6px; font-size: 30px; letter-spacing: -.02em; }
  .lede { margin: 0 0 28px; color: var(--muted); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 36px; }
  .stat { padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
  .stat b { display: block; margin: 8px 0 2px; font-size: 30px; }
  .stat small { color: var(--muted); }
  .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  h2 { margin: 0; font-size: 18px; }
  button { padding: 8px 14px; border: 0; border-radius: 8px; background: var(--brand); color: #fff; font: inherit; font-weight: 600; }
  .project { margin-bottom: 14px; padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
  .project p { margin: 4px 0 16px; color: var(--muted); font-size: 14px; }
  .badge { padding: 2px 8px; border-radius: 999px; background: #eef2ec; color: var(--brand); font-size: 12px; }
  .bar { height: 6px; border-radius: 3px; background: #e7ebe5; }
  .bar i { display: block; height: 100%; border-radius: 3px; background: #7d9c86; }
  .meta { display: flex; justify-content: space-between; margin-top: 10px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header><div class="brand"><div class="logo">j</div>Jotter</div><span>Product workspace</span></header>
<main>
  <p class="eyebrow">Your workspace, at a glance</p>
  <h1>A little progress, every day.</h1>
  <p class="lede">Keep your team focused on the work that matters.</p>
  <section class="stats">
    <div class="stat"><span class="eyebrow">In progress</span><b>8</b><small>across 3 projects</small></div>
    <div class="stat"><span class="eyebrow">Completed</span><b>24</b><small>this month</small></div>
    <div class="stat"><span class="eyebrow">Team members</span><b>6</b><small>working together</small></div>
  </section>
  <div class="row"><h2>Active projects</h2><button>+ New project</button></div>
  <article class="project">
    <div class="row"><h2>Website refresh</h2><span class="badge">On track</span></div>
    <p>A clearer home for our product and documentation.</p>
    <div class="bar"><i style="width: 75%"></i></div>
    <div class="meta"><span>AL · MK</span><span>9 of 12 tasks complete</span></div>
  </article>
  <article class="project">
    <div class="row"><h2>Account settings</h2><span class="badge">In progress</span></div>
    <p>Make the everyday details easier to manage.</p>
    <div class="bar"><i style="width: 40%"></i></div>
    <div class="meta"><span>JS · AL</span><span>4 of 10 tasks complete</span></div>
  </article>
</main>
</body>
</html>
`

const HTTP_OK = 200
/**
 * The port the Browser preview images show, so a re-run does not rewrite them for a new port.
 * Below the ephemeral range and away from common dev servers; when it is taken, any free port.
 */
const PREFERRED_PORT = 47_318
const ANY_FREE_PORT = 0

export interface FixtureSite {
  readonly url: string
  readonly close: () => Promise<void>
}

function isAddressInUse(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}

/** Serves the dashboard on a loopback port for as long as the capture needs it. */
export async function startFixtureSite() {
  const server = http.createServer((_request, response) => {
    response.writeHead(HTTP_OK, { 'content-type': 'text/html; charset=utf-8' })
    response.end(JOTTER_PAGE)
  })
  let port: number
  try {
    port = await listenOnLoopback(server, PREFERRED_PORT)
  } catch (error) {
    if (!isAddressInUse(error)) throw error
    console.warn(
      `[website-shots] port ${String(PREFERRED_PORT)} is taken; the Browser preview images will show another port`,
    )
    port = await listenOnLoopback(server, ANY_FREE_PORT)
  }
  return {
    url: `http://${LOOPBACK_HOST}:${String(port)}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        // The preview keeps its connection alive; the next capture needs the port back.
        server.closeAllConnections()
      }),
  }
}
