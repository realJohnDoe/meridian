---
defaults:
  title: Daily Check-in
  done: false
  tags:
    - work
instances:
  - date: 2026-04-01
    repeat:
      type: schedule
      freq: daily
      end:
        type: until
        date: 2026-04-09
    defaults:
      done: true
    instances:
      - date: 2026-04-05
  - date: 2026-04-10
    repeat:
      type: after_completion
      interval: 2 days
    defaults:
      done: true
    instances:
      - date: 2026-04-10
---
