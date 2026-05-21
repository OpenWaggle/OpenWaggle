import { SESSION_TREE } from '../constants'
import type { SessionTreeRow, SessionTreeRowGeometry, SessionTreeVerticalConnector } from '../model'

function nodeCenterXPx(depth: number) {
  return SESSION_TREE.LAYOUT.GUTTER_START_PX + depth * SESSION_TREE.LAYOUT.DEPTH_STEP_PX
}

function verticalConnector(input: SessionTreeVerticalConnector) {
  return input
}

function nodeStemTop(row: SessionTreeRow, nodeCenter: number) {
  if (row.parentVisualDepth !== row.visualDepth) {
    return null
  }

  return verticalConnector({
    xPx: nodeCenter,
    yStartPx: -SESSION_TREE.LAYOUT.CONNECTOR_ROW_OVERLAP_PX,
    yEndPx: SESSION_TREE.LAYOUT.ROW_CENTER_Y_PX,
  })
}

function nodeStemBottom(row: SessionTreeRow, nodeCenter: number) {
  const linearSiblingContinuation =
    row.hasNextSibling &&
    (row.parentVisualDepth === row.visualDepth || row.parentVisualDepth === null)

  if (!row.hasDisplayedChildren && !linearSiblingContinuation) {
    return null
  }

  return verticalConnector({
    xPx: nodeCenter,
    yStartPx: SESSION_TREE.LAYOUT.ROW_CENTER_Y_PX,
    yEndPx: SESSION_TREE.LAYOUT.ROW_HEIGHT_PX + SESSION_TREE.LAYOUT.CONNECTOR_ROW_OVERLAP_PX,
  })
}

function parentStemBottom(row: SessionTreeRow, nodeCenter: number, parentCenter: number | null) {
  if (!row.hasNextSibling || parentCenter === null || parentCenter === nodeCenter) {
    return null
  }

  return verticalConnector({
    xPx: parentCenter,
    yStartPx: SESSION_TREE.LAYOUT.ROW_CENTER_Y_PX,
    yEndPx: SESSION_TREE.LAYOUT.ROW_HEIGHT_PX + SESSION_TREE.LAYOUT.CONNECTOR_ROW_OVERLAP_PX,
  })
}

function branchElbow(nodeCenter: number, parentCenter: number | null) {
  if (parentCenter === null || parentCenter === nodeCenter) {
    return null
  }

  return {
    parentCenterXPx: parentCenter,
    targetCenterXPx: nodeCenter,
    yStartPx: -SESSION_TREE.LAYOUT.CONNECTOR_ROW_OVERLAP_PX,
    yMidPx: SESSION_TREE.LAYOUT.ROW_CENTER_Y_PX,
  }
}

export function getSessionTreeRowGeometry(row: SessionTreeRow): SessionTreeRowGeometry {
  const nodeCenter = nodeCenterXPx(row.visualDepth)
  const parentCenter = row.parentVisualDepth === null ? null : nodeCenterXPx(row.parentVisualDepth)
  const ancestorLines = row.gutterDepths
    .filter((depth) => depth !== row.visualDepth)
    .map((depth) =>
      verticalConnector({
        xPx: nodeCenterXPx(depth),
        yStartPx: -SESSION_TREE.LAYOUT.CONNECTOR_ROW_OVERLAP_PX,
        yEndPx: SESSION_TREE.LAYOUT.ROW_HEIGHT_PX + SESSION_TREE.LAYOUT.CONNECTOR_ROW_OVERLAP_PX,
      }),
    )

  return {
    gutterWidthPx: nodeCenter + SESSION_TREE.LAYOUT.GUTTER_END_PADDING_PX,
    rowHeightPx: SESSION_TREE.LAYOUT.ROW_HEIGHT_PX,
    rowCenterYPx: SESSION_TREE.LAYOUT.ROW_CENTER_Y_PX,
    nodeCenterXPx: nodeCenter,
    parentCenterXPx: parentCenter,
    ancestorLines,
    nodeStemTop: nodeStemTop(row, nodeCenter),
    nodeStemBottom: nodeStemBottom(row, nodeCenter),
    parentStemBottom: parentStemBottom(row, nodeCenter, parentCenter),
    branchElbow: branchElbow(nodeCenter, parentCenter),
  }
}
