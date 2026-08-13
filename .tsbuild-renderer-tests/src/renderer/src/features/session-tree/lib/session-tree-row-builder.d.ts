import type { SessionNodeId } from '@shared/types/brand';
import type { SessionNode } from '@shared/types/session';
import type { BuildSessionTreeRowsInput, SessionTreeRow } from '../model';
export declare function getVisibleSessionTreeRows(input: BuildSessionTreeRowsInput): readonly SessionTreeRow[];
export declare function getVisibleSessionTreeNodes(nodes: readonly SessionNode[], expandedNodeIds: readonly SessionNodeId[]): readonly SessionNode[];
