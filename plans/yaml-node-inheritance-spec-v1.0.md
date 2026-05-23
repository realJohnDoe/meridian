# YAML Node Inheritance Model — Specification

**Version:** 1.0  
**Status:** Draft

---

## Abstract

This document specifies a general-purpose compositional inheritance model for
YAML-structured data. It defines how a tree of nodes — each a YAML mapping —
merges fields from parent to child according to structural rules, enabling
partial overrides, recursive nesting, and domain-agnostic schema extension.

The model is used as the structural foundation of the Instance Recurrence
Specification, but is separable from it. Any application that needs
human-editable, compositional YAML structures can adopt this model
independently.

---

## 1. Concepts

### 1.1 Node

A **node** is a YAML mapping (dict). Nodes may appear as top-level documents
or as entries in another node's `instances` list. Every node is a valid YAML
mapping; no special encoding or wrapping is required.

### 1.2 Node Tree

Nodes form a tree via the `instances` field. A node with an `instances` list
is a **parent**; each entry in the list is a **child**. The tree may be
arbitrarily deep.

```yaml
# Parent node
title: Weekly Meeting
instances:
  - title: Weekly Meeting (makeup)    # child node
    date: 2026-06-15
```

### 1.3 Effective Node

The **effective node** of a child is the result of merging it with its
parent. It represents the fully resolved set of fields that apply to that
child, combining inherited parent fields with child overrides.

---

## 2. Inheritance Rule

### 2.1 Core Rule

Child nodes inherit from their parent via a **structural merge**:

```
effective_node = merge(parent, child)
```

Every field in the parent is present in the effective node unless the child
explicitly overrides it. The merge traverses the node tree recursively — a
grandchild's effective node is `merge(merge(root, parent), child)`.

### 2.2 Field Kind Classification

Fields are merged according to their **kind**: product type or sum type.

#### Product Types

**Product types** model compositional data where multiple fields coexist
naturally (`A AND B AND C`). Merging is additive: child keys override matching
parent keys; parent keys absent from the child are preserved.

Two sub-cases:

**Scalar product fields** — any field whose value is a scalar (string,
number, boolean, null, or a list of scalars). Each scalar field is an
independent unit; a child overrides a scalar field by replacing its value
entirely. A child that does not mention a scalar field inherits it unchanged.

```yaml
# Parent
title: Weekly Meeting
time: "09:00"
timezone: Europe/Vienna
done: false

# Child
time: "10:00"          # overrides time only
# title, timezone, done are inherited
```

**Product dict fields** — any field whose value is a YAML mapping that does
NOT contain a `type` key (see Sum Types below). Product dicts merge
recursively: the child's keys override matching parent keys, and absent keys
are inherited.

```yaml
# Parent
metadata:
  author: alice
  version: 1

# Child
metadata:
  version: 2           # overrides version; author is inherited
# effective: {author: alice, version: 2}
```

#### Sum Types

**Sum types** model mutually exclusive variants (`A OR B`). Any YAML mapping
that contains a `type` key is treated as a sum type, regardless of what other
keys it has.

Sum type fields **replace entirely** on inheritance — a child value replaces
the parent value wholesale, with no key-level merging. This is necessary
because the variant's fields are only meaningful relative to the active
`type`; merging keys across variants would produce nonsensical combinations.

```yaml
# Parent
repeat:
  type: schedule
  freq: weekly

# Child
repeat:
  type: after_completion    # replaces entire repeat block
  interval: 1 day
# The child's repeat has no freq — correctly absent because after_completion
# doesn't use it. If merging were key-level, freq would be inherited nonsensically.
```

The rule is automatic and general: no enumeration of which fields are sum
types is required. Any dict with a `type` key is treated as one.

### 2.3 `instances` Is Not Inherited

The `instances` key of a parent is not propagated to children. Each node owns
its own `instances` list. This prevents unbounded recursive merging and keeps
each node's child list explicit.

### 2.4 Unknown Fields

Any field not defined by the application's schema is treated as a scalar
product field — it is inherited by children and overridden independently. This
makes the model forward-compatible: new fields added to a root node propagate
to all children without schema changes.

---

## 3. Merge Algorithm

The following pseudocode defines the canonical merge. It is intentionally
simple — no special cases, no field enumeration.

```
function merge(parent, child):
  result = {}

  # Start with all parent fields
  for (key, value) in parent:
    if key == "instances":
      continue                      # never inherited (§2.3)
    result[key] = value

  # Apply child overrides
  for (key, value) in child:
    if key == "instances":
      continue
    parent_value = result.get(key)
    if is_sum_type(value):
      result[key] = value           # replace entirely
    elif is_product_dict(value) and is_product_dict(parent_value):
      result[key] = merge(parent_value, value)   # recurse
    else:
      result[key] = value           # scalar override

  return result

function is_sum_type(value):
  return is_dict(value) and "type" in value

function is_product_dict(value):
  return is_dict(value) and "type" not in value
```

### 3.1 Recursive Tree Merge

For a tree of depth > 2, merge is applied bottom-up:

```
effective(root)               = root
effective(child of root)      = merge(root, child)
effective(grandchild)         = merge(effective(parent), grandchild)
```

Each node's effective form depends only on its own fields and its parent's
effective form, not on siblings or cousins.

---

## 4. `excluded` Convention

The `excluded` field is a boolean scalar. By the product type rule, a child
with `excluded: true` inherits this value. A child of an excluded node is
itself excluded unless it explicitly sets `excluded: false`.

Applications that use `excluded` to suppress output should check the
**effective** `excluded` value (after merge), not the raw child value.

```yaml
# Parent excluded — all children are excluded by inheritance
title: Old Series
excluded: true
instances:
  - date: 2026-05-01          # effective excluded: true (inherited)
  - date: 2026-05-08
    excluded: false            # explicitly re-included
```

---

## 5. Schema Openness

The node schema is **open**. Applications define their own fields; the
inheritance model makes no assumptions about field names or semantics beyond
the structural rules above. Fields not recognized by an application should be
preserved through the merge pipeline and passed through to output unchanged.

This openness enables:

- **Application extension** — add fields like `priority`, `color`, or
  `assignee` without modifying the inheritance engine.
- **Forward compatibility** — files written with future field versions remain
  parseable by older implementations, which will simply inherit and pass
  through the unknown fields.
- **Domain layering** — domain-specific specs (such as the Instance
  Recurrence Specification) can define field semantics on top of this model
  without coupling the merge logic to their domain.

---

## 6. Validation

Validation should be applied to **effective nodes** (after merge), not to raw
YAML input. This ensures that validation catches cases where a required field
is inherited rather than explicitly set, and that children are not required to
repeat fields they correctly inherit.

Implementations should document which fields they validate and at which merge
depth.

---

## 7. Implementation Notes

- Treat any dict containing a `type` key as a sum type — replace entirely
  during merge, do not recurse into its keys
- Never merge or propagate the `instances` key from parent to child
- Apply merge recursively for the full depth of the tree; do not flatten
- Preserve unknown fields through merge — do not drop them
- Validate after merge, not on raw input
- The merge function is pure and stateless; it takes two dicts and returns a
  new dict — no side effects
- For performance, effective nodes can be cached by `(node_id, depth)` as
  long as the cache is invalidated when any ancestor changes

---

## 8. Relationship to Domain Specifications

This document defines the structural layer only. Domain specifications build
on top of it by assigning semantics to specific fields. The Instance
Recurrence Specification is one such domain layer; it defines the `date`,
`time`, `timezone`, `repeat`, `done`, and `duration` fields, along with
temporal expansion semantics, while relying on this document for all merge
behaviour.

A domain specification may:

- Define required fields and their types
- Define validation rules on effective nodes
- Define which fields affect expansion or output
- Define output schemas

A domain specification may not:

- Override the core merge rule (§2.1–§2.4)
- Introduce field-specific merge exceptions
- Change the treatment of `type` keys or `instances`

This separation ensures that the merge engine is domain-agnostic and can be
implemented once, tested independently, and reused across domain layers.
