import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { fileEntries } from '../../presentation'
import { rootsField } from './wikilinkDecorations'

function wikilinkCompletionSource(context: CompletionContext): CompletionResult | null {
  // Match [[ followed by any non-bracket text up to the cursor
  const match = context.matchBefore(/\[\[[^\]\n]*/)
  if (!match) return null

  const roots = context.state.field(rootsField)
  const query = match.text.slice(2).toLowerCase() // strip [[
  const entries = fileEntries(roots)

  const options = entries
    .filter(e => !query || e.title.toLowerCase().includes(query))
    .slice(0, 8)
    .map(e => ({
      label: e.title,
      // Replaces the entire [[query range with [[title]]
      apply: `[[${e.title}]]`,
      type: 'text' as const,
    }))

  if (!options.length) return null

  return { from: match.from, options, filter: false }
}

export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkCompletionSource],
  activateOnTyping: true,
  closeOnBlur: true,
})
