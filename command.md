# Command

## Current Objective
Close Dual Label-Set Smoke Parity v1 after implementation and verification. Automated parity checks now cover both default `true_false` and opt-in `yes_no` runtime labels while preserving the existing 3-scenario smoke baseline.

## Top Priorities
1. Keep `npm run smoke` green as the release gate and preserve the current 3-scenario baseline.
2. Add automated parity checks for `yes_no` labels (host/student option keys + student keyboard shortcuts) without changing gameplay.
3. Keep default runtime on `true_false`; `yes_no` remains a startup config opt-in only.
4. Preserve payload/schema compatibility (`options`, `answerIndex`) and avoid protocol churn.
5. Keep lives, elimination rules, reveal timing, and lobby-readiness behavior unchanged.

## Task Board

### Backlog
- [Engineer] Optional follow-on: add extra approved binary label pairs beyond `true_false` / `yes_no`.

### In Progress
- None — Dual Label-Set Smoke Parity v1 is complete and verified.

### Done
- [Lead] Dual Label-Set Smoke Parity v1 closed on 2026-03-12 after green smoke verification (3/3 pass).
- [Engineer] Browser parity assertion corrected to respect process-level `GAME_LABEL_SET` baseline; smoke now passes in both startup modes (`npm run smoke` and `GAME_LABEL_SET=yes_no npm run smoke`).
- [Engineer] Browser smoke parity now asserts engine projection plus both UI label sets in one scenario: `True/False -> T/F -> t/f`, `Yes/No -> Y/N -> y/n`, and numeric fallback `1/2`.
- [Engineer] Startup config path hardened: `GAME_LABEL_SET` now selects `game.labelSet`, `/config` exposes the active label set, and smoke checks default/opt-in/invalid parsing behavior.
- [Engineer] README updated with `GAME_LABEL_SET=yes_no` startup usage and smoke parity coverage notes.
- [Lead] Stability recheck completed on 2026-03-12: smoke suite 3/3 pass (`occupiedDefaultPort`, `coreFlow`, `browserConsoleFlow`).
- [Engineer] Configurable binary label sets v1 shipped: server-side label-set config (`game.labelSet`), canonical-question projection at round start, label-aware host/student option badges, and label-aware student keyboard shortcuts with numeric fallback (`1/2`). Smoke 3/3 pass.
- [Lead] Foundational microcopy profile selected as default classroom rollout; current runtime copy already matches this profile (no code changes required).
- [Visual] Binary microcopy variants v1 delivered for host + student (Foundational and Advanced profiles) with no interaction model changes.
- [Engineer] Configurable binary label-set feasibility delivered with recommended implementation path, risks, and scope guard.
- Binary Question Mode v1 shipped (Engineer): core model set to two options, question bank rewritten to canonical `['True', 'False']`, host/student runtime fallback arrays made option-count-aware, student keyboard mapping updated to `T/F`, smoke fixtures + README migrated.
- Binary Question Mode v1 verified: syntax checks clean and smoke suite 3/3 pass (`occupiedDefaultPort`, `coreFlow`, `browserConsoleFlow`).
- Binary Question Mode v1 visual spec delivered and implemented: two-option hierarchy with `T/F` option keys, round/reveal copy references True/False instead of A/B/C/D, and binary-focused action cue on student round phase.
- Explicit Lobby Readiness v1 complete: explicit student ready action, `readyCount > 0` launch gating, and session-scoped ready restore.
- Reveal Clarity v1 shipped: host reveal recap, student personal reveal card, and reveal timing increased to 3000 ms.
- March stability fixes remain in place, including the smoke baseline and life-loss event wiring.

## Decisions
- 2026-03-11: Change of plans accepted — product scope is now true/false-only questions.
- 2026-03-11: Binary mode v1 uses canonical option order `True` index `0`, `False` index `1` for consistency in data and UI.
- 2026-03-11: No mixed-mode support in this slice (no runtime switching between 2-option and 4-option quizzes).
- 2026-03-11: Gameplay mechanics (lives/elimination/timers) remain intact; this shift is a question-format migration.
- 2026-03-11: command.md cleanup pass applied again to remove stale objective-specific notes and keep one active board.
- 2026-03-11: Binary Question Mode v1 implementation and smoke verification completed; board moved to objective-closed state.
- 2026-03-11: Post-Binary Polish Pack v1 completed with documentation-only outputs; no gameplay/runtime behavior changes were introduced in this rotation.
- 2026-03-11: Product approved configurable binary label sets for implementation as an opt-in global config.
- 2026-03-11: Label-set configurability implemented with one global selection per run (`game.labelSet`), no per-round mixed mode.
- 2026-03-11: Lead selected the Foundational microcopy profile as the default rollout baseline (matches current deployed copy).
- 2026-03-12: Objective advanced to Dual Label-Set Smoke Parity v1 to harden verification of the shipped opt-in `yes_no` path.
- 2026-03-12: Fresh baseline verification recorded: smoke suite passed 3/3 before parity-hardening work.
- 2026-03-12: Dual-label smoke parity completed; browserConsoleFlow now verifies both label pairs and keyboard mappings in a single `npm run smoke` path.
- 2026-03-12: `GAME_LABEL_SET` is now the documented startup override for binary label selection (`true_false` default, `yes_no` opt-in).
- 2026-03-12: Post-close parity fix applied — browser smoke no longer hardcodes `/config.labelSet=true_false`; expected value now follows active process env baseline.

## Visual Notes — Binary Microcopy Variants v1

### Profile A: Foundational (Lower Grade)

#### Student
- Lobby announcer: "You're in the lobby. Keep this screen open. Round starts on host countdown."
- Round announcer: "Tap True or False before slots fill."
- Reveal wait: "Checking answers..."
- Empty slots state: "All options are full. Waiting for next round..."

#### Host
- Lobby (0 ready): "{total} joined — no one ready yet. Ask students to tap Ready."
- Lobby (some ready): "{ready} of {total} ready. Waiting for more."
- Lobby (all ready): "All {total} ready. Launch when the class is settled."
- Round hint: "Students are choosing now. Options disappear when slots are full."
- Reveal hint: "Correct answer highlighted. Pick counts and incident summary shown below."

### Profile B: Advanced (Upper Grade)

#### Student
- Lobby announcer: "Connected in lobby. Keep this tab active for countdown."
- Round announcer: "Answer True or False before capacity closes."
- Reveal wait: "Answer audit in progress..."
- Empty slots state: "Both options reached capacity. Next round soon."

#### Host
- Lobby (0 ready): "{total} connected, 0 ready. Prompt ready check-in before launch."
- Lobby (some ready): "{ready}/{total} ready. Hold for additional check-ins."
- Lobby (all ready): "{total}/{total} ready. Launch when class pacing is set."
- Round hint: "Live picks in progress; options lock when capacity is exhausted."
- Reveal hint: "Reveal shows correct option, pick distribution, and incident counts."

### Visual Guardrails
- Keep exactly two prominent actions in round UI; no additional controls.
- Preserve `T/F` option-key badges for the current canonical `True/False` set.
- Maintain high-contrast phrasing and projector-legible sentence length.

## Engineer Notes — Configurable Label Sets (Implementation)

### Implementation Outcome
- **Shipped** as a scoped slice without protocol changes.
- Schema remains unchanged (`question.options` + `answerIndex`).

### Implemented Behavior
1. Server config now accepts `game.labelSet` (`true_false` default, `yes_no` optional).
2. Questions remain canonical internally; labels are projected when rounds are built, so `answerIndex` stays stable.
3. Student keyboard shortcuts derive from active labels (`T/F` or `Y/N`) with numeric fallback (`1/2`).
4. Host/student option-key badges derive from active labels using first available unique letter, with numeric fallback on collisions.
5. Smoke baseline remains green on default label set.

### Risks + Mitigations
- Risk: keyboard mismatch when labels change — Mitigation: generate shortcut map from active labels and assert it in smoke.
- Risk: ambiguous first letters (future label sets like `Sure`/`Sometimes`) — Mitigation: detect collisions and fallback to numeric keys.
- Risk: accidental mixed-mode drift — Mitigation: one global label-set selection per run; no per-round switching.

## Handoff Notes for Visual + Engineer

### Visual
- Keep Foundational profile as default until a product-approved change request explicitly switches to Advanced.
- Keep the selected copy synchronized across host phase banner, student announcer, and reveal messaging.
- Do not alter component layout, spacing, or interaction count while applying copy.

### Engineer
- Optional follow-on only: add more approved binary label pairs if product requests them.
- Keep `true_false` as the default runtime baseline and do not introduce per-round label switching.
- Preserve schema and event shape; future work should extend the same smoke parity pattern rather than bypass it.

## SHIFT END
- Leadership rotation continued on 2026-03-12.
- Dual Label-Set Smoke Parity v1 completed; smoke remains 3/3 pass.
- Next scoped follow-up is optional expansion to additional approved binary label pairs.
