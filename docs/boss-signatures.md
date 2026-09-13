# Regional boss combat expansion

Player outcome: recognize each region's final boss by the movement and counterattack
it asks for. Ordinary rooms should use all registered mob species while preserving
the established spawn capacity and per-species reward rules.

Acceptance and regression requirements:

- Six final bosses each use two exclusive signature attacks, with explicit phase
  orders at 60% and 30% HP. Generic attacks remain between signature casts.
- Visible warnings, hurt geometry and party warning snapshots share one frozen
  cast plan. Each strike has at least 1.2 seconds of warning and every cast has
  at least one second of recovery. Enrage does not shorten those windows.
- A fresh signature cue replaces stale danger notices immediately while keeping
  routine guidance queued; it cannot wait behind a previous cast's warning or
  fade in during the warning window. The queue owns its visible lifetime.
- Every plan has a traversable escape path at normal movement speed in the
  retained and offset-room cases; screenshots must show readable safe areas.
- At most six reusable warning meshes per boss. Pause freezes warnings, and
  stun/death/stop cancel pending damage and remove the owned graphics.
- Simultaneous overlapping shapes hit each living actor only once. Player.hurt
  owns invulnerability and damage mitigation; the host owns party simulation.
- Boss signatures replace automatic ambient hazards in the final boss room;
  regular rooms and existing bosses retain their established hazards.
- Mob pool iteration reaches all six melee and all three ranged species without
  changing normal-room capacity, reinforcement accounting or boss reward ledgers.
- Actual app QA covers both signatures for all six bosses, phase selection,
  dodging, recovery, defeat/cleanup and the related reward path. Local browser
  rendering does not establish physical-phone performance or a year of content.
- All authored chapters, including the homecoming epilogue, record campaign wins
  once. The actual result screen must pay and persist its currency, stars and
  expedition progress without a duplicate payout when reopened.
- Expedition level-up gold has its own visible receipt on the result screen and
  stays separate from the stage receipt used for the existing double reward.
- Portrait lobby captions sit above the measured goal/stage/departure block.
  Short phones keep rarity and name on one row, with power below. Menus, goals,
  hero identity and departure must remain visible without overlap; the goal is
  a touch target of at least 44 pixels.

The new techniques are triple/reversed bell rings, paired bell strikes, sequential
furnace vents, hammer aftershocks, a reverse record of recent player positions,
inside/outside hourglass pulses, sweeping tide lanes, closing undertow rings,
rotating crown cuts, paired marks with a delayed cut, frozen tethers and moving
safe shelters. These use the shipped rigs, original attack clips and bounded
floor effects; they are gameplay additions rather than newly generated assets.
