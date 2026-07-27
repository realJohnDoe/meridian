# Blog post images

Drop the four screenshots here with these exact filenames — the article references
them by relative path (`images/<name>`), so the names must match.

| Filename | Screenshot | Used in section |
|---|---|---|
| `agenda-view.png` | Current **agenda view** ("Sunday, July 26" — Welcome to Meridian, Buy groceries, Weekly planning session, …) | Intro (hero image) |
| `plaintext-os-prototype.png` | **Early prototype** from the ~100-version Claude chat (agenda list — Weekly Standup, Exercise, Monthly review, …) | "A hundred versions on a phone" |
| `inheritance-debugger.png` | The **inheritance / recurrence debugger** (`laundry.md` — Source · Effective Tree · Occurrences · entry editor) | "Then the 'simple' idea started growing" |
| `entry-editor-listed-on.png` | Current **entry editor** ("Favorites" note — `LISTED ON` row near the top, `ITEMS` section at the bottom) | "Everything is a list" |

Current files: `agenda-view.png`, `plaintext-os-prototype.png`,
`entry-editor-listed-on.png`, and `inheritance-debugger.webp`. If you re-export any in a
different format, update its extension in
`meridian-why-i-built-a-markdown-first-calendar.md` to match.

## Controlling display size

The images are wrapped in `<figure class="post-figure post-figure--phone|--wide">`
blocks rather than plain Markdown, so their size is controlled two ways:

- **Quick default:** the `width="340"` attribute on each phone screenshot. Change the
  number (or add one to the `--wide` debugger image) to resize without touching CSS.
- **On the Svelte site (preferred):** target the classes in your stylesheet. The three
  portrait phone screenshots use `--phone`; the wide debugger uses `--wide`.

```css
.post-figure { margin: 2rem auto; text-align: center; }
.post-figure img { max-width: 100%; height: auto; border-radius: 8px; }
.post-figure--phone img { max-width: 340px; }   /* portrait phone screenshots */
.post-figure--wide  img { max-width: 100%; }     /* wide desktop screenshot */
.post-figure figcaption {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  font-style: italic;
  opacity: 0.75;
}
```

CSS `max-width` on `--phone` overrides the `width` attribute on your own site, so you can
tune sizing centrally there while the attribute keeps GitHub's preview reasonable. If your
Markdown pipeline sanitizes raw HTML or strips `class`, these figures won't apply — mdsvex
renders them as-is by default.
