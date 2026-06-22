import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import ManageVaultsDialog from '@/vaults/ManageVaultsDialog'
import ParticipantsRow from '@/editor/ParticipantsRow'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const [manageVaultsOpen, setManageVaultsOpen] = useState(false)
  const defaultParticipants    = useStore(s => s.defaultParticipants)
  const setDefaultParticipants = useStore(s => s.setDefaultParticipants)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[13px] font-medium">Vaults</span>
            <Button variant="outline" size="sm" onClick={() => setManageVaultsOpen(true)}>
              Manage vaults
            </Button>
          </div>

          <div className="flex flex-col gap-2 py-2">
            <span className="text-[13px] font-medium">Default participants</span>
            <p className="text-[12px] text-muted-foreground">
              Added to new entries in this vault automatically.
            </p>
            <ParticipantsRow
              participants={defaultParticipants}
              onChange={setDefaultParticipants}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ManageVaultsDialog open={manageVaultsOpen} onOpenChange={setManageVaultsOpen} />
    </>
  )
}
