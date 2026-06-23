type EventMap = {
  'vault:changed': void
}

const listeners = new Map<keyof EventMap, Set<() => void>>()

export function on<K extends keyof EventMap>(event: K, fn: () => void): () => void {
  let set = listeners.get(event)
  if (!set) { set = new Set(); listeners.set(event, set) }
  set.add(fn)
  return () => set!.delete(fn)
}

export function emit<K extends keyof EventMap>(event: K): void {
  listeners.get(event)?.forEach(fn => fn())
}
