# Mobile settings and app-screen usability

At 320px, the settings panel previously clipped the camera explanation and keyboard help past its right edge. The text now wraps inside the panel. Volume labels keep readable words and allow the slider row to wrap when necessary. Touch devices receive joystick, attack/dodge and six-skill instructions; non-touch devices list the actual WASD, J/Space, K/Shift, 1–6 and R/Q/E bindings.

Existing PWA controls remain available before entering the game, in the lobby and in the pause menu. The manifest requests fullscreen with standalone fallback. The installation guide explains launching the home-screen icon; normal browser tabs retain their browser chrome. Neve stays in the lobby/pause menus and opens a dismissible dialog. These settings changes do not alter saves, combat, rewards or store configuration.

## Verification

```powershell
bun run check
node tools/mobile-settings-qa.mjs
```

The full local check passes TypeScript, 672 tests / 93,731 assertions and the production build. The browser command owns its local preview server and isolated browser contexts. It checks Chromium, Firefox and WebKit at 320×568, 390×844, 412×915, 667×375, 844×390 and 1024×768. Each context resizes through the six layouts; these are not separate physical devices.

The checks include camera/input text bounds and horizontal overflow, install-button access, five-point control hit tests, boot/lobby installation-guide focus return, Neve open/close focus, absence during active combat, and preservation of pause after closing Neve. A separate non-touch Chromium context checks keyboard help. Visits do not change the stored preferences. Scrolling uses `scrollIntoViewIfNeeded`, so native finger scrolling is not certified.

Media observations use weak references to avoid retaining retired audio elements. Original media-source creation/disconnection calls retain their behavior. Supported engines must advance the actual lobby and battle media times without errors and leave only the replacement source connected after fading. All observed BGM responses must be 200/206, and online request failures remain failures. A local engine without Web Audio records the existing silent fallback instead of claiming playback.

A separate context per engine closes the owned preview server's TCP connections while its actual service worker handles navigation. The response must come from the service worker and explain the connection requirement. Restoring the server must return the online start button. This proves the connection shell and boot recovery, not a complete offline game or resumed battle.

Output is `work/mobile-settings-qa/report.json`, with source/build hashes and screenshots. The earlier broad PR36 matrix is retained as failed/partial at `work/pwa-mobile-pr36-original.json`: four Chromium flows passed their UI checks but each encountered a canceled lobby-media request. No cancellation allowlist was introduced and that report was not promoted. Separate direct/proxy playback diagnostics cannot establish the cause of those original cancellations; final candidate evidence remains distinct.

Actual Android/iPhone installation, native gestures, physical FPS/heat, audible speaker output, real-network party completion, and store/payment/ad release remain unverified. Source review and local engine results are not certification of every mobile browser.
