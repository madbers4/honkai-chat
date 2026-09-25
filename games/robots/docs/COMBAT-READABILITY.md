# Combat response and counterplay

The September 25 pass keeps 180 HP, five wins and existing damage/costs. It changes the amount of time a player loses control and makes heavy movement and ultimate counterplay match their presentation.

## Reactor discharge

- One tap still pays 80 energy and starts the 8 second cooldown. There is no hold gesture or automatic retry.
- Charge lasts **1.85 seconds**. Pulses occur at **1.85 / 2.07 / 2.31 seconds**, doing **45 / 55 / 120 damage**. Total action duration is **3.05 seconds**.
- `ultimateArmor` is false. An actual incoming damaging jab, heavy, bolt, launcher, mine, slam, grab or ultimate interrupts it. A missed attack, visual spark, duplicated input or an old event does not. There is no cost refund.
- Forward range remains 5.2. The damaging vertical band is now **1.6**, instead of 3.5, measured from the attacker's root. It does not track a target behind the attacker.
- A correctly timed normal jump clears all three pulses. At 60 Hz, the regression suite tests a continuous half-second span from approximately **1.23–1.73 seconds after activation** in both facings, plus guard and retreat. Jumping at the very beginning of the charge lands too early.
- A full front guard survives all three pulses with 28 chip damage. A connected first pulse still leads into the lethal sequence; its .26/.28 second intermediate stuns bridge only the .22/.24 second pulse gaps.

Presentation must use authoritative `actionTime / ATTACKS.ultimate.startup` for the shrinking warning ring. Show the jump cue in the final **.60–.15 seconds** of charging, remove the ring immediately when the action changes, and use the authoritative `ultimatePulse` events for the discharge. Do not leave the old .95/1.23/1.55 timelines or armor wording in client effects, instructions or tests.

## Heavy route

| Variant | Startup | Hop start | Hop speed | Peak | Forward step |
| --- | ---: | ---: | ---: | ---: | --- |
| heavyDrive | .44 | .17 | 6.0 | ~.73 | 2.7 units/s during .16–.46 |
| heavyHook | .34 | .10 | 6.2 | ~.78 | 2.2 units/s during .16–.39 |
| heavyPress | .40 | .12 | 6.2 | ~.78 | 2.2 units/s during .18–.44 |

Each hop uses actual server `y/vy`, with gravity and a real landing. A link can inherit the end of the previous hop; its next hop waits until real floor contact. `groundHeavy` keeps this an authored heavy route instead of accidentally selecting an aerial slam. The rig must not add another root jump.

The .17 second opener takeoff preserves a short grounded feint opportunity before commitment. A heavy can close from 3.4 units and deals 24/28/36 damage, versus 6/8/12 for the light route. Confirmed Drive/Hook retain .18/.20 second microstun followed by .44 seconds of defense-only advantage: the defender can block, jump or retreat, while counter-jabbing cannot steal the intended follow-up. Blocked heavies do not grant that advantage. The terminal Press retains long recovery and starts no fourth attack automatically. Tests exercise both facings, corner block/jump, early and late continuations, whiffs, buffered double taps and a clean escape from the entire route.

## Shorter interruption and buffering

| Source | Previous full stun | New full stun |
| --- | ---: | ---: |
| Jab / Cross / Rake | .26 / .30 / .43 | .18 / .20 / .26 |
| Launcher / Crusher | .60 / .58 | .34 / .30 |
| Bolt / EMP mine | .38 / .55 | .24 / .30 |
| Broken guard | .95 | .48 |

Damage, hit height, launch velocity and knockback for these attacks are preserved. EMP and launcher now let the victim resume air control before landing; their flight remains bounded by gravity. A held block or buffered dash can answer the light follow-up. Heavy defense-only advantage and ultimate confirmed-pulse stuns are intentionally separate from normal full stun.

The existing .30 second input buffer remains limited to one intent. When another hit connects, a recent jump/dash keeps its **original expiry** instead of being swallowed. It never extends itself through an indefinite combo. Offensive queued attacks are erased by contact, and disconnect still clears all queues. A jump now serializes as `action: jump` on its launch tick instead of briefly reporting idle/walk while `vy` is already positive.

Server acceptance: combat-readability, attack-commitment, heavy-advantage, heavy-series, overload-rebalance, special-balance, combat v1/v2/v3/v5, gameplay-update-protocol, protocol-v2 and heavy-protocol suites. Client rig/effect fixtures using old charge ages require a separate presentation pass; passing server tests is not a claim that those animations are finished.

## Presentation acceptance

The charge circle contracts from radius 1.65 to .18 using the same authoritative startup on every quality setting. Its early center stays above the deck and settles onto the core; the circle disappears at release or interruption. A narrow floor lane remains through the three pulses. Only fresh authoritative pulse events create beams, with no timer-generated shot after cancellation. Low quality keeps the outer warning and lane; reduced motion has the same timing without spinning or flashing the warning.

During the final .60–.15 seconds, a grounded, free opponent in the forward lane sees `ПРЫГАЙ · ВВЕРХ!` over the actual joystick. The earlier plain-text instruction is to interrupt or retreat. Cues disappear on pause, interruption, leaving the lane or jumping; they do not promise an available jump during hitstun. The effect/UI tests run real jumps at four points across this window in both facings and verify that all three pulses miss.

The heavy rig preserves the previous articulated toe pose over the first .12 seconds of a continuation. It tucks the rear supports during actual ascent and aims the striking claw down from the real server root height. This removes a .41 m neutral-pose pop at Drive → Hook and prevents the airborne hook from hitting above the rival's chassis. The existing .23 m hand-off bound and exact mesh contact checks remain in force.

Robot lamps now remain visible children of the gameplay root, while their positions and spotlight target follow the original moving joints. Turning off a destroyed/low-quality reactor changes power, not Three.js light topology. `robot.prepareCombat()` idempotently prepares the original wreck geometry before renderer warmup, without triggering destruction. Numerical tests cover original lamp positions/direction, fixed light membership after fracture, and one-time preparation. GPU performance is assessed separately by the integrated arena loading review.

Native browser review covered high/low charge contraction, the first authoritative discharge, and all three heavy contacts at actual .71–.78 m root height. No console errors or warnings were observed. This is desktop WebGL review, not a physical-phone performance measurement.
