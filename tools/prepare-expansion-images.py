"""Package observed GUI originals without changing composition; preserve source files."""
import hashlib, json, shutil, subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('C:/Users/ADMINI~1/AppData/Local/Temp/browser-use/assets/ce2222a5-431a-4dec-98ca-9b51d468701d')
PAIRS = [('glass_garden','65d5bd1d7dd405d4'),('ember_vault','6ba0b4b30a0aa75d'),('star_archive','8bb230a89d09bb7d'),('arena','f014ff40f801e0dc'),('guardian','aada582f58fca90c'),('ranger','06b83629990d203f'),('hp_tonic','7f896e68fa02ae1e'),('overdrive','f36a3f7dd29b6697'),('aegis','74ae34da7a9d759e'),('guild_map','2fcd979bd47cf261')]
originals = ROOT / 'work/media-evidence/gui-originals'
dest = ROOT / 'public/img/expansion'
originals.mkdir(parents=True, exist_ok=True)
dest.mkdir(parents=True, exist_ok=True)
assets = []
for i,(name,key) in enumerate(PAIRS,1):
    src = SOURCE / key
    with Image.open(src) as im:
        width,height=im.size
        suffix=im.format.lower()
    original=originals/f'{name}.{suffix}'
    shutil.copyfile(src,original)
    out=dest/f'{name}.webp'
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(original),'-frames:v','1','-c:v','libwebp','-quality','88',str(out)],check=True)
    assets.append({'id':f'set-01-shot-{i:02}','usage':name,'path':str(out.relative_to(ROOT)).replace('\\','/'),'originalPath':str(original.relative_to(ROOT)).replace('\\','/'),'pixelSize':f'{width}x{height}','bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'originalSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'classification':'independent-single','visualInspection':'one scene or one isolated object; no panels; inspected by primary'})
assert len({a['originalSha256'] for a in assets})==10
manifest={'route':'chatgpt-web-iab','chatUrl':'https://chatgpt.com/c/6aa11062-3f78-83e9-afb8-8c7601549bd5','modelDisplayed':'6 Pro','planDisplayed':'Pro','quotaObserved':'unknown','directorImageCount':10,'batchRequestCount':1,'repairBatchRequestCount':0,'browserTabsUsed':1,'chatSessionsUsed':1,'requestedJobs':10,'uiRenderedImageElements':31,'uniqueContentAssets':10,'independentSingleAssets':10,'contactSheets':0,'jobsReturned':10,'jobsSaved':10,'serialOverrideReason':None,'assets':assets,'status':'verified','note':'UI displays repeated thumbnails; ten distinct downloaded originals. Generated assets, not claimed CC0. Original composition preserved; WebP encoding for delivery.'}
(dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'independent':10,'originalBytes':sum((originals/f'{n}.{Image.open(SOURCE/k).format.lower()}').stat().st_size for n,k in PAIRS),'shippedBytes':sum(a['bytes'] for a in assets)},ensure_ascii=False))
