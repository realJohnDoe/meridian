/// <reference types="vite/client" />

/** Short commit SHA, injected by the `define` block in vite.config.ts. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Build-time override of the OAuth/iCal Worker origin; unset uses the deployed Worker. */
  readonly VITE_WORKER_ORIGIN?: string
}
