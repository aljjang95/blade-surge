# Blade Surge expansion media

## Flow Music BGM

`public/bgm/expansion/flow-combat.mp3` is newly generated in the existing signed-in Flow Music PLUS session, downloaded through IAB UI on 2026-09-09. No purchase or upgrade was made.

Source: https://www.flowmusic.app/song/887a42b3-6e05-43a4-affe-c619e8570369

Measured MP3: 62.712 seconds, stereo 48000 Hz, 1,016,879 bytes; full FFmpeg decode succeeds; mean -16.4 dB and sample peak -0.5 dB. SHA-256: `BD8B9BBC1B11DBD03676C39E76C6470D73427D54250200608909FB917D2F57B0`.

The six pre-existing public/bgm MP3s remain original repository assets, not new generation. Seamless looping and subjective listening quality have not been verified.

## Flow Music score-derived impact accents

Flow Music Producer explicitly states its capability targets music, scores and soundscapes rather than isolated Foley clips. These accents are therefore locally edited excerpts of the generated score, **not provider-generated isolated SFX** and not CC0 assets. The original Kenney CC0 hit samples remain the primary hit layer.

| File under public/sfx/expansion | Source offset | Content trim | MP3 duration including padding | Bytes | Decoded sample peak |
| --- | --- | --- | --- | --- | --- |
| flow-impact-light.mp3 | 30.95s | 150ms | 192ms | 5462 | -19.0 dB |
| flow-impact-heavy.mp3 | 38.33s | 380ms | 408ms | 10646 | -18.2 dB |

Onsets were selected by 10ms mono RMS windows compared with the preceding 100ms: light onset ratio 9.4064; heavy ratio 4.9080. Both use short attack/release fades and -8 dB attenuation. Since score excerpts may retain pitch, the light accent is filtered to approximately 2.2–8.5 kHz and the heavy accent to 45–180 Hz, reducing the melodic midrange. This is a conservative signal edit, not proof of clean isolated percussion or listening approval.

SHA-256:

- light: `6F4355FB53D24E87AA312EB81025724E9098E16F5DAA0FA85A5C292101143923`
- heavy: `B9BA049D045249EF91B45C383828C79A9A0B68CB3C1641037D197131A80BB743`

Both files fully decode in FFmpeg. They layer only on critical/heavy hits at gains 0.12/0.16 through the existing SFX gain and compressor. Normal hits use original sounds. The final damage path preserves the separate finisher flag: a non-finishing critical selects light, while finishers and other heavy attacks select heavy. Hit bursts coalesce to one composite hit per 50ms; finishers outrank later critical events. Muting clears pending events. Voice, haptics and compressor settings are unchanged. Expedition start, boss entry and revival keep the Flow combat track; campaign music selection remains unchanged.

Verification: JavaScript syntax check passed. The committed expedition audio regression test exercises the real Battle damage dispatch, burst coalescing, finisher priority, 50ms spacing, mute cancellation and boss/revival music routes. The actual browser AudioContext was running and both buffers decoded; the production build loaded the BGM and both accents without browser errors. Subjective listening and fit have not been verified.

## Flow garden entrance video

`public/video/expansion/glass-garden-intro.mp4` is a newly generated Google Flow Veo 3.1 Fast text-to-video artifact. It depicts only the mint crystal garden and an awakening stone portal; no character reference or image input was submitted. The existing PRO account showed 630 credits before generation and a 20-credit cost for one 8-second output. No purchase or upgrade occurred.

Source project: https://flow.google.com/project/0f20b82d-98fa-4548-a530-315d2c782c6c

The IAB UI downloaded the 720p original. It is preserved at `work/media-evidence/flow-originals/glass-garden-original.mp4` (6,003,047 bytes; SHA-256 `E331D1AF9108C97CC5775A5768376D519265B4AB901425BCBE99127F64E04279`). The browser delivery file is a stream-copy faststart remux: 5,996,786 bytes; SHA-256 `D2535B5BA7DB30778D1FCBA9854CAF76556592662FC975DB65E3C91723E7A653`.

Measured media: H.264 1280×720, 24 fps, 192 frames, 8.000 seconds, AAC stereo 48 kHz. Full FFmpeg decode passes. The region-mandatory Veo watermark is retained. Four evenly sampled keyframes were inspected and show an environment-only mint garden, portal activation and forward camera progression. Full-motion subjective review and audio listening are not claimed. The application may play it muted while preserving original audio in the file.

Detailed receipt: `work/media-evidence/flow-video-generation.json`; probe: `flow-video-probe.json`; visual samples: `flow-video-keyframes.jpg`. The latest local video technique registry was reread. Selected planning vocabulary: `event-bound-monotonic-camera`, for one stable portal reveal; provider T2V was explicitly requested, I2V was not used. No publishing/deployment occurred.

Application integration verified: first garden entrance pauses game progression while the muted film is shown; reduced-motion skips automatic playback. The in-game region-film button replayed the delivered file at 1280x720, duration 8s, currentTime 1.253s with 34 decoded frames. Skip restored the original focus and usable menu; natural removal and input restoration were also observed.
