# Third-party CC0 runtime assets

## Poly Haven — Medieval Wall 02
- Asset: `Medieval Wall 02`
- Author: Rob Tuytel
- Source: https://polyhaven.com/a/medieval_wall_02
- License: CC0 1.0 / public domain dedication. Poly Haven states its assets may be used for any purpose, including commercial use.
- Runtime scope: dungeon region stone architecture only. Lobby sanctuary and character materials keep their authored surface maps.
- Resolution: 1K JPG to bound mobile download/GPU cost.

### Shipped files
- `public/img/materials-cc0/polyhaven-medieval-wall-02-diffuse-1k.jpg` — MD5 `35394495938c916ea291e11e718c2a6d`
- `public/img/materials-cc0/polyhaven-medieval-wall-02-normal-gl-1k.jpg` — MD5 `9f90bd2c03ed28c69f4e2ca6e7435117`
- `public/img/materials-cc0/polyhaven-medieval-wall-02-rough-1k.jpg` — MD5 `c8dcc8032e4a17fa80cc5b44f75d2e49`

The exact hashes above are checked by `test/cc0-materials.test.ts` so an unrelated file cannot silently replace the reviewed CC0 source.

## Kenney — Impact Sounds 1.0 · RPG Audio 1.0 (타격 2레이어·처치·콤보 hit-v2)
- Author: Kenney Vleugels (Kenney.nl)
- License: CC0 1.0 (`License.txt` of each pack, 원문은 `public/sfx/hit-v2/LICENSE.txt` 에 동봉)
- Impact Sounds: https://kenney.nl/assets/impact-sounds — 원본 zip `https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip` SHA256 `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`
- RPG Audio: https://kenney.nl/assets/rpg-audio — 원본 zip `https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip` SHA256 `6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b`
- Runtime scope: 전투 타격음(트랜지언트+바디), 처치 확정음, 콤보 10/25/50 스팅어. 원본 ogg 를 자르고 필터·피치·레이어링하고 자체 합성(사인 서브·종소리·노이즈 라이저)을 더해 mono 44.1kHz MP3 128k 로 정규화한 가공물이다. 가공물도 CC0 로 취급하며 생성형 서비스·유료 API·음성 모델은 쓰지 않았다.
- 재현: `python3 tools/audio/build-hit-library.py` (원본 zip 은 위 SHA256 으로 검증한다). 실제 이득표 기준 오프라인 렌더 수치: `python3 tools/audio/measure-hit-mix.py`.
- Shipped: `public/sfx/hit-v2/*.mp3` 35개, 합계 271,526 bytes. 파일별 SHA256·피크·RMS·온셋은 `public/sfx/hit-v2/manifest.json`, 검증은 `test/hit-sound-layers.test.ts`.

### 사용한 원본 파일 (이름 · 팩 · SHA256)
- `impactBell_heavy_000.ogg` (impact) — SHA256 `94b8bb5f2d43ab65e4bcc32b28562416e9bc2c51d9fd4be1e333660ee52f977f`
- `impactBell_heavy_001.ogg` (impact) — SHA256 `9df61e3ae9a83dc65e5a1fd3ed19d480876f3b22b963a1b9ef6fa293592dcec4`
- `impactBell_heavy_002.ogg` (impact) — SHA256 `a4171ed1a4a17fb858a38de1c59b5b42e50d8f046c525706c0e3ac8671f189f5`
- `impactBell_heavy_003.ogg` (impact) — SHA256 `5572ccdeb3b62373b86fa955355b3a222c36e815f0636ba16165189a21cf2514`
- `impactBell_heavy_004.ogg` (impact) — SHA256 `49fe4fafa2001bd0d312976796824571ca8429851f285997e1327d17bb34fd00`
- `impactGeneric_light_001.ogg` (impact) — SHA256 `c3cd1c073d186ae8fa35788ba94de581f1826e7427a7bb26490b2695fac18efa`
- `impactGlass_heavy_000.ogg` (impact) — SHA256 `b44b39a940e8948e74b9bd3776bff980df43cf220abdaf0d467dc4c43c0244a5`
- `impactGlass_heavy_001.ogg` (impact) — SHA256 `58686e0e562612cc566791844a10e269f8d1921f4766c14ba43976fd0a429f4e`
- `impactGlass_heavy_002.ogg` (impact) — SHA256 `4978654ac840ad519692d5d5ba48a8101cabce13b9a577be73ad589185e5e9ed`
- `impactGlass_heavy_003.ogg` (impact) — SHA256 `aed07b154f24410c17e5262bbef832842fb275d41fe297f721af7501d0e9c23a`
- `impactGlass_heavy_004.ogg` (impact) — SHA256 `c7742b0e33c1733ddaf902aa68464a4f5364e4d4cb6ff11b76a7aa4151a138dd`
- `impactGlass_light_000.ogg` (impact) — SHA256 `d750cf88097d0c3e69920e6e14496e1444e1a9da01aa4cca8f5ec8cb44c57b4f`
- `impactGlass_light_001.ogg` (impact) — SHA256 `05e513fbd42829060eb37855f8c3866722ec5c39a8937c9bfde518cc609effa2`
- `impactGlass_medium_000.ogg` (impact) — SHA256 `9252d50bfb85edb17d6073c4a7806e10cdb9de56d3dbfc93a4b9727146d2df6d`
- `impactGlass_medium_001.ogg` (impact) — SHA256 `d3d806cb3012c9ddd87010b30295ccb74d6d8b690077d19e67afd09a9d8feb03`
- `impactGlass_medium_002.ogg` (impact) — SHA256 `48616f22c95589ed9fe55babf0fd012721d7b2ef1b9e85c2ad6408a2cd7c164f`
- `impactMetal_heavy_000.ogg` (impact) — SHA256 `e07045693e4a2b3d165c424e3dab4c781d9ff8880a386880ac89a51315d7f831`
- `impactMetal_heavy_001.ogg` (impact) — SHA256 `83554049f81f4db9209379e103c30bfa63f65c42189a03f300b045c2c82e23ae`
- `impactMetal_heavy_002.ogg` (impact) — SHA256 `b914c8f1eb7c0f34bb165d7c77f4be0351f6be0660c13c53e65424e262e2c093`
- `impactMetal_heavy_003.ogg` (impact) — SHA256 `b0f2ba4dabde9a87eb9c188a19d31e0c2300fd321adeba08d3b9b8aa011d7037`
- `impactMetal_heavy_004.ogg` (impact) — SHA256 `6d65b463c0555dd5be16b8db6d2cbe23a94e07a4637779b8ad17d0db3e500a87`
- `impactMetal_light_000.ogg` (impact) — SHA256 `33b5e6e37c6e9d54e07bf5a89b12c76e879f40c1ea83cdd82714df1d6f9fec6d`
- `impactMetal_light_001.ogg` (impact) — SHA256 `fba69c467ddd85da7b1d82e259f936b876d9ba6a3d6f1b24bdd10468e46bfe08`
- `impactMetal_light_002.ogg` (impact) — SHA256 `25a96f90a9a1f88a531e824e126f0519504625e5635e65a72e4f31611428db29`
- `impactMining_000.ogg` (impact) — SHA256 `36b4ea107222d073c67ca64dde26944975609202d5090b2f2021213c1a7e35cd`
- `impactMining_001.ogg` (impact) — SHA256 `61235a18de3f3d92118235398222dbf51d448f1be70b1c8bc962b10b86f2d9c6`
- `impactPlate_heavy_000.ogg` (impact) — SHA256 `112d4f93ddcc370b410630f971c0f5d991856102da9c76bc5c5540d388e75aaa`
- `impactPlate_heavy_001.ogg` (impact) — SHA256 `142fd6c77f13d25f318265901163f70f8dfe12f87829169a570025be43de7011`
- `impactPlate_heavy_002.ogg` (impact) — SHA256 `b0cab75d1befa32b4cf215d8ee7e1c400a39182e8b105963b8e310f825b198a1`
- `impactPlate_light_000.ogg` (impact) — SHA256 `6e797cf8a5bfc52d7ed5eb47c227974c1cf2a674954fec5b539cea7d62c7282c`
- `impactPlate_light_001.ogg` (impact) — SHA256 `947915c2eb6ac57ee08fd3a48b297fd108d69abc72076e79882c21cad0eef56e`
- `impactPunch_heavy_000.ogg` (impact) — SHA256 `b33a8f14068aec24ec69ba85e5e87fdc41228975f6a1a3e44a6e7d6fc3d9f8d8`
- `impactPunch_heavy_001.ogg` (impact) — SHA256 `f92f5cb6ba4ff2766497292ffd90865654317eeca976f5652e0708dbdcdc0dd9`
- `impactPunch_heavy_002.ogg` (impact) — SHA256 `7993dd4c156b9979ad69f17be5ebe31850b16039a3857f8477141be54dfee1b3`
- `impactPunch_heavy_003.ogg` (impact) — SHA256 `4ab53b26f4ea575120dcc1348526c9e0db2afc6af7a442aa0489bdead2ca80b6`
- `impactPunch_heavy_004.ogg` (impact) — SHA256 `f4c0c3eb8ab6517583b8218ed03f28923d1b687379aab4c1d5a6d4c10cf8e500`
- `impactPunch_medium_000.ogg` (impact) — SHA256 `486988aa2d6440ffc4c62a0e8ccf3c23673ba84424bd4723378d451b7255eb5c`
- `impactPunch_medium_001.ogg` (impact) — SHA256 `e71d23abcc3f10d9d6bc9615b2a431fff70b12333a5fcdd9964457564ace4349`
- `impactPunch_medium_002.ogg` (impact) — SHA256 `6492f9ccbc8d24dcef607bb1b48790b7870961474561f7fe5601e1c73a3018ef`
- `impactPunch_medium_003.ogg` (impact) — SHA256 `2d7c719c05999e0532f4384e1018e04cd916db715140bf16dee2dff3f820e908`
- `impactPunch_medium_004.ogg` (impact) — SHA256 `4a256878a3afb994ec9a4399336687748e68c7c136872c08c9c797d8c4e2464a`
- `impactSoft_heavy_000.ogg` (impact) — SHA256 `49e7ca88743fca974bb8676ea138b751cfd8f9033b5e7af8736c2a215d6edbc1`
- `impactSoft_heavy_001.ogg` (impact) — SHA256 `4d0096364ba9e46119d2ff6df493fdc101bd2e1efae061da5e5f77a53b3fdcb6`
- `impactSoft_medium_000.ogg` (impact) — SHA256 `7d3ba0bb5e60a11b5d3e558c141303dcf494256675fbf753c0d252d2cf0481e3`
- `impactSoft_medium_001.ogg` (impact) — SHA256 `7642a4fd43e547afe4f7adfadb3dabb681c0ff512f52c1674bae30a726841faf`
- `impactTin_medium_000.ogg` (impact) — SHA256 `f4bbee66ca191ec744b84fc07ac9ed2a6fda955d51cfed8360f12b62815d3cbd`
- `impactWood_heavy_000.ogg` (impact) — SHA256 `15ff82332f342c30e469215539e1cc57e11b221aa2cf7e11e811d313a9927f3d`
- `impactWood_heavy_001.ogg` (impact) — SHA256 `f1b07a53ac10c615fff9ba470511fdeb722b5902e1a8520759fc20ad6f546015`
- `impactWood_light_000.ogg` (impact) — SHA256 `eb45e35b4bed784d3f120de4afec4b0d6ac09d9e143cce8cfcb7d739e1b1f3c3`
- `impactWood_light_001.ogg` (impact) — SHA256 `4b76bf3ccc8e60d19188f3165b778a7817786faa6887c55d9049bcbeef3b425f`
- `knifeSlice.ogg` (rpg) — SHA256 `4cd96dc630bed9840c15f1dd2306da2cc56a4da26a5d3f1a03c5a7265ac5e54f`
- `knifeSlice2.ogg` (rpg) — SHA256 `6c2064d0ef988d1ec3d56868e823ea8823a5cac00f2742560052633529407def`
