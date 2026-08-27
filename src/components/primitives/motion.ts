/**
 * The one clock every list transition runs on.
 *
 * A row leaving a list is two motions that have to agree: the row collapsing
 * shut (a CSS transition, see collapse-row.tsx) and its siblings gliding into
 * the space it frees (a Web Animations FLIP, see FlipList.tsx). Give them
 * separate constants and they drift the moment one is tuned without the other,
 * so both read these.
 */
export const MOTION_MS = 350
export const MOTION_EASE = 'cubic-bezier(.4,0,.2,1)'
