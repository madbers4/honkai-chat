# Referee round gate

The optional referee now owns the start of **every** fresh round, including the
first round and rematches. The existing robot exchange plays completely first.
Then the server publishes `phase: 'story'`, `story.stage: 'refereeIntro'` while
the referee reads a separate introduction. There is no speaking timeout while
the referee is connected. Neither countdown nor battle time advances behind it.

## Wire contract

Public `story.refereeIntro` exists only during that wait:

```js
{
  sequenceId: 'ROOM:referee:EVENT_ID',
  round: 2,
  matchSerial: 0,
  elapsed: 4.2,
  disconnectedRemaining: null // remaining grace seconds when disconnected
}
```

Only the currently bound referee socket can send:

```js
{ type: 'refereeStartRound', sequenceId: currentIntro.sequenceId }
```

This requires both fighters to be connected and a private favorite already
selected. It releases one full three-second countdown. Early, stale, repeated,
fighter-authored and foreign-round requests cannot start or extend it. The
public sequence identifier is an anti-replay key, not an authentication secret.

Only the referee receives `refereeState`:

```js
{ type: 'refereeState', favorite: null, selectionRequired: true, prepared: false }
{ type: 'refereeState', favorite: 'p2', selectionRequired: false, prepared: true }
```

Selection uses `refereeFavorite` with `favorite: 'p1'` or `'p2'`. New sessions
have no selected favorite. Legacy `neutral` migrates to no selection, and new
neutral/invalid values are ignored. Reconnecting with the referee credential
restores the selected favorite. Neither favorite nor referee credential is
broadcast to fighters. The biased introduction and commentary are composed on
the private referee client; they are not embedded in the public snapshot.

## Media preparation handshake

A new referee session starts with `prepared: false`. Watching first lets its
client learn the actual fighter names. After choosing a favorite and completing
audio decoding / graphics preparation, it sends `{ type: 'refereeReady' }` and
waits for the private `prepared: true` acknowledgement before showing the live
microphone. Ready without a chosen favorite is rejected. A forged round-start
packet cannot bypass the preparation requirement.

During preparation, public `story.refereePreparing` and `referee.preparing` are
true. Initial rules, the opening scene, and fresh-round recordings/countdowns
are paused (`story.paused: true`); the first phrase cannot disappear during a
slow load. An already running fight or its reconnect countdown is never held.
Disconnecting the preparing referee releases this preparation pause.

Prepared assets survive an ordinary socket reconnect on the same page: a watch
request with no `preparing` flag or with `preparing: false` preserves readiness.
A **new page**, including one restoring a saved referee token, sends
`watch { preparing: true }` to clear readiness until its own preload finishes.
This does not clear the private favorite. The client must not infer preparation
from a saved credential. Subsequent successful `refereeReady` is idempotent.

## Rules and interruption

With a referee present, rules advance automatically at two words per second
plus five seconds for breathing room (12–55 seconds per card). `story.duration`
contains the current card's duration; `elapsed` is its authoritative clock.
The charter text remains unchanged. Referee `storyAdvance` is no longer used.
Without a referee, the existing fighter acknowledgements remain. A referee
joining midway through a card gets its full reading time. Missing fighters
pause the presentation, as before.

An established round gate tolerates a referee disconnect for 15 simulation
seconds. Reconnection keeps the same round and introduction identifier. If no
referee returns, the ordinary countdown resumes automatically. This fallback
does not override a disconnected fighter's pause. Reconnecting after fallback
does not capture the same round again. The next round can use the referee.

A late referee can capture an ordinary new-round countdown, restoring the full
three seconds after the introduction. Joining an active fight, or its safety
countdown after a fighter reconnect, never interrupts that fight. Rooms created
by legacy clients without `storyMode` gain the round gate on referee attachment.

## Verification

`referee-round-gate.test.js` drives the real combat state through all five wins,
a rematch, unlimited reading, both types of disconnect, fallback, late joining
and automatic rounds. `story-server.test.js` exercises actual WebSockets for
private favorite selection, authorization, replay protection, reconnection and
the countdown. Existing story and voice timing tests retain full recordings.
