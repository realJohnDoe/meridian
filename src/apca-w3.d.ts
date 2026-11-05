declare module 'apca-w3' {
  export function APCAcontrast(txtY: number, bgY: number, places?: number): number | string
  export function sRGBtoY(rgb: number[]): number
}
