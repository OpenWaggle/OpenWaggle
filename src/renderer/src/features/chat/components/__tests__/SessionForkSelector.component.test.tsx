import { SessionNodeId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SessionForkSelector } from '../SessionForkSelector'

const targets = [
  { entryId: SessionNodeId('2d57a780-7764-4716-8627-2fcfd80b4fa0'), text: 'Q: fresh' },
  { entryId: SessionNodeId('7c3c9401-73ad-4b60-a7f7-db4212d6d491'), text: 'Q: first' },
]

it('lists each fork point by its message and place, never by its node id', () => {
  const onSelect = vi.fn()
  render(<SessionForkSelector open targets={targets} onSelect={onSelect} onClose={vi.fn()} />)

  expect(screen.queryByText(String(targets[0]?.entryId))).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Message 2: Q: fresh' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Message 1: Q: first' }))

  expect(onSelect).toHaveBeenCalledWith(targets[1])
})
