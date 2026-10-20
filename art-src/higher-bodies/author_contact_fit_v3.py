"""상위 몸체 접촉 v3. 정확 contact05에서 승인된 뒤자락/낮은 목도리 형상과 국소 다리 paint를 저작한다."""
import hashlib
import heapq
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, 'C:/Users/heart/.codex/skills/blender-headless/scripts/tasks')
from _common import task_args, run, file_record

CONTACT_AUTHOR_SHA = '55f1f5b2adf6690718141bb7ab3a7c96d2e584b8168759f7f92d61c9e1813a43'
CONTACT_SHA = {'hero_ranger_t2': '539963fe3681d219e7ad9408d0aaf366dc2d32a83909fc5c03f465f15cfea915', 'hero_ranger_t3': '3c63985a59460b7268c06e46b4887d743fe604f39e8895987af7a0ff2173c9bf', 'hero_rogue_t2': '27b9d3f49467a99850a895d092e1379fec499f2641d70b41c55188444228962c', 'hero_rogue_t3': 'b06f84493ee72001d0263f072b9dd8d6860979a5bb7d89d498f12508bcada66e', 'avatar_rogue_crow': '4634829667eb76feea482dc7012dfdb3fcbe65ab12d36220177a93fa99853d5f'}
SEEDS = {'hero_rogue_t2': {'rearcoat': [15937, 15792, 14622, 16295, 8351, 13580], 'scarf': [1961]},
         'hero_rogue_t3': {'rearcoat': [14666, 14140, 15724, 443, 6455], 'scarf': [15274]}}
PARAMS = {'coatBoundaryWidth': {'hero_rogue_t2': .20, 'hero_rogue_t3': .20}, 'scarfBoundaryWidth': .10, 'coatHem': .17, 'coatXScale': .82, 'coatPosteriorScale': .78,
          'coatLateralFade': {'hero_rogue_t2': [.10, .24], 'hero_rogue_t3': [.12, .26]}, 'coatFrontXZScale': .5, 'coatYCutoff': .70, 'coatTopStart': .30, 'coatPosteriorStart': .10, 'coatPosteriorWidth': .30,
          'scarfXCutoff': .50, 'scarfXFull': .65, 'scarfYFull': {'hero_rogue_t2': .65, 'hero_rogue_t3': .55}, 'scarfYCutoff': .95,
          'scarfAnchors': {'hero_rogue_t2': [1961, 7263], 'hero_rogue_t3': [15274, 8040]},
          'coatMaximumMove': .25, 'scarfMaximumMove': .30, 'maximumCoatXZMove': .12,
          'softSaturation': {'linearEnd': .10, 'constantStart': .14, 'maximum': .12},
          'localStroke': {'asset':'hero_rogue_t2','seed':9535,'peak':.035,'radius':.25,'boundaryWidth':.10},
          'weightRepair': {'minimumOwnMass': .5, 'oppositeLimit': .14, 'formula': 'transfer (opposite-.14)*semanticAlpha to existing own leg slots proportionally; Hips exact'}}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def load_module(name, path, exact_sha):
    require(sha(path) == exact_sha, '읽기 전용 helper SHA 불일치: '+str(path))
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_args(parser):
    parser.add_argument('--repo', required=True)
    parser.add_argument('--contact-dir', required=True)
    parser.add_argument('--out-dir', required=True)


def bone_world(lib, data, suffix):
    ni = next(i for i in data['skin']['joints'] if lib.canon_name(data['doc']['nodes'][i].get('name', '')) == 'mixamorig'+suffix)
    return data['world'][ni].translation.copy()


def validate_input(original, data):
    # 정확 SHA 외에도 원본 대비 v2 허용 성분 이외 바이트가 같은지 확인한다.
    before, after = original['doc'], json.loads(json.dumps(data['doc']))
    pa = original['attributes']['POSITION']
    for key in ['min', 'max']:
        if key in before['accessors'][pa]: after['accessors'][pa][key] = before['accessors'][pa][key]
        else: after['accessors'][pa].pop(key, None)
    require(after == before, 'contact05 POSITION bounds 밖 JSON 변경')
    allowed = set()
    for field in ['POSITION', 'NORMAL', 'WEIGHTS_0']:
        a = before['accessors'][original['attributes'][field]]; v = before['bufferViews'][a['bufferView']]
        width = 4 if field == 'WEIGHTS_0' else 3
        start = v.get('byteOffset', 0)+a.get('byteOffset', 0); stride = v.get('byteStride', width*4)
        for i in range(a['count']): allowed.update(range(start+i*stride, start+i*stride+width*4))
    require(len(original['binary']) == len(data['binary']), 'contact05 BIN 길이 변경')
    require(all(a == b or i in allowed for i, (a,b) in enumerate(zip(original['binary'], data['binary']))), 'contact05 원본 허용 성분 밖 BIN 변경')
    require(original['rows']['JOINTS_0'] == data['rows']['JOINTS_0'], 'contact05 JOINTS 변경')
    return {'exactInputSha': True, 'originalOutsidePositionNormalWeightsExact': True}


def coat_envelope(lib, original, asset, point):
    # 발/무릎/대퇴 축을 C1로 잇고 실제 옷자락인 축 바깥쪽만 fade한다.
    centers = {}
    for side in ['Left', 'Right']:
        foot, knee, hip = [original['bones64']['mixamorig'+side+suffix] for suffix in ['Foot', 'Leg', 'UpLeg']]
        require(foot[1] < knee[1] < hip[1], '다리 축 Y 순서 오류')
        centers[side] = foot[0]+(knee[0]-foot[0])*lib.smooth((point[1]-foot[1])/(knee[1]-foot[1]))+(hip[0]-knee[0])*lib.smooth((point[1]-knee[1])/(hip[1]-knee[1]))
    distance = max(0., point[0]-centers['Left'], centers['Right']-point[0])
    inner, outer = PARAMS['coatLateralFade'][asset]
    lateral = lib.smooth((distance-inner)/(outer-inner))
    posterior = lib.smooth((original['bones64']['mixamorigHips'][2]-point[2]-.10)/.30)
    return {'lateralDistance': distance, 'lateral': lateral, 'posterior': posterior,
            'outside': 1-(1-lateral)*(1-posterior), 'xzScale': .5+.5*posterior}


def semantic_mask(v2, lib, original, asset):
    if asset not in SEEDS: return [], {'rearcoat': [], 'scarf': []}
    points, rows, names = original['rest64'], original['rows'], original['names']
    graph = [set() for _ in points]
    for face in original['faces']:
        for a,b in [(face[0],face[1]),(face[1],face[2]),(face[2],face[0])]: graph[a].add(b); graph[b].add(a)
    seams = {}
    for i,p in enumerate(rows['POSITION']):
        key = tuple(round(x, 6) for x in p)
        if key in seams: j=seams[key]; graph[i].add(j); graph[j].add(i)
        else: seams[key]=i
    lower_names = {'mixamorigHips','mixamorigLeftUpLeg','mixamorigRightUpLeg','mixamorigLeftLeg','mixamorigRightLeg'}
    scarf_names = {'mixamorigHead','mixamorigNeck','mixamorigLeftShoulder','mixamorigLeftArm'}
    allowed = {'rearcoat': set(), 'scarf': set()}
    for i,p in enumerate(points):
        influences = {lib.canon_name(names[j]) for j,w in zip(rows['JOINTS_0'][i],rows['WEIGHTS_0'][i]) if w>1e-8}
        if influences <= lower_names and p[1]<.70: allowed['rearcoat'].add(i)
        if influences <= scarf_names and influences & {'mixamorigHead','mixamorigNeck'} and p[0]>.50 and p[1]<.95: allowed['scarf'].add(i)
    masks, regions = [], {}
    hips = original['bones64']['mixamorigHips']
    for region in ['rearcoat','scarf']:
        permitted = allowed[region]; seeds=SEEDS[asset][region]
        require(all(i in permitted for i in seeds), 'semantic seed 허용 영역 밖: '+region)
        connected=set(seeds); pending=list(seeds)
        while pending:
            i=pending.pop()
            for j in graph[i]:
                if j in permitted and j not in connected: connected.add(j); pending.append(j)
        regions[region]=sorted(connected)
        width=PARAMS['coatBoundaryWidth'][asset] if region=='rearcoat' else .10
        scarf_y=PARAMS['scarfYFull'][asset]
        distances=v2.boundary_distances(original, connected, width)
        for i in sorted(connected):
            p=points[i]; boundary=lib.smooth(distances[i]/width)
            envelope=coat_envelope(lib,original,asset,p) if region=='rearcoat' else None
            factors=[boundary, 1-lib.smooth((p[1]-.30)/.40), envelope['outside']] if region=='rearcoat' else [boundary,lib.smooth((p[0]-.50)/.15),1-lib.smooth((p[1]-scarf_y)/(.95-scarf_y))]
            alpha=math.prod(factors)
            if alpha>1e-10: masks.append({'vertex':i,'region':region,'alpha':alpha,'factors':factors,'boundaryDistance':distances[i] if math.isfinite(distances[i]) else None, 'envelope':envelope})
    require(set(regions['rearcoat']).isdisjoint(regions['scarf']), '의상 의미영역 중복')
    return sorted(masks,key=lambda r:r['vertex']), regions


def soft_saturate(value):
    q=abs(value)
    if q<=.10: return value
    if q>=.14: return math.copysign(.12,value)
    u=(q-.10)/.04
    return math.copysign(.10+.04*(u-.5*u*u),value)


def coat_weights(lib, data, original, masks):
    final=[list(w) for w in data['rows']['WEIGHTS_0']]; records=[]
    allowed={'mixamorigHips','mixamorigLeftUpLeg','mixamorigLeftLeg','mixamorigRightUpLeg','mixamorigRightLeg'}
    hips=original['bones64']['mixamorigHips']
    for mask in masks:
        if mask['region']!='rearcoat': continue
        i=mask['vertex']; old=data['rows']['WEIGHTS_0'][i]; js=data['rows']['JOINTS_0'][i]
        names=[lib.canon_name(data['names'][j]) for j in js]
        side='Left' if original['rest64'][i][0]>hips[0] else 'Right'; other='Right' if side=='Left' else 'Left'
        own=[n in {'mixamorig'+side+'UpLeg','mixamorig'+side+'Leg'} for n in names]
        opposite=[n in {'mixamorig'+other+'UpLeg','mixamorig'+other+'Leg'} for n in names]
        own_mass=sum(w for w,b in zip(old,own) if b); opposite_mass=sum(w for w,b in zip(old,opposite) if b)
        hip_mass=sum(w for w,n in zip(old,names) if n=='mixamorigHips')
        if own_mass<=.5 or opposite_mass<=.14 or hip_mass<=1e-8: continue
        require(all(w<=1e-8 or n in allowed for n,w in zip(names,old)),'coat weight 허용 본 밖')
        removed=(opposite_mass-.14)*mask['alpha']
        new=[f32(w-removed*w/opposite_mass if op else w+removed*w/own_mass if ow else w) for w,op,ow in zip(old,opposite,own)]
        require(all(0<=w<=1.000001 for w in new) and abs(sum(new)-sum(old))<=2e-7,'coat 새 가중치 합/범위')
        require(all(a==b for a,b,n in zip(old,new,names) if n=='mixamorigHips'),'Hips 가중치 변경')
        if new==old: continue
        final[i]=new
        records.append({'vertex':i,'region':'rearcoat-own-leg','side':side,'alpha':mask['alpha'],'ownMass':own_mass,'oppositeMass':opposite_mass,'removed':removed,'old':old,'new':new,'jointNames':names})
    return final,records


def local_stroke(v2, lib, original, asset, regions):
    # 실제 coat seed에만 고정된 저작 stroke다. pose 최저 높이나 runtime 결과로 값이 바뀌지 않는다.
    if asset!=PARAMS['localStroke']['asset']: return []
    config=PARAMS['localStroke']; allowed=set(regions['rearcoat']); seed=config['seed']
    require(seed in allowed,'국소 stroke seed가 의상 영역 밖')
    points=original['rest64']; edges=[{} for _ in points]
    def edge(a,b,length):
        edges[a][b]=min(edges[a].get(b,math.inf),length);edges[b][a]=min(edges[b].get(a,math.inf),length)
    for face in original['faces']:
        for a,b in [(face[0],face[1]),(face[1],face[2]),(face[2],face[0])]: edge(a,b,math.dist(points[a],points[b]))
    seams={}
    for i,p in enumerate(original['rows']['POSITION']):
        key=tuple(round(x,6) for x in p)
        if key in seams:edge(i,seams[key],0.)
        else:seams[key]=i
    distance=[math.inf for _ in points];distance[seed]=0.;queue=[(0.,seed)]
    while queue:
        length,i=heapq.heappop(queue)
        if length!=distance[i] or length>=config['radius']:continue
        for j,step in edges[i].items():
            if j not in allowed:continue
            candidate=length+step
            if candidate<distance[j]:distance[j]=candidate;heapq.heappush(queue,(candidate,j))
    boundary=v2.boundary_distances(original,allowed,config['boundaryWidth']);rows=[]
    for i in sorted(allowed):
        factors=[lib.smooth(1-distance[i]/config['radius']),lib.smooth(boundary[i]/config['boundaryWidth'])];alpha=math.prod(factors)
        if alpha>1e-10:rows.append({'vertex':i,'alpha':alpha,'factors':factors,'geodesicDistance':distance[i],'boundaryDistance':boundary[i] if math.isfinite(boundary[i]) else None,'deltaY':config['peak']*alpha})
    require(any(r['vertex']==seed and abs(r['deltaY']-config['peak'])<1e-10 for r in rows),'stroke seed peak 불일치')
    return rows


def precise_arm_records(v2, lib, data, reference):
    # 마스크/curve landmark는 양쪽 모두 decoded glTF Float64만 사용한다.
    # 실제 Bpy Float32 REST 일치 여부는 기존 actual parity gate에서 별도로 검증한다.
    hips, ref_hips = data['bones64']['mixamorigHips'], reference['bones64']['mixamorigHips']
    records = {}
    for side, sign in [('Left', 1), ('Right', -1)]:
        source, target = v2.precise_anchors(lib, data, side), v2.precise_anchors(lib, reference, side)
        shoulder, hand = data['bones64']['mixamorig'+side+'Arm'], data['bones64']['mixamorig'+side+'Hand']
        start = sign*(shoulder[0]-hips[0])
        common_x = [start]+[sign*(source[k]['point'][0]-hips[0]) for k in ['elbow','wrist']]
        common_y = [start]+[sign*(target[k]['point'][0]-ref_hips[0]) for k in ['elbow','wrist']]
        base_x = common_x+[sign*(source['Middle']['point'][0]-hips[0])]
        base_y = common_y+[sign*(target['Middle']['point'][0]-ref_hips[0])]
        shared = lib.pchip_slopes(base_x,base_y); shared[0] = 1.
        transverse = {}
        for axis in [1,2]:
            values = [0.]+[target[k]['point'][axis]-source[k]['point'][axis] for k in ['elbow','wrist','Middle']]
            slopes = lib.pchip_slopes(base_x,values); slopes[0] = 0.
            transverse[axis] = (values,slopes)
        protected_stop = start
        for i,p in enumerate(data['rest64']):
            js,ws = data['rows']['JOINTS_0'][i],data['rows']['WEIGHTS_0'][i]
            if p[1]>hips[1]+.10 and abs(p[2]-hand[2])<.20 and lib.arm_mass(data['names'],js,ws,side)>.5 and lib.protected_mass(data['names'],js,ws)>1e-8:
                protected_stop = max(protected_stop,sign*(p[0]-hips[0]))
        protected_stop += .005
        require(common_x[2]-protected_stop>=.08,'보호된 팔 경계 C1 fade 길이 부족: '+side)
        curves = {}
        for finger in lib.FINGERS:
            xs = common_x+[sign*(source[finger]['point'][0]-hips[0])]
            ys = common_y+[sign*(target[finger]['point'][0]-ref_hips[0])]
            require(all(b-a>1e-5 for a,b in zip(xs,xs[1:])),'손가락 anchor 순서 오류')
            secant = (ys[-1]-ys[-2])/(xs[-1]-xs[-2]);slopes = shared[:3]+[secant]
            require(secant>.05 and 0<slopes[2]<3*secant,'손가락 단조성 경계 오류')
            channels = [(xs,ys,slopes)]
            for axis in [1,2]:
                values,derivatives = transverse[axis]
                channels.append((xs,values[:3]+[target[finger]['point'][axis]-source[finger]['point'][axis]],derivatives[:3]+[0.]))
            for j in range(301):
                x = start+(xs[-1]-start)*j/300
                require((lib.hermite(*channels[0],x+1e-5)-lib.hermite(*channels[0],x-1e-5))/2e-5>.05,'팔 x 곡선 단조성 실패')
            curves[finger] = channels
        records[side] = {'source':source,'target':target,'curves':curves,'shoulderStart':start,'protectedFadeStart':protected_stop,'protectedFadeEnd':common_x[2],'handZ':hand[2],'sourceHipsX':hips[0],'referenceHipsX':ref_hips[0]}
    return records


def rogue_arm_fit(v2, lib, data, reference):
    # 읽기 전용 v2 anchor/단조 X 곡선을 재사용한다. 손가락별 YZ 차이로 web이 접히지 않게 Middle 곡선을 공유한다.
    hips = data['bones64']['mixamorigHips']
    records = precise_arm_records(v2,lib,data,reference)
    rows, deltas, normal_ids = [], {}, set()
    for i, before in enumerate(data['rest64']):
        js, ws = data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]
        if lib.protected_mass(data['names'], js, ws)>1e-8: continue
        if before[1]>hips[1]+.10 and max(lib.arm_mass(data['names'],js,ws,side) for side in ['Left','Right'])>.5: normal_ids.add(i)
        side = 'Left' if before[0]>=hips[0] else 'Right'; sign = 1 if side=='Left' else -1
        mass = lib.arm_mass(data['names'],js,ws,side); record=records[side]
        factors=[lib.smooth((mass-.5)/.5), lib.smooth((sign*(before[0]-hips[0])-record['protectedFadeStart'])/(record['protectedFadeEnd']-record['protectedFadeStart'])), lib.smooth((before[1]-hips[1]-.10)/.08), 1-lib.smooth((abs(before[2]-record['handZ'])-.12)/.08)]
        alpha=math.prod(factors)
        if alpha<=1e-10: continue
        fw={finger:sum(w for j,w in zip(js,ws) if lib.arm_suffix(data['names'][j],side).startswith('Hand'+finger)) for finger in lib.FINGERS}
        total=sum(fw.values());require(total<=1.000001,'손가락 가중치 합 초과');fw['Middle']+=max(0.,1-total)
        x=sign*(before[0]-hips[0]); middle=record['curves']['Middle']; mapped=[0.,0.,0.]
        for finger,weight in fw.items():
            values=[hips[0]+sign*lib.hermite(*record['curves'][finger][0],x), before[1]+lib.hermite(*middle[1],x), before[2]+lib.hermite(*middle[2],x)]
            for axis in range(3):mapped[axis]+=values[axis]*weight
        deltas[i]=[(mapped[k]-before[k])*alpha for k in range(3)]
        require(math.sqrt(sum(v*v for v in deltas[i]))<=.20,'팔 최대 이동 .20m 초과')
        rows.append({'vertex':i,'region':'arm','side':side,'alpha':alpha,'factors':factors,'armMass':mass})
    require(rows,'도적 팔 mask 없음')
    return rows,deltas,records,normal_ids


def author_asset(v2, low, lib, repo, contact_dir, out, contract):
    asset, hero, source_sha, count, _ = contract
    source_path=repo/'asset-library/normalized'/(asset+'.glb'); contact_path=contact_dir/(asset+'.glb')
    ref_id,ref_sha=low.REFERENCES[hero]; ref_path=repo/'asset-library/normalized'/(ref_id+'.glb')
    original=low.primitive_data(lib,source_path,source_sha,count)
    data=low.primitive_data(lib,contact_path,CONTACT_SHA[asset],count)
    reference=low.primitive_data(lib,ref_path,ref_sha)
    for item in [original,data,reference]:
        item['ibms64']=lib.read_accessor(item['doc'],item['binary'],item['skin']['inverseBindMatrices'])
        item['rest64'],item['bones64']=v2.precise_rest(item)
    input_scope=validate_input(original,data)
    reference_evidence=[]
    anchor_pairs={'hero_rogue_t2':[(15937,8065),(15792,7944),(14622,7944),(16295,8642),(1961,7263)],'hero_rogue_t3':[(14666,8065),(14140,7945),(15724,8846),(15274,8040)]}
    for source_id,reference_id in anchor_pairs.get(asset,[]):
        reference_evidence.append({'sourceVertex':source_id,'referenceVertex':reference_id,'sourceWorld':list(original['rest64'][source_id]),'referenceWorld':list(reference['rest64'][reference_id]),'distance':math.dist(original['rest64'][source_id],reference['rest64'][reference_id])})
    masks,regions=semantic_mask(v2,lib,original,asset)
    stroke_rows=local_stroke(v2,lib,original,asset,regions);stroke_by_id={r['vertex']:r for r in stroke_rows}
    arm_rows,arm_deltas,arm_records,arm_normal_ids=rogue_arm_fit(v2,lib,data,reference) if asset in SEEDS else ([],{},{},set())
    require(set(arm_deltas).isdisjoint(r['vertex'] for r in masks),'팔/의상 mask 중복')
    exception=set(regions['scarf']); eligible=set(regions['rearcoat'])|exception|arm_normal_ids
    original_protected={i for i in range(count) if low.protected_vertex(lib,original['names'],original['rows']['JOINTS_0'][i],original['rows']['WEIGHTS_0'][i])}
    protected=original_protected-exception
    for i in original_protected:
        require(original['rows']['POSITION'][i]==data['rows']['POSITION'][i] and original['rows']['NORMAL'][i]==data['rows']['NORMAL'][i] and original['rows']['WEIGHTS_0'][i]==data['rows']['WEIGHTS_0'][i], 'contact05 원본 보호 변경')
    actual,arm,import_info=low.import_body(lib,contact_path,data)
    expected=[lib.to_blender(p) for p in data['rest']]
    initial_parity=low.parity(lib,expected,low.evaluated_points(actual))
    require(len(actual.data.vertices)==count,'importer 정점 수 변경')
    original_uv=[[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers]
    original_loops=[loop.vertex_index for loop in actual.data.loops]
    bone_rest=[(b.name,[list(r) for r in b.matrix_local]) for b in arm.data.bones]
    corner_normals=[tuple(n.vector) for n in actual.data.corner_normals]
    final_weights,weight_rows=coat_weights(lib,data,original,masks)
    weight_ids={r['vertex'] for r in weight_rows}
    scarf_delta=None
    if asset in SEEDS:
        sid,rid=PARAMS['scarfAnchors'][asset]
        scarf_delta=[reference['rest64'][rid][k]-data['rest64'][sid][k] for k in range(3)]
    final_raw=[list(p) for p in data['rows']['POSITION']]; final_world=[p.copy() for p in data['rest']]
    position_rows=[]; hips=original['bones64']['mixamorigHips']
    base_mask_ids={r['vertex'] for r in masks}
    stroke_only=[{'vertex':r['vertex'],'region':'rearcoat-stroke','alpha':0.,'factors':[]} for r in stroke_rows if r['vertex'] not in base_mask_ids]
    for row in masks+arm_rows+stroke_only:
        i=row['vertex']; before=data['rest64'][i]
        delta=[soft_saturate((before[0]-hips[0])*(.82-1)), .17, soft_saturate((before[2]-hips[2])*(.78-1))] if row['region']=='rearcoat' else scarf_delta if row['region']=='scarf' else [0.,0.,0.]
        if row['region']=='rearcoat':
            delta[0]*=row['envelope']['xzScale']; delta[2]*=row['envelope']['xzScale']
        delta=arm_deltas[i] if row['region']=='arm' else [d*row['alpha'] for d in delta]
        if i in stroke_by_id:delta[1]+=stroke_by_id[i]['deltaY']
        require(math.sqrt(sum(d*d for d in delta))<=(.20 if row['region']=='arm' else .30 if row['region']=='scarf' else .25),'승인된 의상 최대 변위 초과')
        if row['region']=='rearcoat': require(max(abs(delta[0]),abs(delta[2]))<=.12,'뒤자락 XZ 변위 .12m 초과')
        after=Vector([before[k]+delta[k] for k in range(3)])
        require(i not in protected,'예외 밖 보호 geometry 변경')
        matrix=lib.weighted_matrix(data['rows']['JOINTS_0'][i],final_weights[i],data['matrices'])
        require(abs(matrix.determinant())>1e-10,'weighted REST 특이점')
        value=[f32(v) for v in (matrix.inverted() @ Vector((*after,1)))[:3]]
        require((lib.skin_world(value,data['rows']['JOINTS_0'][i],final_weights[i],data['matrices'])-after).length<=2e-6,'의상 REST 역변환 불일치')
        if value==data['rows']['POSITION'][i]: continue
        final_raw[i]=value; final_world[i]=after
        position_rows.append({**row,'old':data['rows']['POSITION'][i],'new':value,'restWorldBefore':list(before),'restWorldAfter':list(after),'delta':delta})
    changed={r['vertex'] for r in position_rows}; normal_eligible=eligible
    normal_rows,triangle_report=lib.corrected_normals(data['rows']['POSITION'],final_raw,data['rows']['NORMAL'],data['faces'],changed,normal_eligible,data['rows']['JOINTS_0'],data['rows']['WEIGHTS_0'],data['names']) if changed else ([],{'affectedTriangles':[],'minimumAreaRatio':1.,'minimumOldNewNormalDot':1.})
    tree = KDTree(count)
    for i, p in enumerate(expected): tree.insert(p, i)
    tree.balance()
    def weight_map(sid, values):
        result = {}
        for j, w in zip(data['rows']['JOINTS_0'][sid], values):
            name = lib.canon_name(data['names'][j]); result[name] = result.get(name, 0.)+w
        return result
    mapping = []
    for vertex in actual.data.vertices:
        p = actual.matrix_world @ vertex.co
        _, nearest_id, error = tree.find(p)
        require(error <= .0001, '실제 import 정점 대응 실패')
        actual_map = {lib.canon_name(actual.vertex_groups[g.group].name): g.weight for g in vertex.groups if g.weight > 1e-8}
        neighbors = tree.find_range(p, max(1e-6, error+1e-7))
        matching = []
        for _, candidate, _ in neighbors:
            expected_map = weight_map(candidate, data['rows']['WEIGHTS_0'][candidate])
            if all(abs(actual_map.get(n, 0.)-expected_map.get(n, 0.)) <= 2e-7 for n in set(actual_map)|set(expected_map)): matching.append(candidate)
        require(matching, '원본 위치와 가중치를 모두 만족하는 대응 정점 없음')
        sid = min(matching)
        desired_map = weight_map(sid, final_weights[sid])
        for other in matching:
            require((final_world[sid]-final_world[other]).length < 2e-5, '겹친 원본 정점의 피팅 결과 불일치')
            other_map = weight_map(other, final_weights[other])
            require(all(abs(desired_map.get(n, 0.)-other_map.get(n, 0.)) <= 2e-7 for n in set(desired_map)|set(other_map)), '겹친 원본 정점의 새 영향 불일치')
        mapping.append(sid)
    inverse_object = actual.matrix_world.inverted()
    for vertex, sid in zip(actual.data.vertices, mapping):
        if sid in changed: vertex.co = inverse_object @ lib.to_blender(final_world[sid])
    groups={lib.canon_name(g.name):g for g in actual.vertex_groups}
    for vertex,sid in zip(actual.data.vertices,mapping):
        if sid not in weight_ids: continue
        desired={}
        for j,w in zip(data['rows']['JOINTS_0'][sid],final_weights[sid]):
            name=lib.canon_name(data['names'][j]);desired[name]=desired.get(name,0.)+w
        for name,w in desired.items():
            require(name in groups,'기존 영향 group 누락')
            if w>0: groups[name].add([vertex.index],w,'REPLACE')
            else: groups[name].remove([vertex.index])
    # 새 본/슬롯은 만들지 않으며 아래에서 실제 Blender 가중치를 전수 검증한다.
    attr = actual.data.attributes.get('source_vertex_id') or actual.data.attributes.new('source_vertex_id', 'INT', 'POINT')
    for i, sid in enumerate(mapping): attr.data[i].value = sid
    actual.data.update(); actual.data.normals_split_custom_set(corner_normals)
    require(original_uv == [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers], 'Blender UV 변경')
    require(original_loops == [loop.vertex_index for loop in actual.data.loops], 'Blender topology 변경')
    require(bone_rest == [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones], 'Blender 본 REST 변경')
    for vertex, sid in zip(actual.data.vertices, mapping):
        desired = {}
        for j, w in zip(data['rows']['JOINTS_0'][sid], final_weights[sid]):
            name = lib.canon_name(data['names'][j]); desired[name] = desired.get(name, 0.)+w
        actual_weights = {lib.canon_name(actual.vertex_groups[g.group].name): g.weight for g in vertex.groups if g.weight > 1e-8}
        require(all(abs(actual_weights.get(n, 0.)-desired.get(n, 0.)) <= 2e-7 for n in set(actual_weights)|set(desired)), '실제 Blender 전정점 가중치 불일치')
    bpy.context.view_layer.update()
    final_parity = low.parity(lib, [lib.to_blender(p) for p in final_world], low.evaluated_points(actual))
    blend_path = out/(asset+'.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    patch={'schema':'blade-surge.higher-contact-patch.v3','asset':asset,'ok':True,
           'source':file_record(source_path),'contactInput':file_record(contact_path),'reference':file_record(ref_path),'author':file_record(__file__),
           'contactAuthorSha256':CONTACT_AUTHOR_SHA,'lowerAuthorSha256':v2.LOWER_AUTHOR_SHA,'helperSha256':low.HELPER_SHA,
           'inputScope':input_scope,'blender':bpy.app.version_string,'blend':file_record(blend_path),
           'restValidation':initial_parity,'blendValidation':final_parity,'importIdentity':import_info,
           'primitive':{'node':data['nodeIndex'],'mesh':data['node']['mesh'],'primitive':0,'vertexCount':count},
           'protectedVertices':sorted(protected),'scarfExceptionVertices':sorted(exception),'normalEligibleVertices':sorted(normal_eligible),
           'profile':{'parameters':PARAMS,'seeds':SEEDS.get(asset,{}),'regions':regions,'mask':masks,
                      'referenceEvidence':reference_evidence,'scarfDelta':scarf_delta,
                      'localStrokeMask':stroke_rows,
                      'armProfile':{'enabled':asset in SEEDS,'coordinates':'decodedGLTF-Float64-rest-and-bone-landmarks','transverse':'shared-Middle-YZ','records':arm_records,'mask':arm_rows,'normalEligibleVertices':sorted(arm_normal_ids),'maximumMove':.20},
                      'coordinates':'original decodedGLTF Float64 weightedREST masks; contact05 weightedREST fixed field',
                      'formula':'C1 leg-axis lateral/posterior union * fixed hem/flare field; front XZ .5 to posterior full; bounded existing own/opposite leg transfer; Hips and JOINTS exact'},
           'changes':{'positions':position_rows,'normals':normal_rows,'weights':weight_rows},'triangleValidation':triangle_report,
           'limitations':['candidate only; root dense/visual validation pending','blend retains imported corner normals; GLB affected-seam normals use explicit rotation'],
           'preserved':['contact05 JOINTS_0; WEIGHTS_0 outside coat repair; all Hips/Foot/scarf weights','all geometry outside coat/local-stroke/scarf/rogue-arm allowlists','protected geometry outside scarf exception','UV','indices','materials','textures','nodes','skins','animations']}
    patch_path=out/(asset+'.patch.json');low.write_new(patch_path,patch)
    report={'ok':True,'asset':asset,'patch':file_record(patch_path),'blend':file_record(blend_path),'positionChanges':len(position_rows),'normalChanges':len(normal_rows),'weightChanges':len(weight_rows),'restValidation':initial_parity,'blendValidation':final_parity}
    low.write_new(out/(asset+'.author.json'),report);print(json.dumps(report,ensure_ascii=False),flush=True);return report


def main(args):
    require(bpy.app.version>=(5,2,0),'실제 Blender 5.2 이상 필요')
    repo,contact_dir,out=Path(args.repo).resolve(),Path(args.contact_dir).resolve(),Path(args.out_dir).resolve()
    require(out!=contact_dir and out!=repo and repo not in out.parents,'새 저장소 밖 출력 필요')
    require(not out.exists() or (out.is_dir() and not any(out.iterdir())),'출력 덮어쓰기 금지')
    require(len(CONTACT_SHA)==5,'실제05 SHA 계약 미확정')
    out.mkdir(parents=True,exist_ok=True)
    v2=load_module('readonly_contact05_author',repo/'art-src/higher-bodies/author_contact_fit_v2.py',CONTACT_AUTHOR_SHA)
    low=load_module('readonly_lower03_author',repo/'art-src/higher-bodies/author_lower_fit_v1.py',v2.LOWER_AUTHOR_SHA)
    lib=load_module('readonly_fox_glb_helpers',repo/'art-src/avatar-fox/author_body_contact_v3.py',low.HELPER_SHA)
    results=[author_asset(v2,low,lib,repo,contact_dir,out,contract) for contract in low.ASSETS]
    return {'ok':True,'schema':'blade-surge.higher-contact-author.v3','assets':results,'author':file_record(__file__)}


if __name__=='__main__':
    args=task_args(build_args)
    require(not Path(args.report).exists(),'report 덮어쓰기 금지')
    require(Path(args.report).parent.is_dir(),'runner report 부모 디렉터리 필요')
    run(main,args)
