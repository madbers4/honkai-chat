# WebGL compatibility and recovery

The reported Honor / Android Firefox failure has **not** been reproduced on
that physical device. A visible brick background alone cannot distinguish the
CSS fallback from the scene's unlit wall material. The code review found actual
failure paths that previously allowed a blank or partial arena to be treated as
ready; this patch closes those paths without choosing quality from a phone UA.

## Confirmed code issues and changes

- Arena loading completed before the first rendered robot frame. It now draws
  the real rig/materials before publishing readiness, even when preparation is
  in a hidden 1-pixel viewport. Later resize restores its proper resolution.
- Three r180 shader-link failures were console-only. The renderer now raises a
  graphics failure. Its ordinary frame and dormant-effects preparation each
  support one bounded compatible retry: no HDR reflections, bloom or shadow
  permutations. This fallback changes the current renderer only, not the saved
  graphics preference, and keeps the authored geometry and surface textures.
- Robot PBR reflections always invoked HalfFloat PMREM, even when glow correctly
  detected no float color-buffer support. Both now use a real RGBA16F framebuffer
  probe. Unsupported devices omit that reflection and retain direct lighting.
  Later accessory creation reads the armour's current reflection instead of a
  captured HDR texture. Real-GLB regressions cover new and cached accessories,
  late wreck fragments and an unaffected neighbouring HDR robot.
- Glow also validates its actual, full-size/depth-attached render targets after
  creation and resize. A rejected target falls back to the already drawn scene.
- The initial ResizeObserver echo cancelled graphics preparation even when no
  dimensions changed. Only a changed drawing-buffer size now aborts preparation.
- A lost context now shows a shared arena status and waits for restoration.
  Restoration invalidates prepared GPU resources and resumes the same scene.
  If the context stays unavailable, the message asks to reload the saved room.
  Ordinary cancellation/context loss does not trigger a quality downgrade.
  Network event IDs are still consumed during loss, but hit/explosion visuals
  are not queued. Restoration clears hitstop, contact flashes and camera feedback
  so the recovered scene cannot replay a burst of old impacts.
- A rejected first frame also disposes the already-created rigs and their
  material-cache subscriptions, so repeated load attempts do not retain robots.
- Context creation retries without MSAA only after the normal configuration
  actually fails. Successful devices retain the original rendering settings.

Errors use local diagnostic codes `GL_INIT`, `GL_SHADER`, `GL_TARGET`,
`GL_CONTEXT`, `GL_VIEWPORT` or `GL_FRAME`. Driver details remain in console
errors; the visible status does not include identifying information or logs.

## Verification

`tests/render-compatibility.test.js` covers failed and successful context
creation, advertised-but-incomplete float framebuffers, allocation cleanup,
reflection fallback preserving meshes/maps, explicit shader failures, one-shot
preparation retry, and cancellation/resize boundaries. Existing glow, GPU warmup,
asset-loading and graphics-budget tests also pass.

Native Chromium desktop review used `scripts/graphics-review.html` with the
actual WebGL renderer and `WEBGL_lose_context`, not a mocked rendering backend:
the first frame showed robots and floor, loss showed `GL_CONTEXT`, restoration
returned robots/lights/floor, and effect preparation completed with 97 programs.
The successful restored renderer reported `renderFailed: false` and
`compatibilityFallback: false`. This verifies recovery on that desktop browser;
it is not evidence of a test on Honor or Android Firefox.

The review page is served only through the local source/Vite review harness.
Its context-loss controls require the arena's existing `allowEffectReview`
option; production callers do not enable them. No production debug HTTP route
or remote telemetry was added. No assets were replaced or removed.
