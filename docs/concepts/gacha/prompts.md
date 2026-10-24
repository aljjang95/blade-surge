# Hero summon screen concepts - prompts (landscape 16:9, Codex CLI image generation)

Reference images: current game lobby + gear detail screenshots (UI kit match). Output 1672x941.

## Variant A - Throne Gate - gacha-a-throne-gate.png

Direction prompt:
```
SAVE TO: gacha-a-throne-gate.png
Direction A "왕좌의 문": a colossal ancient stone gate with carved reliefs is swinging open in the center, a blinding golden pillar of light pours out, and the pickup SSR hero (armored holy knight with a greatsword, name banner "SSR 성기사 아르카디아", gold SSR emblem) steps out of the light in the center. Classic high-fantasy, marble and gold, floating embers, dark stone throne hall around, rays and sparkles.
```

## Variant B - Star Altar - gacha-b-star-altar.png

Direction prompt:
```
SAVE TO: gacha-b-star-altar.png
Direction B "별의 제단": a night sky full of constellations over a circular star altar with glowing rune rings. This is the SSR reveal moment: summon cards fly in and flip over in mid-air, one huge golden SSR card (hero: starlight mage girl with a staff, "SSR 별빛 마법사") at the center with a gold burst. On the right side a partial 10-pull result grid (a 5x2 grid of small cards, mostly blue/purple with one gold SSR card, partially visible beside the buttons). Deep indigo and gold palette, shooting stars.
```

## Variant C - Blood Moon Halloween pickup - gacha-c-blood-moon.png

Direction prompt:
```
SAVE TO: gacha-c-blood-moon.png
Direction C "핏빛 달 할로윈 픽업": Halloween season limited pickup banner. A giant blood-red full moon behind, purple mist and fog, bats, jack-o-lanterns and tattered orange banners at the edges. Center: the SSR pickup hero, a werewolf chieftain (huge muscular wolf warrior with tribal armor and a bone axe, glowing eyes, name banner "SSR 늑대인간 족장", gold SSR emblem). A prominent red-gold badge "기간 한정 · 할로윈 픽업" with a timer "D-14". Pickup rate-up text "SSR 픽업 확률 UP". Spooky but cute-stylized, gold SSR glow cutting through the purple.
```

## Common prompt (appended to every variant)

```
Use your built-in image generation tool to create ONE image, then save the generated PNG file to the exact absolute path given at the top (copy it from wherever the tool writes it; create the folder if missing). Do not write any code, do not draw it with scripts, do not edit repository files. After saving, reply with only the saved path and its pixel size.

Format: LANDSCAPE 16:9 (about 1920x1080), a real in-game screenshot of the mobile LANDSCAPE 3D hack-and-slash RPG "Blade Surge", gacha screen "영웅 소환" (hero summon). No device frame, no hands, no watermark, not a poster. Dark fantasy mood with golden SSR glory effects. Korean UI text (keep labels short; imperfect glyphs acceptable).
Landscape layout (all variants): TOP bar: currency chips (보석 3,200 / 소환권 12) and a back button on the top-left. LEFT: vertical list of 3 banner tabs (영웅 소환 selected with gold border, 장비 소환, 초보자). CENTER: huge pickup SSR hero illustration. RIGHT-BOTTOM: two buttons side by side, cream "1회 300 보석" and orange "10회 2,700 보석". Above the buttons a pity bar text: "SSR 확정까지 80회" and a smaller line "픽업 실패 시 다음 SSR 픽업 확정". Small round "확률 정보" button near the bottom-left of the center. UI kit matches the attached reference screenshots of the current game: deep teal/navy rounded panels with thin gold borders, cream and orange buttons, chunky friendly Korean sans-serif labels with dark outline, stylized low-poly chibi 3D look. Do not cover the hero's face with UI.
```

## Variant C2 - Blood Moon Halloween pickup, chibi redo - gacha-c2-blood-moon-chibi.png

C안의 늑대인간이 사실풍이라 반려되어, A안(gacha-a-throne-gate.png)을 참조 이미지(`-i`)로 붙여 같은 치비 그림체로 재생성. Codex CLI 이미지 생성, 출력 1672x941. 공통 프롬프트(위 Common prompt)는 이 프롬프트 안에 포함되어 있다.

```
SAVE TO: gacha-c2-blood-moon-chibi.png
Direction C2 "핏빛 달 할로윈 픽업 (치비 그림체)": Redo of the Halloween pickup banner in EXACTLY the same art style as the attached reference image (gacha-a-throne-gate.png): cute chibi proportions (big head, short stubby body, about 2.5 heads tall), soft stylized 3D-painted look, clean rounded shapes, bright golden highlights and warm gold rim light, friendly and charming, NOT realistic, NOT gritty. Do not copy the reference's gate or knight; only copy its art style, rendering, proportions, lighting and UI polish.
Scene: a giant blood-red full moon behind, purple mist and fog, small cute bats, glowing jack-o-lanterns and tattered orange banners at the edges. Center: the SSR pickup hero, a CUTE CHIBI werewolf chieftain (big round head with fluffy fur, big shiny eyes with a fierce-but-adorable expression, small fangs, short stubby body, tribal armor with feather and bone decorations, holding a chunky bone axe, glowing golden eyes), with a golden SSR glow cutting through the purple mist. Name banner under him: "늑대인간 족장" with a gold SSR emblem next to it. A prominent red-gold badge near the top-center: "기간 한정 · 할로윈 픽업".
Layout: LEFT vertical list of 3 banner tabs: "영웅 소환" (selected, gold border), "장비 소환", "초보자". RIGHT-BOTTOM: a pity (ceiling) panel with a progress bar "SSR 확정까지 80회", a smaller line "픽업 실패 시 다음 SSR 픽업 확정", and "마일리지 0/200"; below it two buttons side by side, cream "1회 300 보석" and orange "10회 2,700 보석". LEFT-BOTTOM: a small round "확률 정보" button. TOP bar: currency chips (보석 3,200 / 소환권 12) and a back button at the top-left. Do not cover the hero's face with UI.
Format: LANDSCAPE 16:9, in-game screenshot of "Blade Surge" gacha screen "영웅 소환". No device frame, no hands, no watermark, not a poster. Korean UI text must be crisp and correctly spelled. UI kit: deep teal/navy rounded panels with thin gold borders, cream and orange buttons, chunky friendly Korean sans-serif labels with dark outline, matching the reference.
```
