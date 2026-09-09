
## Expedition economy API (content expansion)

`new ExpeditionEconomy(eco)` owns only `eco.s.expedition` under the existing Blade Surge save key. `Economy.fresh` and `normalizeSave` include the schema; legacy saves receive starter consumables. No remote service or new storage namespace is involved.

- Catalog `src/data/expansion.js`: arrays `DUNGEONS`, `ARENA_RIVALS`, `MATERIALS`, `CONSUMABLES`, `EXPEDITION_QUESTS`, `JOBS`, `RECIPES`.
- `snapshot()` returns a detached state, `nextXp`, and quests with `cur`, `target`, `ready`, `claimed`.
- `dungeonAccess(id)` returns `{ok,error}`. Level requirements are 1/2/3. Arena rivals require 1/2/4.
- `begin('dungeon'|'arena', id)` returns `{ok,ticket}`. Dungeons charge 4 energy; arena charges zero. A single pending ticket is allowed. The UI must abandon the ticket if renderer/combat startup fails.
- `settle(ticket,{win:boolean})` resolves exactly once. Rewards are `{gold,xp,materials?,consumables?,rating?,levelsGained,levelGold}` in `result.rewards`. `xp` is account expedition XP; `heroExp` separately awards the catalog XP amount through `addHeroExp(...,{silent:true})` to the hero captured at begin. Campaign payout methods must NOT be invoked for expedition results.
- `abandon(ticket)` refunds charged energy once. Reload cancels an unfinished ticket and refunds once. All expedition transactions synchronize the existing backup receipt state, preventing recovery from reviving a payable ticket.
- `recordCampaign(result,stage)` awards only 35 account XP on victory. Pass a unique stable `result.receiptId` (max100 chars) for each campaign battle. It dedupes across saves; without a receipt ID, each stage can be counted only once. Result object identity also dedupes within the instance. It never pays base gold, loot or hero XP.
- `claimQuest(id)` pays once. `unlockJob(id)` requires its quest reward to have been claimed. `selectJob(id|null)` selects the corresponding real base hero. Guardian: `first_oath`, knight. Ranger: `garden_scout`, rogue (granted when unlocked).
- `craft(recipeId)` creates the exact named equipment using existing `addItem(rarity,slot)` allocation then sets the canonical item ID, or produces consumables. New set recipes cost 9 matching materials +12500 gold; unique equipment sells for12000, avoiding craft/sell arbitrage.
- `consume(id)` decrements inventory and returns the effect declaration. The battle UI must check stock and combat applicability, then apply the effect only after this transaction succeeds. Consumption is not itself a combat effect.

New equipment lives in `src/data/expedition-items.js`: glasswarden, emberknight, starreader each have four pieces, existing illustrated icons and combinations of established proc handlers. They are registered into existing item catalog and save validation. No new art provenance or new proc implementation is claimed.

Verification: `bun run typecheck`; `bun test test/expedition-economy.test.ts test/economy-recovery.test.ts`. Actual installed runtime: Bun1.3.13; package manifest requests1.4.0. Browser/combat integration is separately owned and must be verified after wiring the UI.

### Field settlement integration

Call `settle(ticket, {win, fieldRewards: {fieldGold, fieldStones, fieldStones2, fieldStones3, fieldFragments}, fieldLoot})` using live collected DropSystem values. `rewards` now additionally includes `got`, `loot`, `heroExp`, `ups`, `heroId`, `stones`, `stones2`, `stones3`, `fragments`. `gold` includes base plus field gold; `got` gold additionally includes any account level-up gold. Loot is filtered to existing inventory UIDs and deduplicated, never added again. Hero XP and currencies participate in the same transaction; no campaign stars/progress are changed. Negative/noninteger field values become zero; hard caps are 50000 gold, 200/100/50 stones and100 fragments per outcome. Defeat pays no outcome currencies or XP (already allocated field gear remains as before).

Primary commit success remains `{ok:true}` if subsequent backup refresh fails; `storageWarning` reports degraded recovery and the stale backup is removed by the existing rollback helper. Primary failure restores the whole in-memory state including hero XP and leaves the ticket payable for retry. Tests explicitly cover both paths.

Arena defense: `settle` ignores all supplied `fieldRewards` and `fieldLoot` for arena tickets. A free AI victory pays only its catalog60 gold/25 account XP/15 rating plus the separate25 hero XP; standard account-level-up rewards may still apply. Campaign boss currencies or loot cannot be surfaced or paid by arena settlement. The battle layer separately prevents immediate field-item allocation in arena, because already allocated inventory is not removed by settlement.

Material refining: `MATERIAL_REFINING` is exported from `src/data/expansion.js`. `refineMaterial(id)` accepts a catalog material ID only, consumes1 material and its gold fee atomically, and returns `{ok,got:[{k,n}],materialId,materialSpent:1,goldSpent}`. Glass leaf costs120 gold for5 `stones`; ember core costs240 for2 `stones2`; star dust costs360 for1 `stones3`. These are the actual existing enhancement keys and their catalog labels are 강화석/상급 강화석/전설 강화석. Pending battles forbid refining. Insufficient resources and failed primary saves leave resources untouched. Refining does not advance the equipment/potion `crafts` quest counter.
