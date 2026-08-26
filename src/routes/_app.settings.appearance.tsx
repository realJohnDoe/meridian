import { createFileRoute } from '@tanstack/react-router'
import { AppearanceSettings } from '@/settings'

export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearanceSettings,
})
