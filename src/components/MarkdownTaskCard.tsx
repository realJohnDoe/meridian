import { CircleFadingArrowUp } from 'lucide-react'
import { Checkbox } from './ui/checkbox'
import { Card } from './ui/card'
import { IconButton } from './ui/icon-button'

interface MarkdownTaskCardProps {
  text:          string
  done:          boolean
  onToggle:      () => void
  onPromote:     () => void
  // Inline editing — when editValue is provided the text becomes an input
  onClickText?:  () => void
  editValue?:    string
  onEditChange?: (value: string) => void
  onEditCommit?: () => void
  onEditCancel?: () => void
}

export default function MarkdownTaskCard({
  text, done, onToggle, onPromote,
  onClickText, editValue, onEditChange, onEditCommit, onEditCancel,
}: MarkdownTaskCardProps) {
  const isEditing = editValue !== undefined

  return (
    <Card className="flex items-stretch gap-2.5 pl-2 pr-2.5 py-2 shadow-none bg-card border border-input rounded-lg transition-colors hover:bg-accent">
      <span className="w-1 self-stretch rounded-full shrink-0 min-h-5 bg-muted-foreground/20" />
      <div className="flex flex-1 min-w-0 items-center gap-1.5 py-0.5">
        <Checkbox
          checked={done}
          onCheckedChange={onToggle}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
        {isEditing ? (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opens in response to a user click (promote to inline edit), not on page load
            autoFocus
            className="flex-1 text-sm font-medium bg-transparent border-none outline-none"
            value={editValue}
            onChange={e => onEditChange?.(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={e => {
              if (e.key === 'Enter')  { e.preventDefault(); onEditCommit?.() }
              if (e.key === 'Escape') { onEditCancel?.() }
            }}
          />
        ) : onClickText ? (
          <button
            type="button"
            className={`flex-1 min-w-0 text-left text-sm font-medium truncate cursor-pointer ${done ? 'line-through opacity-60' : 'text-foreground'}`}
            onClick={onClickText}
          >
            {text}
          </button>
        ) : (
          <span className={`flex-1 text-sm font-medium truncate ${done ? 'line-through opacity-60' : 'text-foreground'}`}>
            {text}
          </span>
        )}
        <IconButton
          label="Convert to item"
          title="Convert to item"
          className="text-muted-foreground hover:text-foreground"
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onPromote() }}
        >
          <CircleFadingArrowUp size={15} />
        </IconButton>
      </div>
    </Card>
  )
}
