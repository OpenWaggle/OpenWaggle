/** A value Electrobun reads from or writes to JSON (vendor/electrobun/api-types.ts). */
export type ElectrobunJsonValue = null | boolean | number | string | readonly ElectrobunJsonValue[] | ElectrobunJsonObject;
export interface ElectrobunJsonObject {
    readonly [key: string]: ElectrobunJsonValue;
}
