import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResourceSummarySection } from '../SessionSummarySections'

const OUTPUT: SessionResource = {
  id: 'output-one',
  sessionId: SessionId('session-one'),
  canonicalKey: 'file:/output-one.txt',
  kind: 'file',
  title: 'output-one.txt',
  mimeType: 'text/plain',
  locator: '/output-one.txt',
  managed: false,
  available: true,
  isSource: false,
  isOutput: true,
  occurrences: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('ResourceSummarySection', () => {
  it('opens the complete Outputs browser while keeping the Summary preview bounded', () => {
    const onOpenResources = vi.fn()
    render(
      <ResourceSummarySection
        input={{
          title: 'Outputs',
          resources: [OUTPUT],
          count: 75,
          expanded: true,
          onExpandedChange: () => {},
          onOpenResources,
          onOpenImage: () => {},
        }}
      />,
    )

    expect(screen.getByText('75')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(onOpenResources).toHaveBeenCalledWith({ view: 'outputs' })
  })
})
