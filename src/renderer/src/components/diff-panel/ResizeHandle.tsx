import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

interface ResizeHandleProps {
  onResize: (delta: number) => void
  onResizeEnd: () => void
}

export function ResizeHandle({ onResize, onResizeEnd }: ResizeHandleProps): React.JSX.Element {
  const isDragging = useRef(false)
  const lastX = useRef(0)
  const onResizeRef = useRef(onResize)
  const onResizeEndRef = useRef(onResizeEnd)

  useEffect(() => {
    onResizeRef.current = onResize
    onResizeEndRef.current = onResizeEnd
  }, [onResize, onResizeEnd])

  useEffect(() => {
    function handleMouseMove(e: MouseEvent): void {
      if (!isDragging.current) return
      e.preventDefault()
      // Negative delta = dragging left = panel grows
      const delta = lastX.current - e.clientX
      lastX.current = e.clientX
      onResizeRef.current(delta)
    }

    function handleMouseUp(): void {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onResizeEndRef.current()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  function handleMouseDown(e: React.MouseEvent): void {
    e.preventDefault()
    isDragging.current = true
    lastX.current = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <hr
      aria-orientation="vertical"
      onMouseDown={handleMouseDown}
      className={cn(
        'shrink-0 w-1 h-auto border-none cursor-col-resize bg-border',
        'hover:bg-accent/40 active:bg-accent/60',
        'transition-colors duration-100',
      )}
    />
  )
}
