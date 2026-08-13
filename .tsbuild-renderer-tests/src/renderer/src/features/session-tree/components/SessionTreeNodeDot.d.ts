import type { SessionTreeRow, SessionTreeRowGeometry } from '../model/session-tree-row';
interface SessionTreeNodeDotProps {
    readonly expanded: boolean;
    readonly geometry: SessionTreeRowGeometry;
    readonly highlighted: boolean;
    readonly row: SessionTreeRow;
    readonly onFocus: () => void;
    readonly onToggle: () => void;
}
export declare function SessionTreeNodeDot({ expanded, geometry, highlighted, row, onFocus, onToggle, }: SessionTreeNodeDotProps): import("node_modules/@types/react").JSX.Element;
export {};
