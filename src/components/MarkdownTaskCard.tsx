import { CircleFadingArrowUp } from 'lucide-react'
import { Checkbox } from './ui/checkbox'
import { Card } from './ui/card'
import { SurfaceButton } from './ui/surface-button'

interface MarkdownTaskCardProps {
  text: string
  done: boolean
  onToggle: () => void
  onPromote: () => void
}

export default function MarkdownTaskCard({ text, done, onToggle, onPromote }: MarkdownTaskCardProps) {
  return (
    <Card className="relative flex items-stretch gap-[9px] pl-[8px] pr-[10px] py-[8px] shadow-none bg-card border border-input rounded-lg transition-colors hover:bg-accent">
      <SurfaceButton className="absolute inset-0 z-[1] rounded-lg" aria-label={text} onClick={() => {}} />

      {/* Dim neutral bar — same geometry as OccurrenceCard's priority bar */}
      <span className="w-1 self-stretch rounded-full shrink-0 min-h-5 bg-muted-foreground/20 relative z-20" />

      <div className="relative z-20 flex flex-1 min-w-0 items-center gap-[6px] py-[2px] pointer-events-none">
        <Checkbox
          checked={done}
          onCheckedChange={() => onToggle()}
          className="size-5 shrink-0 pointer-events-auto"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
        <span className={`text-[14px] font-medium text-foreground truncate flex-1 ${done ? 'line-through opacity-60' : ''}`}>
          {text}
        </span>
        <button
          aria-label="Promote to task"
          title="Promote to task"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors pointer-events-auto"
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onPromote() }}
        >
          <CircleFadingArrowUp size={15} />
        </button>
      </div>
    </Card>
  )
}
