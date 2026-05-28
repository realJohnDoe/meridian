# Meridian Architecture Roadmap

## Context

The codebase has accumulated several issues: YAML serialization bugs (null values, body in frontmatter), an expansion pipeline split across three files in two locations, a debug screen with duplicate widget implementations, a latent bug in "edit this & following" for container nodes, and a ~850-line `meridian.ts` that mixes I/O, state, business logic, and React wiring. This roadmap cleans it up incrementally — each PR is independently shippable.

---

## PR 1 — Serialization fixes _(current, small)_

**Files:** `src/model/inheritance.ts`, `src/yaml.ts`, `src/meridian.ts`, `src/recurrence.ts`

### 1a. Drop null/undefined from YAML (`src/model/inheritance.ts`)

- `inlineVal()`: `null`/`undefined` → `return null` (skip sentinel) instead of `'null'` string
- `valueLines()`: skip object entries where value is null/undefined
- `yamlFrontmatter()`: skip fields where value is null/undefined in all loops (root, defaults, instances)

### 1b. Remove `body` from YAML frontmatter

Body must be stripped at the markdown I/O boundary — no special-casing inside the inheritance layer.

- `writeEntityToCache()` in `meridian.ts`: extract `body` before calling `serializeRawNode`, delete it from the raw node, pass as the second argument:
  ```ts
  const rawNode = toRawNode(node) as any;
  const body = rawNode.body || "";
  delete rawNode.body;
  const content = isContainerNode(node)
    ? serializeRawNode(rawNode, body)
    : nodeToFile(node);
  ```
- `nodeToFile()` in `yaml.ts`: remove the instance-body line (`if(inst.body)lines.push(...)`). Root body already goes to markdown body on the last line.

### 1c. Generic field treatment in `makeOcc` (`src/recurrence.ts`)

Replace the explicit field whitelist in `makeOcc()` with a spread of `eff` plus structural overrides. Remove `type` — tasks and events are not distinguished at this level:

```js
return {
  ...eff,
  date: occDate,
  time: occTimeStr,
  jsTime: jsDate,
  recur: true,
  _nodeId: node.id,
  _node: node,
};
```

Apply the same spread pattern to the `after_completion` block and the non-generated instances block.

### Verification

- Create a recurring event, edit "this and following", open the saved `.md` file: no `body: null`, `duration: null`, or `body:` key anywhere in frontmatter.
- Mark a single occurrence done: instance has `done: true`, no `done: null` elsewhere.
- Events still render correctly in calendar/agenda.

---

## PR 2 — ownerPath + edit-following UX fix + debug widget reuse _(medium)_

Three related changes that all depend on occurrences carrying `ownerPath`.

### 2a. Add `ownerPath` to main-app occurrences

Route `expandRange()` in `model/expand.ts` through `collectAllOccurrences()` (currently only used by the debugger) so every occurrence gets `ownerPath: number[]` — the path of instance indices from root to the node that owns the `repeat`. Add `ownerPath` to the `Occurrence` type in `types.ts`.

### 2b. Fix container-node "edit this & following" bug

In `meridian.ts`, `editScope === 'future'` currently calls `splitNode(rawNode, occDate)` directly — always splitting at the root. For container nodes (where `repeat` lives on a child instance), this is wrong. Replace with:

```ts
const updated = doEditFollowing(rawNode, item.ownerPath, occDate) as Node;
```

`doEditFollowing` already handles both cases (root repeat and child repeat) correctly.

### 2c. Edit-following-in-one-go

After the split, instead of `closeEntry()`, immediately reopen the entry editor pointing at `series2` so the user can edit the future series in the same gesture. The occurrence to open is the first occurrence of `series2` within the current viewport.

### 2d. Debug screen reuses main-app widgets

Once debug occurrences are the same shape as main-app occurrences (both have `ownerPath`, both come from the same expansion path), the debug screen can call `saveNode()`, `deleteNode()`, and open the same `EntryEditor` overlay directly. Remove the duplicate edit/delete implementations from the debug screen.

### Verification

- "Edit this & following" on a container node (already split series) splits at the correct child, not the root.
- After triggering "edit this & following", the editor reopens on the new series immediately.
- Debug screen edit/delete triggers the same dialogs as the main app.

---

## PR 3 — Consolidate expansion into `model/expansion.ts` _(medium, mostly moves)_

Merge `src/recurrence.ts` + `src/model/expand.ts` + `src/model/repeatExpander.ts` into `src/model/expansion.ts`. Single public surface: `expandRange()` returning occurrences with `ownerPath`. No behavior changes — pure consolidation. Delete the three source files.

### Verification

- Calendar, agenda, day view, and debug screen all still render correctly.
- No imports from `recurrence.ts` or `expand.ts` remain outside `model/`.

---

## PR 4 — Generic file handling → `model/fileIO.ts` _(hard, highest value)_

Move `src/yaml.ts` into `src/model/fileIO.ts`. Rewrite `fileToNode` and `nodeToFile` so only `date`, `time`, `timezone`, `repeat`, and `instances` receive special structural treatment. Every other field (title, done, priority, tags, duration, and anything future) serializes/deserializes as a raw YAML value — no field-by-field naming. Body is extracted on read and reattached on write here; it never enters the rest of `model/`.

After this PR, `model/` has no knowledge of domain field names.

### Verification

- Round-trip a file with all field types: booleans, strings, arrays, nested objects.
- Existing files with `done`, `priority`, `tags`, `duration` all parse correctly.

---

## PR 5 — Slim `meridian.ts` _(hard, last)_

By this point `model/` owns file I/O, expansion, inheritance, and tree ops. Two extractions:

- **`model/persistence.ts`**: Dexie setup + all `cache*` and `disk*` helpers currently in `meridian.ts`.
- **`model/ops.ts`**: `saveNode`, `deleteNode`, `toggleOccDone` as pure functions that take nodes and return updated nodes (no direct Zustand access).

`meridian.ts` becomes a thin adapter: wires Zustand reads/writes, React callbacks, navigation, sync UI. Target: ~200 lines.

### Verification

- Full save/delete/toggle-done flow works end to end.
- Sync to directory still writes correct files.
