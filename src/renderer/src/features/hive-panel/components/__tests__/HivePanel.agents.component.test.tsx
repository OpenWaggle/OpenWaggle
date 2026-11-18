import type { SessionSummary } from '@shared/types/session'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSidebarSessionActions } from '@/features/sidebar/lib'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useHivePanelViewStore } from '../../state/hive-panel-view-store'

const listHiveTreeSessionCatalogPage = vi.hoisted(() => vi.fn())
const useNavigate = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { listHiveTreeSessionCatalogPage } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => useNavigate,
}))

import { HivePanel } from '../HivePanel'

import { hivePage, summary, workerLineage } from './hive-panel.test-utils'

function worker(id: string, agent?: Partial<SessionSummary['lineage']>) {
  return summary(id, {
    lineage: { ...workerLineage, delegationState: 'working', ...agent },
  })
}

const reviewer = {
  agentDefinitionName: 'reviewer',
  agentModelId: 'spark/GLM-5.3-Flash-EXL3',
  agentThinkingLevel: 'high' as const,
}

async function renderHive(members: readonly SessionSummary[]) {
  listHiveTreeSessionCatalogPage.mockResolvedValue(hivePage(members))
  renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)
  await screen.findByRole('treeitem', { name: /Session: queen\b/u })
}

function treeItem(name: string) {
  return screen.getByRole('treeitem', { name: new RegExp(`Session: ${name}\\b`, 'u') })
}

describe('HivePanel Agent definitions (identity line)', () => {
  beforeEach(() => {
    listHiveTreeSessionCatalogPage.mockReset()
    useNavigate.mockReset().mockResolvedValue(undefined)
    registerSidebarSessionActions(null)
    useHivePanelViewStore.setState({ view: 'tree', showArchived: false, collapsed: {} })
  })

  it('names the definition, thinking level, and model under a Worker created from one', async () => {
    await renderHive([worker('review-1', reviewer), worker('implementer')])

    const row = treeItem('review-1')
    expect(row).toHaveAccessibleName(
      expect.stringMatching(
        /^Open Worker Session: review-1, spawned by queen, agent reviewer, thinking High, model spark\/GLM-5\.3-Flash-EXL3/u,
      ),
    )
    const identity = row.querySelector('[data-hive-agent="reviewer"]')
    expect(identity).toHaveTextContent('reviewer · High · GLM-5.3-Flash-EXL3')
    expect(identity).toHaveAttribute(
      'title',
      'Agent definition: reviewer · thinking High · model spark/GLM-5.3-Flash-EXL3',
    )
    expect(row.querySelector('[data-agent-glyph="true"]')).not.toBeNull()

    const plain = treeItem('implementer')
    expect(plain.querySelector('[data-hive-agent]')).toBeNull()
    expect(plain.querySelector('[data-agent-glyph]')).toBeNull()
    expect(plain).not.toHaveAccessibleName(expect.stringContaining('agent'))
  })

  it('names a thinking level as the composer does, and Off as no thinking', async () => {
    await renderHive([
      worker('review-1', { ...reviewer, agentThinkingLevel: 'xhigh' }),
      worker('review-2', { ...reviewer, agentThinkingLevel: 'off' }),
    ])

    expect(treeItem('review-1').querySelector('[data-hive-agent]')).toHaveTextContent(
      'reviewer · Extra High · GLM-5.3-Flash-EXL3',
    )
    const off = treeItem('review-2')
    expect(off.querySelector('[data-hive-agent]')).toHaveTextContent(
      'reviewer · No thinking · GLM-5.3-Flash-EXL3',
    )
    expect(off).toHaveAccessibleName(expect.stringContaining('agent reviewer, thinking Off'))
  })

  it('shows only the name when the profile carries no model or thinking level', async () => {
    await renderHive([worker('review-1', { agentDefinitionName: 'reviewer' })])

    const row = treeItem('review-1')
    expect(row.querySelector('[data-hive-agent]')).toHaveTextContent(/^reviewer$/u)
    expect(row).toHaveAccessibleName(
      expect.stringMatching(
        /^Open Worker Session: review-1, spawned by queen, agent reviewer, state /u,
      ),
    )
  })

  it('counts the Hive’s Workers per definition in the toolbar, most used first', async () => {
    await renderHive([
      worker('review-1', reviewer),
      worker('review-2', reviewer),
      worker('plan-1', { agentDefinitionName: 'planner' }),
      worker('implementer'),
    ])

    const summaryLine = document.querySelector('[data-hive-agent-summary]')
    expect(summaryLine).toHaveTextContent('reviewer ×2 · planner ×1')
    // A truncated summary still shows its whole text on hover.
    expect(screen.getByTitle('reviewer ×2 · planner ×1')).toBeInTheDocument()
    // Only the summary gives up width; the toggles keep one line beside a long one.
    for (const name of ['Show archived', 'By next actor']) {
      expect(screen.getByRole('button', { name })).toHaveClass('shrink-0', 'whitespace-nowrap')
    }
    expect(screen.getByText('Agent definitions in this Hive: reviewer ×2, planner ×1')).toHaveClass(
      'sr-only',
    )
  })

  it('shows no summary for a Hive without definitions', async () => {
    await renderHive([worker('implementer')])

    expect(document.querySelector('[data-hive-agent-summary]')).toBeNull()
  })

  it('keeps the identity line in the By next actor view', async () => {
    await renderHive([worker('review-1', reviewer)])

    fireEvent.click(screen.getByRole('button', { name: 'By next actor' }))

    const row = await screen.findByRole('button', { name: /Session: review-1, .*agent reviewer/u })
    expect(within(row).getByText('reviewer')).toHaveClass('text-info-text')
    expect(row.querySelector('[data-hive-agent="reviewer"]')).toHaveTextContent(
      'reviewer · High · GLM-5.3-Flash-EXL3',
    )
  })
})
