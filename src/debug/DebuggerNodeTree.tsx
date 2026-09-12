import { FileText } from 'lucide-react'
import { displayValue, type EffectiveNode } from '@/model'
import { cn } from '@/lib/cn'

// ── Tree display helpers ──────────────────────────────────────────────────────

export interface CardItem {
  label:         string
  depth:         number
  fields:        Record<string, unknown>
  instanceCount: number
}

export function flattenForDisplay(node: EffectiveNode, depth = 0, pathParts: string[] = []): CardItem[] {
  const label = pathParts.length === 0 ? 'root' : pathParts.join(' › ')
  const items: CardItem[] = [{ label, depth, fields: node.fields, instanceCount: node.instances.length }]
  node.instances.forEach((child, i) =>
    items.push(...flattenForDisplay(child, depth + 1, [...pathParts, `instances[${i}]`])),
  )
  return items
}

const DEPTH_COLOURS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
const depthColour   = (d: number) => DEPTH_COLOURS[d % DEPTH_COLOURS.length]

export function NodeCard({ item, isLast }: { item: CardItem; isLast: boolean }) {
  const { label, depth, fields, instanceCount } = item
  const entries = Object.entries(fields)
  const indent  = depth * 20

  return (
    <div className="flex items-start" style={{ paddingLeft: `${indent}px` }}>
      {depth > 0 && (
        <div className="flex flex-col items-center mr-2 shrink-0" style={{ width: 16 }}>
          <div className={cn('w-px bg-white/10', isLast ? 'h-4' : 'flex-1')} style={{ minHeight: 16 }} />
          <div className="w-2 h-px bg-white/10" />
        </div>
      )}
      <div className="flex-1 rounded-lg border border-white/10 bg-white/5 overflow-hidden mb-2">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5">
          <span className={cn('w-1.5 h-4 rounded-full shrink-0', depthColour(depth))} />
          <FileText size={13} className="text-white/40 shrink-0" />
          <span className="font-mono text-xs text-white/90 font-medium">{label}</span>
          {depth === 0 && <span className="text-2xs text-white/20 font-mono ml-1">root</span>}
          <span className="ml-auto text-2xs text-white/25 font-mono">depth {depth}</span>
          {instanceCount > 0 && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
              {instanceCount} {instanceCount === 1 ? 'child' : 'children'}
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-white/30 italic">no fields</div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 px-3 py-1.5 text-xs font-mono">
                <span className="text-sky-300 shrink-0 w-28 truncate" title={key}>{key}</span>
                <span className="text-white/80 flex-1 whitespace-pre-wrap break-all" title={JSON.stringify(value)}>
                  {displayValue(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
