export { default as SettingsIndex } from './SettingsIndex'
export { default as AppearanceSettings } from './AppearanceSettings'
export { default as AddVaultWizard } from './AddVaultWizard'
// Rendered by `routes/auth.callback` too — the tail of the same add-a-vault
// flow, which lands on its own route after the GitHub redirect.
export { default as RepoPicker } from './RepoPicker'
export { default as VaultDetail } from './VaultDetail'
// Exported for the cross-check in `routes/__root.test.tsx`: the picker's list
// and `THEME_CLASS` are written separately (importing the root route into the
// settings chunk would drag the whole app shell along), so a test asserts they
// still agree rather than one deriving from the other.
export { THEMES } from './themes'
