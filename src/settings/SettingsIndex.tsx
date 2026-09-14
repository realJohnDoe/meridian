import GeneralSettings from './GeneralSettings'
import VaultList from './VaultList'
import AboutSettings from './AboutSettings'

/** The settings landing screen: app-wide preferences, then the vault list, then About. */
export default function SettingsIndex() {
  return (
    <div className="flex flex-col gap-8">
      <GeneralSettings />
      <VaultList />
      <AboutSettings />
    </div>
  )
}
