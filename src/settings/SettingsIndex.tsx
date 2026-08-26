import GeneralSettings from './GeneralSettings'
import VaultList from './VaultList'

/** The settings landing screen: app-wide preferences, then the vault list. */
export default function SettingsIndex() {
  return (
    <div className="flex flex-col gap-8">
      <GeneralSettings />
      <VaultList />
    </div>
  )
}
