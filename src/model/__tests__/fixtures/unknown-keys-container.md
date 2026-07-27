---
title: Release train
project: apollo
defaults:
  owner: alice
  tags:
    - work
instances:
  - date: 2026-04-01
    repeat:
      type: schedule
      freq: weekly
      byweekday:
        - mo
    defaults:
      duration: 30m
  - date: 2026-05-03
    repeat:
      type: schedule
      freq: weekly
      byweekday:
        - fr
    owner: bob
  - date: 2026-07-01
    duration: 2d
---
