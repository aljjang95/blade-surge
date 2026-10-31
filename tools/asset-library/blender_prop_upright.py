"""비스듬히 생성된 무기 prop(Tripo 정규화 출력)의 가장 긴 축을 세로(+Z)로 세운다. 손 소켓 grip/rot 을 축 정렬 값으로 쓰기 위함이다.

사용: blender -b --python-exit-code 1 --python tools/asset-library/blender_prop_upright.py -- --input <prop.glb> --output <out.glb>
주성분(정점 공분산의 최대 고유벡터)을 +Z 로 돌리고, 원래 위쪽(z 성분 양수) 끝이 위로 가게 한다. 메시는 변형을 굽는다.
"""
import json
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector


def main():
  argv = sys.argv[sys.argv.index('--') + 1:]
  args = dict(zip(argv[::2], argv[1::2]))
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=args['--input'])
  meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
  points = np.array([tuple(obj.matrix_world @ v.co) for obj in meshes for v in obj.data.vertices])
  center = points.mean(axis=0)
  values, vectors = np.linalg.eigh(np.cov((points - center).T))
  axis = Vector(vectors[:, int(np.argmax(values))])
  if axis.z < 0:
    axis = -axis
  rotation = axis.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
  for obj in meshes:
    obj.data.transform(rotation @ obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
  bpy.ops.export_scene.gltf(filepath=args['--output'], export_format='GLB', export_yup=True, export_animations=False)
  print('PROP_UPRIGHT ' + json.dumps({'axis': [round(v, 3) for v in axis], 'tiltDeg': round(axis.angle(Vector((0, 0, 1))) * 57.2958, 1)}))


if __name__ == '__main__':
  main()
