import { Calendar, CalendarRange, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle } from './ui/drawer'
import { Separator } from './ui/separator'
import type { SeriesSheetConfig } from '../meridian'

interface Props {
  config: SeriesSheetConfig | null
  onClose: () => void
}

export default function SeriesScopeDrawer({ config, onClose }: Props) {
  return (
    <Drawer open={!!config} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3 pb-10">

        <DrawerTitle>{config?.title ?? ''}</DrawerTitle>
        <Separator />

        <div className="px-4 pt-3 pb-1 flex flex-col gap-1">
          {config?.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => { opt.onClick(); onClose() }}
              className="flex items-center gap-3 px-3 py-3 rounded-xl text-left
                         hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <span className="text-muted-foreground shrink-0">
                {opt.icon === 'calendar'
                  ? <Calendar size={18} />
                  : <CalendarRange size={18} />}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground leading-snug">
                  {opt.label}
                </div>
                <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                  {opt.sublabel}
                </div>
              </div>
            </button>
          ))}

          {/* Cancel row */}
          <button
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-left
                       hover:bg-white/5 active:bg-white/10 transition-colors
                       text-muted-foreground"
          >
            <X size={18} className="shrink-0" />
            <div className="text-sm font-medium">Cancel</div>
          </button>
        </div>

      </DrawerContent>
    </Drawer>
  )
}
