# Club soundtrack

The user supplied `OST.mp3`; the game uses its first **290 seconds (4:50)** and native `HTMLAudioElement.loop`. The MPEG Info/LAME delay and padding declare exactly 290 decoded seconds. There is no JavaScript `timeupdate` seek and no whole-track `decodeAudioData` allocation. The 4,641,017-byte MP3 starts loading only after a gesture and an active room, independently from arena startup.

One media element continues across rounds and rematches. Its Web Audio GainNode connects directly to `AudioContext.destination`: `.24` for fight/countdown/finishing, `.055` for waiting/story/roundOver/matchOver. Ducking takes 250ms; rising takes 600ms. The ordinary sound toggle controls music too. Referee audio stays muted by default. Hidden tab, disconnected transport, server/story pause and mute pause at the current position. Leaving resets the position. A fresh server snapshot resumes after reconnection. An autoplay or network failure waits for another gesture, with only one outstanding play promise. `GameAudio.stop()` still affects combat audio only, so the story-transition cleanup cannot restart the OST.

## Asset processing

- Source SHA-256: `eff2d02bc4a1f46589eb3d635399a75713701813fd8d752ded78c155394a1041`.
- Source first 290 seconds: -9.63 LUFS, +1.29 dBTP, loudness range 5.70 LU.
- Applied constant **-6.4dB**, not a compressor or dynamic loudness normalizer. Only 8ms fade-in / 15ms fade-out prevent splice clicks.
- Delivered audio: stereo 44.1kHz, CBR 128kbps, no cover art or ID3 tags. Measured output -16.45 LUFS, -5.28 dBTP, unchanged loudness range 5.70 LU.
- Output SHA-256: `a1be5cb4fc2dfcddfeafd57b71007a1ac244fc296382d4b52dbc17f0efe9cc70`.

Reproduction (FFmpeg 7.1, libmp3lame):

```text
ffmpeg -i OST.mp3 -map 0:a:0 -map_metadata -1 -vn -t 290 -af "volume=-6.4dB,afade=t=in:d=0.008,afade=t=out:st=289.985:d=0.015" -ar 44100 -ac 2 -c:a libmp3lame -b:a 128k -write_xing 1 -id3v2_version 0 -write_id3v1 0 public/assets/music/club-ost-290.mp3
```

`tests/battle-music.test.js` checks playback races, lifecycle, gain automation and the actual MPEG frames/gapless duration/hash. The mounted player/referee route test also checks visibility, paused scene, reconnect and leave hooks. Serving byte ranges remains desirable for mobile media seeking; deployment must include this new public asset.
