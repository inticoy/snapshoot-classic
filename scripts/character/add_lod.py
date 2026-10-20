"""선수 모델에 먼 거리용 저폴리 메시(이름 끝 _lod)를 덧붙인다. 같은 뼈대에 묶여 동작·IK는 그대로.
  blender -b --python scripts/character/add_lod.py -- <입력 player.glb> <출력 .glb>
"""
import sys
import bpy

SRC, OUT = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

def activate(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

# 속눈썹처럼 멀리서 안 보이는 부위는 저폴리에서 뺀다
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.endswith('_lod') and 'Eyelash' not in o.name]
before = after = 0
for p in meshes:
    lod = p.copy()
    lod.data = p.data.copy()
    lod.name = p.name + '_lod'
    for c in p.users_collection:
        c.objects.link(lod)
    n = sum(len(f.vertices) - 2 for f in p.data.polygons)
    before += n
    # 얼굴·몸처럼 큰 부위만 줄인다 (작은 부위는 그대로 둬도 싸다)
    if n > 800:
        dec = lod.modifiers.new('Decimate', 'DECIMATE')
        dec.ratio = 0.18
        activate(lod)
        bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
        bpy.ops.object.modifier_apply(modifier='Decimate')
    after += sum(len(f.vertices) - 2 for f in lod.data.polygons)
print('TRIS', before, '->', after)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_morph=False, export_materials='EXPORT', export_image_format='JPEG')
print('WROTE', OUT)
