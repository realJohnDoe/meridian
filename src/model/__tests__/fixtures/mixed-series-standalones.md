---
defaults:
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
    title: Weekly Sync
    done: false
    duration: 30m
    defaults:
      title: Weekly Sync
      done: true
      duration: 30m
    instances:
      - date: 2026-04-08
        time: 09:00
  - date: 2026-04-07
    time: 10:00
    repeat:
      type: schedule
      freq: monthly
      bymonthday:
        - 7
    title: Monthly Retro
    done: false
    duration: 1h
    defaults:
      title: Monthly Retro
      done: true
      duration: 1h
    instances:
      - date: 2026-05-07
        time: 10:00
  - date: 2026-07-01
    title: Planning Offsite
    duration: 2d
---
