/**
 * Appearance settings.
 *
 * The Syntax theme sits deliberately outside the Design token contract (ADR 0013
 * amendment): it colours language grammar scopes, not semantic roles, which is
 * why it is user-selectable on its own while the diff chrome follows the app's
 * Appearance. The colour-blind-safe variants are the main reason this is a real
 * setting rather than a constant.
 */
export declare function AppearanceSection(): import("node_modules/@types/react").JSX.Element;
