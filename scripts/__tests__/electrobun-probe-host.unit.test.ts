import { describe, expect, it } from 'vitest'
import { treeRss } from '../electrobun-probe-host'

describe('treeRss', () => {
  it('sums a process and all of its descendants, and nothing else', () => {
    const rows = [
      { pid: 10, ppid: 1, rssBytes: 100 },
      { pid: 11, ppid: 10, rssBytes: 20 },
      { pid: 12, ppid: 11, rssBytes: 3 },
      { pid: 20, ppid: 1, rssBytes: 5000 },
    ]
    expect(treeRss(rows, 10)).toEqual({ bytes: 123, processes: 3 })
  })

  it('reports an exited root as empty', () => {
    expect(treeRss([{ pid: 20, ppid: 1, rssBytes: 5 }], 10)).toEqual({ bytes: 0, processes: 1 })
  })
})
