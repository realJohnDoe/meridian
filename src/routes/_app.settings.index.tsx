import { createFileRoute } from '@tanstack/react-router'
import { SettingsIndex } from '@/settings'

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsIndex,
})
