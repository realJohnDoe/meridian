/// <reference types="vite/client" />

/** Short commit SHA, injected by the `define` block in vite.config.ts. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Build-time origin of the OAuth/iCal Worker; unset means the app's own origin. */
  readonly VITE_WORKER_ORIGIN?: string
}
