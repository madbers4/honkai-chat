# Recorded conversation runtime

The story player accepts the 57 IDs in `shared/spoken-catalog.js`, with fixed
`p1`/`p2` actors and versioned local MP3 URLs from the current catalogue. It is
compatible with the existing v2 package and later approved packages; no audio
assets or generated metadata are changed by the runtime update. Original combat
effects remain a separate player and are never downloaded as story dialogue.

A complete catalogue activates all nine cinematic turns and the four takes
(setup/reply × p1/p2) for each of twelve round exchanges. Missing or invalid
catalogues produce silent captions, never archived dialogue. Both voices of a
semantic line have matching recording text. Setup always precedes reply; even
rounds change the opening seat, not the meaning. Referee text uses the same
selected captions. Silent name cards and rule cards stay silent.

Device speech has been removed from the runtime, game UI and review page. There
is no `speechSynthesis` access, no `setTtsEnabled()` API and no voice selection.
The retired `belobog-local-tts` preference is discarded on journey creation.
The sound/mute control remains. Player names are shown as text, not promised as
synthesized speech. Old preferences and partial catalogues cannot enable a
phone's female or other system voice.

Windows remain at least the measured recording length + 0.38 seconds of start
jitter allowance + 0.12 seconds of breathing room. There is no speech speed-up or
truncation. Server, camera, pose and UI share this schedule. The player preserves
pause/resume from the actual audio start; reconnects, mute and late joins never
replay expired lines. Downloading an overdue line does not play it belatedly.

Preload selects the cinematic nine and first round's two files, or the current
and next round's four files. The finale warms the next match's round one before
an immediate rematch. Referee presence suppresses playback, not preloading, so
a referee disconnect does not leave an avoidably cold next exchange. At most
three downloads run concurrently (injectable limit clamped to 1–4), including
retries; the whole 57-file pack is never requested in one sweep. Bytes fetched
before the audio gesture are decoded on unlock. Audio requests revalidate HTTP
cache entries; the one immediate retry explicitly reloads the URL.

Each download has a deadline that settles even if its transport ignores abort.
Two failures produce an honest caption-only status and a retry button. Automatic
retries have a five-second per-file cooldown, and the explicit retry only warms
the currently selected recordings. Disposal aborts active downloads and settles
queued jobs. Failures in an old scene do not strand the current scene's status.

API changes: `createStoryVoice` no longer reads `speech`/`Utterance` options;
unknown legacy options are harmless. It adds `concurrency`, `retryAfterMs`,
`now`, `retry()` and `preload(beats,{retryFailed})`. Status includes `loading`,
`retryAvailable`, `started`, and `lastClip`; the review page displays the clip ID
and counters. Existing unlock/mute/update/cancel/dispose paths remain.

Runtime imports only shared JS metadata, not the production JSON or scripts.
Tests retain coverage for exact recording text, 57 IDs, all 48 round takes,
late-start endings, mute, reconnect, referee, a cold immediate rematch,
pre-gesture decode, transport deadlines, bounded concurrency and explicit retry.

## Evidence from the pre-change public build

A read-only request to `http://158.160.23.44:3001/robots/` returned HTML with
`Cache-Control: no-cache` and entry `index-DCOwxP3Z.js`. Its modules
`main-CdpCXmjL.js` and `round-intro-Dwsbq7S6.js` had a one-hour public cache policy.
The first contained `speechSynthesis`, `localService` and `belobog-local-tts`.
The second contained all 57 distinct `spoken-v2` URLs and the legacy fallback.
Its actual `faceoff-mode-p1` entry still said «Боевой режим: кабачковое
противостояние!» and had duration 3.31 seconds. Hearing that phrase therefore did
not, by itself, prove an old cached MP3 was selected: the v2 script contained it.

The old source restored an enabled device-TTS preference for an incomplete
catalogue, then chose the first local Russian voice without an actor/sex
constraint and spoke the fallback `ttsText`. That is a concrete possible female
voice path, reproduced by the former tests. It does not prove which path the
user's phone took. The update removes this entire path instead of attributing
the report to cache without device evidence. A new approved recording package
must still be integrated separately before its new performance can be heard.
