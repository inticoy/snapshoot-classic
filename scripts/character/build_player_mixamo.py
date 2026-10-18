"""
선수 캐릭터 만들기 — Mixamo 캐릭터 버전 (Blender 명령줄 전용)

  blender -b --python scripts/character/build_player_mixamo.py -- <기존 player.glb> <Mixamo 캐릭터 .fbx> <출력 .glb>

build_player.py와 같은 방식: 기존 뼈대(DEF-*)와 클립·IK는 그대로 두고 몸만 Mixamo 캐릭터로 바꾼다.
 1) 팔다리 뼈만 기존 뼈 방향(T 포즈)에 맞춰 돌린 뒤 메시에 굳힌다
 2) 기존 뼈의 머리(회전 중심)를 Mixamo 관절 위치로 옮긴다 (방향·롤은 그대로라 클립 회전이 맞는다)
 3) 가중치 이름을 기존 뼈 이름으로 바꾼다
 4) 옷 부위별 재질 이름(skin·hair·shirt·shorts·socks·boots)을 붙여 게임에서 팀 색을 입힌다
 5) 모바일용으로 줄이고(메시 줄이기·텍스처 1024) 내보낸다
Mixamo 캐릭터는 게임에 넣어 배포할 수 있다 (원본 파일 재배포만 안 됨). 원본 .fbx는 저장소 밖(mocap-local)에 둔다.
"""
import sys
import bpy
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, FBX, OUT = argv
HEIGHT = 1.82

bpy.ops.wm.read_factory_settings(use_empty=True)

# Mixamo 뼈 → 기존 뼈 (부모 먼저). 접두어(mixamorig5: 등)는 파일마다 달라 떼고 비교한다
MAP = [('Hips', 'DEF-hips'), ('Spine', 'DEF-spine.001'), ('Spine1', 'DEF-spine.002'), ('Spine2', 'DEF-spine.003'),
       ('Neck', 'DEF-neck'), ('Head', 'DEF-head')]
for side, S in (('Left', 'L'), ('Right', 'R')):
    MAP += [(f'{side}Shoulder', f'DEF-shoulder.{S}'), (f'{side}Arm', f'DEF-upper_arm.{S}'), (f'{side}ForeArm', f'DEF-forearm.{S}'),
            (f'{side}Hand', f'DEF-hand.{S}')]
    for i in (1, 2, 3):
        MAP.append((f'{side}HandThumb{i}', f'DEF-thumb.0{i}.{S}'))
        for f, F in (('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
            MAP.append((f'{side}Hand{f}{i}', f'DEF-f_{F}.0{i}.{S}'))
    MAP += [(f'{side}UpLeg', f'DEF-thigh.{S}'), (f'{side}Leg', f'DEF-shin.{S}'), (f'{side}Foot', f'DEF-foot.{S}'), (f'{side}ToeBase', f'DEF-toe.{S}')]
TORSO = {'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder'}
# 메시 이름 → 재질 이름 (게임이 이 이름으로 색을 정한다)
PARTS = {'Body': 'skin', 'Hair': 'hair', 'Shirt': 'shirt', 'Shorts': 'shorts', 'Socks': 'socks', 'Shoes': 'boots'}


def short(name):
    return name.split(':')[-1]


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


# ---------------------------------------------------------------- 기존 캐릭터
bpy.ops.import_scene.gltf(filepath=SRC)
qrig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
old = [o for o in bpy.data.objects if o.type == 'MESH']
qdir = {b.name: (qrig.matrix_world @ b.tail_local - qrig.matrix_world @ b.head_local).normalized() for b in qrig.data.bones}

# ---------------------------------------------------------------- Mixamo 캐릭터
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=FBX)
new = [o for o in bpy.data.objects if o not in before]
mrig = next(o for o in new if o.type == 'ARMATURE')
# 속눈썹은 경기 카메라에서 안 보이고 삼각형만 든다
lashes = [o for o in new if o.type == 'MESH' and 'Eyelash' in o.name]
parts = [o for o in new if o.type == 'MESH' and o not in lashes]
for o in lashes:
    bpy.data.objects.remove(o, do_unlink=True)
mbone = {short(b.name): b.name for b in mrig.data.bones}

# 키 맞추기 (발바닥 0, 골반 중심이 원점 위). FBX는 뼈대에 회전·축척이 걸려 있고 메시는 뼈대로 변형되므로
# 변형된(평가된) 정점으로 잰다
def world_points():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for p in parts:
        ev = p.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    return pts


activate(mrig)
for p in parts:
    p.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()
pts = world_points()
k = HEIGHT / (max(v.z for v in pts) - min(v.z for v in pts))
mrig.scale = (k, k, k)
bpy.context.view_layer.update()
pts = world_points()
hips = mrig.matrix_world @ mrig.pose.bones[mbone['Hips']].head
mrig.location = (-hips.x, -hips.y, -min(v.z for v in pts))
bpy.context.view_layer.update()
activate(mrig)
for p in parts:
    p.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()
print('ALIGN hips', [round(x, 3) for x in (mrig.matrix_world @ mrig.pose.bones[mbone['Hips']].head)])

# ---------------------------------------------------------------- 1) 팔다리를 기존 뼈 방향으로
activate(mrig)
bpy.ops.object.mode_set(mode='POSE')
mw = mrig.matrix_world
for mb, qb in MAP:
    pb = mrig.pose.bones.get(mbone.get(mb, ''))
    if not pb or qb not in qdir or mb in TORSO:
        continue
    bpy.context.view_layer.update()
    head = mw @ pb.head
    cur = (mw @ pb.tail - head).normalized()
    R = cur.rotation_difference(qdir[qb]).to_matrix().to_4x4()
    pb.matrix = mw.inverted() @ (Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ (mw @ pb.matrix))
bpy.context.view_layer.update()
joints = {mb: (mw @ mrig.pose.bones[mbone[mb]].head, mw @ mrig.pose.bones[mbone[mb]].tail) for mb, _ in MAP if mb in mbone}
bpy.ops.object.mode_set(mode='OBJECT')
for p in parts:
    activate(p)
    for m in list(p.modifiers):
        if m.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=m.name)

# ---------------------------------------------------------------- 2) 기존 뼈 위치 옮기기
activate(qrig)
bpy.ops.object.mode_set(mode='EDIT')
qinv = qrig.matrix_world.inverted()
eb = qrig.data.edit_bones
for mb, qb in MAP:
    if mb in joints and qb in eb:
        h, t = joints[mb]
        roll = eb[qb].roll
        d = (eb[qb].tail - eb[qb].head).normalized()
        eb[qb].head = qinv @ h
        eb[qb].tail = eb[qb].head + d * (t - h).length
        eb[qb].roll = roll
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- 3) 가중치 이름 + 4) 재질 이름 + 5) 줄이기
names = dict(MAP)
for p in parts:
    for g in list(p.vertex_groups):
        s = short(g.name)
        if s in names:
            g.name = names[s]
        else:
            p.vertex_groups.remove(g)
    part = next((v for kk, v in PARTS.items() if kk in p.name), 'skin')
    mat = p.data.materials[0].copy() if p.data.materials else bpy.data.materials.new(part)
    mat.name = part
    p.data.materials.clear()
    p.data.materials.append(mat)
    if len(p.data.polygons) > 1500:
        dec = p.modifiers.new('Decimate', 'DECIMATE')
        dec.ratio = 0.3  # 선수 22명 + 심판을 모바일에서도 (몸 약 1.2만 삼각형)
        activate(p)
        bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
        bpy.ops.object.modifier_apply(modifier='Decimate')
    p.parent = qrig
    p.matrix_parent_inverse = qrig.matrix_world.inverted()
    mod = p.modifiers.new('Armature', 'ARMATURE')
    mod.object = qrig
# 팀 색을 입히는 부위는 텍스처를 쓰지 않는다. 얼굴·머리 텍스처만 1024로
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
for o in [mrig, *old]:
    bpy.data.objects.remove(o, do_unlink=True)
tris = sum(len(poly.vertices) - 2 for p in parts for poly in p.data.polygons)
print('TRIS', tris, 'PARTS', [(p.name, p.data.materials[0].name) for p in parts])

activate(qrig)
for p in parts:
    p.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_morph=False, export_materials='EXPORT', export_image_format='JPEG')
print('WROTE', OUT)
