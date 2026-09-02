import { useLayoutEffect, useRef } from 'react'
import { CircleFadingArrowUp } from 'lucide-react'
import { Checkbox } from './ui/checkbox'
import { DimmableCard } from './DimmableCard'
import { IconButton } from './primitives/icon-button'
import { Input } from './ui/input'
import { cn } from '@/lib/cn'
import { caretOffsetFromPoint } from '@/lib/caret'
import { useScrollIntoViewAboveKeyboard } from '@/hooks'

interface MarkdownTaskCardProps {
  text:            string
  done:            boolean
  onToggle:        () => void
  onPromote:       () => void
  // Inline editing — when editValue is provided the text becomes an input
  onClickText?:    () => void
  editValue?:      string
  onEditChange?:   (value: string) => void
  onEditCommit?:   () => void
  onEditCancel?:   () => void
}

export default function MarkdownTaskCard({
  text, done, onToggle, onPromote,
  onClickText, editValue, onEditChange, onEditCommit, onEditCancel,
}: MarkdownTaskCardProps) {
  const isEditing = editValue !== undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const caretOffsetRef = useRef<number | null>(null)
  useScrollIntoViewAboveKeyboard(isEditing, inputRef)

  // Runs once per edit-session entry (not on every keystroke) so the caret
  // lands where the user tapped, overriding the input's own autofocus
  // placement, without fighting the user's cursor as they type afterward.
  useLayoutEffect(() => {
    if (!isEditing || !inputRef.current) return
    const len = inputRef.current.value.length
    const offset = caretOffsetRef.current == null ? len : Math.min(caretOffsetRef.current, len)
    inputRef.current.setSelectionRange(offset, offset)
  }, [isEditing])

  return (
    <DimmableCard dimmed={done} className="flex items-stretch gap-2.5 pl-2 pr-2.5 py-2">
      <span className="w-1 self-stretch rounded-full shrink-0 min-h-5 bg-muted-foreground/20" />
      <div className={cn('relative z-20 flex flex-1 min-w-0 items-center gap-1.5 py-0.5', done && 'opacity-60')}>
        <Checkbox
          checked={done}
          onCheckedChange={onToggle}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
        {isEditing ? (
          <Input
            ref={inputRef}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opens in response to a user click (promote to inline edit), not on page load
            autoFocus
            variant="ghost"
            // leading-5 fixes line-height in px (not em) so the row doesn't grow when the
            // font bumps to 16px on mobile — see text-base comment below.
            className="flex-1 text-base sm:text-sm leading-5 font-medium"
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
            className={cn('flex-1 min-w-0 text-left text-sm leading-5 font-medium truncate cursor-pointer', done ? 'line-through' : 'text-foreground')}
            onClick={e => {
              caretOffsetRef.current = caretOffsetFromPoint(e.clientX, e.clientY)
              onClickText()
            }}
          >
            {text}
          </button>
        ) : (
          <span className={cn('flex-1 text-sm leading-5 font-medium truncate', done ? 'line-through' : 'text-foreground')}>
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
    </DimmableCard>
  )
}
