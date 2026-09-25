# Recorded conversation runtime

`shared/spoken-catalog.js` defines the compact release schema: nine cinematic
turns and four takes (setup/reply × p1/p2) for each of the twelve round exchanges.
Runtime does not import `scripts/voice-production/spoken-script.json`; that JSON
is a production source and is compared with the shared ID schema only in tests.

The new conversation pack activates atomically when all 57 entries exist in
`GENERATED_VOICE_CLIPS`. Each requires its matching `p1`/`p2` speaker, nonempty
exact recording text, a finite positive measured duration, and a local MP3 URL
under `/assets/voices/`. Both voices of one semantic round line must have the
same text. Existing six generated entries may remain beside the new entries.
Partial/invalid packs use the old cinema and optional device-speech fallback.

After activation, the cinema chooses nine new recordings only. Name cards and
the opening/final titles stay silent. Before each round the chosen setup always
precedes its reply. Odd/even rounds alternate the opening seat, selecting that
seat's recording of the same semantic line. The old pack lacks the cross-seat
takes, so its even rounds use captions/optional local speech instead of playing
an answer as a setup. The referee uses these same shared selected captions.

Beat windows are at least `recording.duration + 0.38 s + 0.12 s`: the scheduler's
complete-first-syllable late-start grace plus breathing room. Existing minimum
shot windows remain, but there is no upper cutoff, playback speed-up, or trim.
Server scene/countdown timing, acting, camera, UI, and voice share those windows.
Pause, reconnect, mute, two-person skip, and original battle effects retain their
existing paths. Exact recording text is used verbatim; player names remain on
cards and are not promised as synthesized speech.

Preload selects the current cinematic nine plus the upcoming round's two takes,
or the current/next round's four takes. The finale warms round one of the next
match's freshly shuffled deck before players can request a rematch. It never
downloads all 57 at once. With a
complete pack the now-unused optional local-device speech checkbox is hidden;
the sound/mute control remains. A present referee suppresses automatic round
speech while the cinema still plays its recorded performance.

Validation: `tests/spoken-runtime.test.js` supplies an explicitly artificial
in-memory catalogue (including long emotional pauses) and verifies all 57 IDs,
48 round takes, exact text, side assignment, timing, preload bounds and full
late-start playback. It does not write fake metadata or MP3s to production.
Actual production audio is validated independently by the asset acceptance
suite. The existing camera, mounted player/referee, and lifecycle tests also
derive their boundaries from the selected recordings.
