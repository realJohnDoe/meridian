// The old origin's last `sw.js`; see retireWorker.ts. Built as a classic
// script with no imports or exports left (vite.teardown.config.ts), since the
// registration it replaces was made as one.
import { retireWorker, type RetiringWorker } from './retireWorker'

const sw = self as unknown as RetiringWorker & EventTarget & { skipWaiting(): Promise<void> }
sw.addEventListener('install', () => { void sw.skipWaiting() })
sw.addEventListener('activate', e => { (e as Event & { waitUntil(p: Promise<unknown>): void }).waitUntil(retireWorker(sw)) })
