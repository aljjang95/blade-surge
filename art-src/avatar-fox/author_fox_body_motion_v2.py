# fox 전용 도약 구르기: canonical V4 action을 실제 Blender에서 복제/저작하고 Hips.position만 직렬화한다.
# 기본 클립/리그/몸체는 재수출하지 않는다. 120Hz+원본키, 고정 artist curve이며 skinMin 보정이 아니다.
import argparse
import bpy
import hashlib
import importlib.util
import json
import math
import sys
import struct
from pathlib import Path
from mathutils import Matrix, Vector

BASE_SHA = '0a008c410e2e3df74b87ba7e00f317f4266c1edc0eda2951e43f8a9a6dce43d0'
BODY_HELPER_SHA = 'f9218587bd06e46f05274f04248878b5722eefe395755a29d79ca4acd4b2a749'

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def curves(action):
    if hasattr(action, 'fcurves'):
        return list(action.fcurves)
    result=[]
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                result.extend(bag.fcurves)
    return result

def curve_snapshot(action, skip_path=None):
    return [(c.data_path,c.array_index,[(tuple(k.co),k.interpolation,tuple(k.handle_left),tuple(k.handle_right)) for k in c.keyframe_points]) for c in curves(action) if c.data_path != skip_path]

def set_action(arm, action, source_slot=None):
    arm.animation_data_create()
    arm.animation_data.use_nla=False
    arm.animation_data.action=action
    if hasattr(action,'slots') and len(action.slots):
        slots=list(action.slots)
        identifier=getattr(source_slot,'identifier',None)
        matching=[s for s in slots if getattr(s,'identifier',None)==identifier]
        arm.animation_data.action_slot=matching[0] if matching else slots[0]

def interpolate(times, rows, t):
    if t <= times[0]: return list(rows[0])
    if t >= times[-1]: return list(rows[-1])
    for i in range(len(times)-1):
        if t <= times[i+1]:
            u=(t-times[i])/(times[i+1]-times[i])
            return [a+(b-a)*u for a,b in zip(rows[i],rows[i+1])]
    raise RuntimeError('interpolation interval absent')

DEATH_KEYS = [(0.,0.),(.12,0.),(.32,.095),(.75,.095),(1.05,.08),(1.25,.05)]

def artist_profile(name, t):
    if name == 'dodge':
        return 0. if t <= 0 or t >= .5 else .11*math.sin(math.pi*t/.5)**4
    if t <= 0: return 0.
    if t >= 1.25: return .05
    for (ta,va),(tb,vb) in zip(DEATH_KEYS,DEATH_KEYS[1:]):
        if t <= tb:
            u=(t-ta)/(tb-ta)
            return va+(vb-va)*u*u*(3-2*u)
    raise RuntimeError('death artist interval missing')

def decoded_track_sha(name,times,values):
    flat=[v for row in values for v in row]
    raw=name.encode('utf-8')+b'\0'+struct.pack('<II',len(times),len(flat))
    raw+=struct.pack('<'+'f'*len(times),*times)+struct.pack('<'+'f'*len(flat),*flat)
    return hashlib.sha256(raw).hexdigest()

def author_clip(args,lib,doc,binary,arm,profile_name):
    DURATION = .5 if profile_name=='dodge' else 1.25
    animations=[a for a in doc['animations'] if a.get('name')==profile_name]
    require(len(animations)==1,'canonical motion identity mismatch')
    animation=animations[0]
    hips_nodes=[i for i,n in enumerate(doc['nodes']) if lib.canon_name(n.get('name',''))=='mixamorigHips']
    require(len(hips_nodes)==1,'Hips node ambiguous')
    hips_node=hips_nodes[0]
    channels=[c for c in animation['channels'] if c['target'].get('node')==hips_node and c['target'].get('path')=='translation']
    require(len(channels)==1,'Hips translation channel ambiguous')
    sampler=animation['samplers'][channels[0]['sampler']]
    require(sampler.get('interpolation','LINEAR')=='LINEAR','canonical Hips sampler is not LINEAR')
    original_times=[r[0] for r in lib.read_accessor(doc,binary,sampler['input'])]
    original_values=lib.read_accessor(doc,binary,sampler['output'])
    require(original_times[0]==0 and original_times[-1]==DURATION,'canonical duration/endpoints mismatch')
    require(all(b>a for a,b in zip(original_times,original_times[1:])),'canonical keys not ordered')
    parents={child:i for i,n in enumerate(doc['nodes']) for child in n.get('children',[])}
    require(hips_node in parents,'Hips parent absent')
    ancestors=[];node=hips_node
    while node in parents:
        node=parents[node];ancestors.append(node)
    require(not any(c['target'].get('node') in ancestors for c in animation['channels']),'animated Hips parent requires a separate conversion recipe')
    world=lib.world_nodes(doc)
    parent_world=world[parents[hips_node]]
    parent_inverse=parent_world.to_3x3().inverted()
    times=list(original_times)
    for i in range(round(DURATION*120)+1):
        t=i/120
        if not any(abs(t-old)<1e-7 for old in times):times.append(t)
    if profile_name == 'death':
        for t,_ in DEATH_KEYS:
            if not any(abs(t-old)<1e-7 for old in times):times.append(t)
    times.sort()
    profile=lambda t: artist_profile(profile_name,t)
    baseline_rows=[interpolate(original_times,original_values,t) for t in times]
    native_deltas=[parent_inverse @ Vector((0,profile(t),0)) for t in times]
    output_rows=[[v+delta[k] for k,v in enumerate(row)] for row,delta in zip(baseline_rows,native_deltas)]
    require(all(abs(delta.x)<1e-8 and abs(delta.z)<1e-8 for delta in native_deltas),'native world-up is not Y-only')
    require(output_rows[0]==original_values[0],'start translation changed')
    require(all(output_rows[-1][k]==original_values[-1][k] for k in [0,2]),'end XZ changed')
    require(abs((parent_world.to_3x3() @ Vector([a-b for a,b in zip(output_rows[-1],original_values[-1])])).y-profile(DURATION))<1e-7,'authored endpoint mismatch')

    arm.data.pose_position='POSE'
    hips=[b for b in arm.pose.bones if lib.canon_name(b.name)=='mixamorigHips']
    require(len(hips)==1,'imported Hips identity mismatch')
    hip=hips[0]
    require(not arm.constraints and not hip.constraints,'Hips constraints require explicit authoring recipe')
    candidates=[]
    if arm.animation_data:
        for track in arm.animation_data.nla_tracks:
            for strip in track.strips:
                name=strip.action.name.lower() if strip.action else ''
                if profile_name in name and 'backward' not in name:
                    candidates.append((strip.action,getattr(strip,'action_slot',None)))
    if not candidates:
        candidates=[(a,None) for a in bpy.data.actions if profile_name in a.name.lower() and 'backward' not in a.name.lower()]
    unique={a.name:(a,slot) for a,slot in candidates}
    print(json.dumps({'event':'fox-motion-import','clip':profile_name,'armature':arm.name,'hips':hip.name,'actions':[a.name for a in bpy.data.actions],'candidateActions':list(unique)},ensure_ascii=False),flush=True)
    require(len(unique)==1,'canonical imported dodge action ambiguous')
    source_action,source_slot=next(iter(unique.values()))
    set_action(arm,source_action,source_slot)
    path=hip.path_from_id('location')
    hip_curves=[c for c in curves(source_action) if c.data_path==path]
    require(len(hip_curves)==3,'expected three Hips local location FCurves')
    fps=bpy.context.scene.render.fps/bpy.context.scene.render.fps_base
    frame_start=min(k.co.x for c in hip_curves for k in c.keyframe_points)
    require(abs(max(k.co.x for c in hip_curves for k in c.keyframe_points)-frame_start-fps*DURATION)<1e-4,'imported action time conversion mismatch')
    rest_before=[(b.name,[list(r) for r in b.matrix_local]) for b in arm.data.bones]
    source_curves_before=curve_snapshot(source_action)
    source_other_curves=curve_snapshot(source_action,path)
    samples=[];maximum_import_error=0.
    for t,row,delta in zip(times,baseline_rows,native_deltas):
        frame=frame_start+t*fps
        bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
        bpy.context.view_layer.update()
        actual_world=arm.matrix_world @ hip.matrix.translation
        expected_world=lib.to_blender(parent_world @ Vector(row))
        error=(actual_world-expected_world).length
        maximum_import_error=max(maximum_import_error,error)
        require(error<=1e-4,'imported Hips position differs from canonical raw track: '+str((t,error)))
        parent_basis=hip.parent.matrix @ hip.parent.bone.matrix_local.inverted() if hip.parent else Matrix.Identity(4)
        basis_world=arm.matrix_world @ parent_basis @ hip.bone.matrix_local
        local_delta=basis_world.to_3x3().inverted() @ lib.to_blender(Vector((0,profile(t),0)))
        samples.append({'time':t,'frame':frame,'baselineLocal':hip.location.copy(),'localDelta':local_delta,'baselineWorld':actual_world.copy()})
    authored=source_action.copy();authored.name='Fox_'+profile_name.title()+'_Contact_Authored_v2';authored.use_fake_user=True
    set_action(arm,authored,source_slot)
    for sample in samples:
        hip.location=sample['baselineLocal']+sample['localDelta']
        hip.keyframe_insert(data_path='location',frame=sample['frame'],group=hip.name)
    for curve in curves(authored):
        if curve.data_path==path:
            for point in curve.keyframe_points:point.interpolation='LINEAR'
    require(curve_snapshot(source_action)==source_curves_before,'canonical source action mutated')
    require(curve_snapshot(authored,path)==source_other_curves,'authored action changed a non-Hips-location curve')
    errors=[]
    for sample in samples:
        frame=sample['frame'];bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame));bpy.context.view_layer.update()
        actual=arm.matrix_world @ hip.matrix.translation
        delta=lib.from_blender(actual-sample['baselineWorld'])
        expected=Vector((0,profile(sample['time']),0))
        error=(delta-expected).length
        errors.append({'time':sample['time'],'actualWorldDelta':list(delta),'artistWorldDelta':list(expected),'error':error})
        require(error<=1e-4,'authored Blender world delta mismatches fixed artist curve')
    require(rest_before==[(b.name,[list(r) for r in b.matrix_local]) for b in arm.data.bones],'bone rest changed')
    bpy.context.scene.frame_set(math.floor(frame_start),subframe=frame_start-math.floor(frame_start))
    authoring={'sourceAction':source_action.name,'authoredAction':authored.name,'sourceFrameStart':frame_start,'sceneFPS':fps,
        'profile': '0.11*sin(pi*t/0.5)^4' if profile_name=='dodge' else 'C1 smoothstep between fixed artist contact keys',
        'artistKeysMeters':None if profile_name=='dodge' else DEATH_KEYS,
        'amplitudeMeters':.11 if profile_name=='dodge' else .095,'bakeHz':120,
        'originalKeyCount':len(original_times),'bakedKeyCount':len(times),
        'nativeParentWorldMatrix':[list(r) for r in parent_world],'hipsNode':hips_node,'parentNodes':ancestors,
        'maximumImportHipsErrorMeters':maximum_import_error,'maximumAuthoredDeltaErrorMeters':max(e['error'] for e in errors),
        'fixedProfileNotSkinMinCompensation':True,'otherCurvesExactUnchanged':True,'skeletonRestExactUnchanged':True}
    override={'base':{'clip':profile_name,'duration':DURATION,'hipsTrack':'mixamorigHips.position',
        'sourceTrackSha256':decoded_track_sha('mixamorigHips.position',original_times,original_values)},
        'outputTrack':{'name':'mixamorigHips.position','type':'vector','times':times,'values':[v for row in output_rows for v in row]},
        'authoring':authoring}
    return override,{'clip':profile_name,'authoring':authoring,'measuredKeys':errors}

def main():
    parser=argparse.ArgumentParser()
    for name in ['input','helper','output','blend','report']:
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    require(all(not Path(p).exists() for p in [args.output,args.blend,args.report]),'output exists; use new candidate filenames')
    require(len({str(Path(p).resolve()) for p in [args.input,args.helper,args.output,args.blend,args.report]})==5,'input/output overlap')
    require(bpy.app.version >= (5,2,0),'requires actual Blender 5.2+')
    helper=Path(args.helper)
    require(hashlib.sha256(helper.read_bytes()).hexdigest()==BODY_HELPER_SHA,'exact passed02 helper SHA mismatch')
    spec=importlib.util.spec_from_file_location('body_contact_passed02',str(helper))
    lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
    raw,doc,binary=lib.read_glb(args.input)
    require(hashlib.sha256(raw).hexdigest()==BASE_SHA,'exact canonical V4 SHA mismatch')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(args.input).resolve()),merge_vertices=False)
    arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
    require(len(arms)==1,'expected one imported canonical armature')
    overrides=[];reports=[]
    for name in ['dodge','death']:
        override,report=author_clip(args,lib,doc,binary,arms[0],name)
        overrides.append(override);reports.append(report)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.blend).resolve()))
    authoring={'blender':bpy.app.version_string,'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'helperSha256':BODY_HELPER_SHA,'blendSha256':hashlib.sha256(Path(args.blend).read_bytes()).hexdigest(),
        'sourceTrackHashEncoding':'UTF8(sanitizedName)+NUL+u32LE(timeCount)+u32LE(valueCount)+float32LE(times)+float32LE(values)',
        'nativeTrackSerialization':'exact canonical raw LINEAR interpolation plus parent-inverse fixed artist world-Y profile; actual Blender authored action deltas independently verified'}
    artifact={'schema':'blade-surge.hero-body-motion.v1','asset':'avatar_ranger_fox',
        'base':{'path':'/models/heroes-next/ranger-library-t1-v4.glb','sha256':BASE_SHA},
        'clipOverrides':overrides,'authoring':authoring,
        'preserved':['canonical V4 bytes','all other nine clip objects/tracks','dodge/death non-Hips-position tracks','all skeleton rest matrices','all body geometry/skin/material/texture bytes'],
        'limitations':['candidate motion requires actual 301samples+allkeys and visual dodge/death review','JSON only for exact avatar_ranger_fox; runtime integration owns that guard']}
    Path(args.output).write_text(json.dumps(artifact,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'schema':'blade-surge.fox-motion-authoring.v2','ok':True,'output':str(Path(args.output).resolve()),
        'outputSha256':hashlib.sha256(Path(args.output).read_bytes()).hexdigest(),'blend':str(Path(args.blend).resolve()),'authoring':authoring,'clips':reports}
    Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'ok':True,'output':str(Path(args.output).resolve()),'clips':[{'clip':r['clip'],'bakedKeys':r['authoring']['bakedKeyCount'],
        'maximumImportError':r['authoring']['maximumImportHipsErrorMeters'],'maximumAuthoredDeltaError':r['authoring']['maximumAuthoredDeltaErrorMeters']} for r in reports]},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
