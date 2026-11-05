import type React from 'react'
import { CollapsibleContent } from '@/components/ui/collapsible'

/**
 * A Radix `CollapsibleContent` that animates its height open and shut — the
 * shadcn recipe (tw-animate's `collapsible-down`/`-up`, driven by Radix's
 * measured `--radix-collapsible-content-height`), kept in one place so every
 * collapsible section moves the same way.
 *
 * `className` lands on an inner box, not on the animated one: the animated box
 * must be `overflow: hidden` with nothing outside its measured height, or a
 * margin/gap/padding there would be left standing at height 0 and jump away
 * when the content unmounts. Radix keeps the content mounted until the closing
 * animation ends, so no extra state is needed here.
 */
export function CollapsibleBody({ className, children, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up motion-reduce:animate-none"
      {...props}
    >
      <div className={className}>{children}</div>
    </CollapsibleContent>
  )
}
