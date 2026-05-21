import { SESSION_TREE } from '../constants/session-tree'
import type { SessionTreeRowGeometry } from '../model/session-tree-row'

interface SessionTreeConnectorOverlayProps {
  readonly geometry: SessionTreeRowGeometry
  readonly active: boolean
}

export function SessionTreeConnectorOverlay({
  geometry,
  active,
}: SessionTreeConnectorOverlayProps) {
  const connectorStroke = active
    ? SESSION_TREE.LAYOUT.CONNECTOR_ACTIVE_STROKE
    : SESSION_TREE.LAYOUT.CONNECTOR_MUTED_STROKE
  const connectorFilter = active ? SESSION_TREE.LAYOUT.CONNECTOR_ACTIVE_FILTER : undefined

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={geometry.gutterWidthPx}
      height={geometry.rowHeightPx}
      viewBox={`0 0 ${geometry.gutterWidthPx} ${geometry.rowHeightPx}`}
    >
      {geometry.ancestorLines.map((line) => (
        <line
          key={`${line.xPx}:${line.yStartPx}:${line.yEndPx}`}
          x1={line.xPx}
          y1={line.yStartPx}
          x2={line.xPx}
          y2={line.yEndPx}
          stroke={SESSION_TREE.LAYOUT.CONNECTOR_ANCESTOR_STROKE}
          strokeLinecap="round"
          strokeWidth={SESSION_TREE.LAYOUT.CONNECTOR_STROKE_WIDTH_PX}
        />
      ))}
      {geometry.parentStemBottom ? (
        <line
          x1={geometry.parentStemBottom.xPx}
          y1={geometry.parentStemBottom.yStartPx}
          x2={geometry.parentStemBottom.xPx}
          y2={geometry.parentStemBottom.yEndPx}
          stroke={SESSION_TREE.LAYOUT.CONNECTOR_ANCESTOR_STROKE}
          strokeLinecap="round"
          strokeWidth={SESSION_TREE.LAYOUT.CONNECTOR_STROKE_WIDTH_PX}
        />
      ) : null}
      {geometry.branchElbow ? (
        <path
          d={`M ${geometry.branchElbow.parentCenterXPx} ${geometry.branchElbow.yStartPx} V ${geometry.branchElbow.yMidPx} H ${geometry.branchElbow.targetCenterXPx}`}
          fill="none"
          stroke={connectorStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={SESSION_TREE.LAYOUT.CONNECTOR_STROKE_WIDTH_PX}
          style={{ filter: connectorFilter }}
        />
      ) : null}
      {geometry.nodeStemTop ? (
        <line
          x1={geometry.nodeStemTop.xPx}
          y1={geometry.nodeStemTop.yStartPx}
          x2={geometry.nodeStemTop.xPx}
          y2={geometry.nodeStemTop.yEndPx}
          stroke={connectorStroke}
          strokeLinecap="round"
          strokeWidth={SESSION_TREE.LAYOUT.CONNECTOR_STROKE_WIDTH_PX}
          style={{ filter: connectorFilter }}
        />
      ) : null}
      {geometry.nodeStemBottom ? (
        <line
          x1={geometry.nodeStemBottom.xPx}
          y1={geometry.nodeStemBottom.yStartPx}
          x2={geometry.nodeStemBottom.xPx}
          y2={geometry.nodeStemBottom.yEndPx}
          stroke={connectorStroke}
          strokeLinecap="round"
          strokeWidth={SESSION_TREE.LAYOUT.CONNECTOR_STROKE_WIDTH_PX}
          style={{ filter: connectorFilter }}
        />
      ) : null}
    </svg>
  )
}
