import type { SessionTreeRowGeometry } from '../model/session-tree-row';
interface SessionTreeConnectorOverlayProps {
    readonly geometry: SessionTreeRowGeometry;
    readonly active: boolean;
}
export declare function SessionTreeConnectorOverlay({ geometry, active, }: SessionTreeConnectorOverlayProps): import("node_modules/@types/react").JSX.Element;
export {};
