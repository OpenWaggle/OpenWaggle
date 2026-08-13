import { jsx as _jsx } from "react/jsx-runtime";
import { useParams } from '@tanstack/react-router';
import { ExtensionRouteSurface } from './ExtensionRouteSurface';
export function ExtensionRouteView() {
    const { extensionId, _splat } = useParams({ from: '/extensions/$extensionId/$' });
    return _jsx(ExtensionRouteSurface, { extensionId: extensionId, routeId: _splat ?? '' });
}
