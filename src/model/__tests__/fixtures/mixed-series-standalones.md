---
defaults:
  title: Weekly Sync
  done: false
  tags:
    - work
instances:
  - date: 2026-04-01
    time: 09:00
    repeat:
      type: schedule
      freq: weekly
      byweekday:
        - mo
      end:
        type: until
        date: 2026-05-02
    defaults:
      duration: 30m
    instances:
      - date: 2026-04-08
        time: 09:00
        excluded: true
      - date: 2026-04-08
        time: 10:00
  - date: 2026-05-03
    time: 10:00
    repeat:
      type: schedule
      freq: weekly
      byweekday:
        - fr
    defaults:
      duration: 1h
    instances:
      - date: 2026-05-10
        time: 11:00
  - date: 2026-07-01
    duration: 2d
---
