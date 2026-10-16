"""
선수 캐릭터 만들기 (Blender + MPFB2, 명령줄 전용)

  blender -b --python scripts/character/build_player.py -- <기존 player.glb> <출력 .glb>

기존 Quaternius 뼈대(DEF-*)와 그 이동 클립을 그대로 두고 몸만 MPFB2 사람 메시로 바꾼다.
 1) MPFB 사람 생성 → game_engine 뼈대를 붙인다
 2) 팔다리 뼈만 기존 뼈 방향(T 포즈)에 맞춰 돌린 뒤 메시에 굳힌다
    (골반·척추는 두 뼈대의 방향 규칙이 달라서 돌리면 몸이 젖혀진다 → 원래 자세 그대로)
 3) 기존 뼈의 머리(회전 중심)만 MPFB 관절 위치로 옮긴다. 방향·롤은 기존 그대로라
    클립·구운 동작의 회전이 그대로 맞는다
 4) MPFB 가중치를 기존 뼈 이름으로 옮기고, 유니폼 영역을 살짝 부풀려 옷 느낌을 준다
MPFB 생성 메시는 CC0.
"""
import sys
import bpy
import bmesh
import addon_utils
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
HEIGHT = 1.82  # 기존 캐릭터 키(1.83)와 맞춰 셰이더 유니폼 영역을 그대로 쓴다

bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable('bl_ext.blender_org.mpfb')
from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402

# MPFB 뼈 → 기존 뼈 (부모 먼저)
MAP = [('pelvis', 'DEF-hips'), ('spine_01', 'DEF-spine.001'), ('spine_02', 'DEF-spine.002'), ('spine_03', 'DEF-spine.003'),
       ('neck_01', 'DEF-neck'), ('head', 'DEF-head')]
for s, S in (('l', 'L'), ('r', 'R')):
    MAP += [(f'clavicle_{s}', f'DEF-shoulder.{S}'), (f'upperarm_{s}', f'DEF-upper_arm.{S}'), (f'lowerarm_{s}', f'DEF-forearm.{S}'),
            (f'hand_{s}', f'DEF-hand.{S}')]
    for i in (1, 2, 3):
        MAP.append((f'thumb_0{i}_{s}', f'DEF-thumb.0{i}.{S}'))
        for f in ('index', 'middle', 'ring', 'pinky'):
            MAP.append((f'{f}_0{i}_{s}', f'DEF-f_{f}.0{i}.{S}'))
    MAP += [(f'thigh_{s}', f'DEF-thigh.{S}'), (f'calf_{s}', f'DEF-shin.{S}'), (f'foot_{s}', f'DEF-foot.{S}'), (f'ball_{s}', f'DEF-toe.{S}')]


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


# ---------------------------------------------------------------- 기존 캐릭터
bpy.ops.import_scene.gltf(filepath=SRC)
qrig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
qmesh = bpy.data.objects['Mannequin']
qdir = {b.name: (qrig.matrix_world @ b.tail_local - qrig.matrix_world @ b.head_local).normalized() for b in qrig.data.bones}

# ---------------------------------------------------------------- MPFB 사람
macro = {'gender': 1.0, 'age': 0.5, 'muscle': 0.72, 'weight': 0.42, 'proportions': 0.85, 'height': 0.55,
         'cupsize': 0.5, 'firmness': 0.5, 'race': {'asian': 0.34, 'caucasian': 0.33, 'african': 0.33}}
human = HumanService.create_human(macro_detail_dict=macro)
mrig = HumanService.add_builtin_rig(human, 'game_engine')

# 모양 키(체형)를 메시에 굳힌다
activate(human)
if human.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
# 눈알만 남기고 보조 메시 삭제
keep = {human.vertex_groups[n].index for n in ('body', 'helper-l-eye', 'helper-r-eye')}
bm = bmesh.new()
bm.from_mesh(human.data)
dl = bm.verts.layers.deform.active
bm.verts.ensure_lookup_table()
drop = [v for v in bm.verts if not any(g in keep and w > 0.5 for g, w in v[dl].items())]
bmesh.ops.delete(bm, geom=drop, context='VERTS')
bm.to_mesh(human.data)
bm.free()
for mod in list(human.modifiers):
    if mod.type != 'ARMATURE':
        human.modifiers.remove(mod)

# 키 맞추기 (발바닥 0)
zs = [(human.matrix_world @ v.co).z for v in human.data.vertices]
k = HEIGHT / (max(zs) - min(zs))
for o in (mrig, human):
    o.scale = [s * k for s in o.scale]
bpy.context.view_layer.update()
activate(mrig)
human.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# ---------------------------------------------------------------- 2) T 포즈로 돌리기
activate(mrig)
bpy.ops.object.mode_set(mode='POSE')
mw = mrig.matrix_world
TORSO = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r'}
for mb, qb in MAP:
    pb = mrig.pose.bones.get(mb)
    if not pb or qb not in qdir or mb in TORSO:
        continue
    bpy.context.view_layer.update()
    head = mw @ pb.head
    cur = (mw @ pb.tail - head).normalized()
    R = cur.rotation_difference(qdir[qb]).to_matrix().to_4x4()
    M = mw @ pb.matrix
    pb.matrix = mw.inverted() @ (Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ M)
bpy.context.view_layer.update()
joints = {mb: (mw @ mrig.pose.bones[mb].head, mw @ mrig.pose.bones[mb].tail) for mb, _ in MAP if mb in mrig.pose.bones}
bpy.ops.object.mode_set(mode='OBJECT')
activate(human)
arm_mod = next(m for m in human.modifiers if m.type == 'ARMATURE')
bpy.ops.object.modifier_apply(modifier=arm_mod.name)

# ---------------------------------------------------------------- 3) 기존 뼈 위치 옮기기
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

# ---------------------------------------------------------------- 4) 가중치 이름 바꾸기 + 바인딩
names = dict(MAP)
for g in list(human.vertex_groups):
    if g.name in names:
        g.name = names[g.name]
    elif not g.name.startswith('DEF-') and not g.name.startswith('helper-'):
        human.vertex_groups.remove(g)
for o in (mrig, qmesh):
    bpy.data.objects.remove(o, do_unlink=True)
human.name = human.data.name = 'Mannequin'
human.parent = qrig
human.matrix_parent_inverse = qrig.matrix_world.inverted()
mod = human.modifiers.new('Armature', 'ARMATURE')
mod.object = qrig

# 유니폼 영역(상의·반바지)을 법선 방향으로 조금 부풀려 몸에 붙은 페인트처럼 보이지 않게
bm = bmesh.new()
bm.from_mesh(human.data)
bm.normal_update()
for v in bm.verts:
    x, z = abs(v.co.x), v.co.z
    if 1.04 < z < 1.5 and x < 0.42:
        v.co += v.normal * 0.012
    elif 0.6 < z <= 1.04:
        # 반바지는 아래로 갈수록 벌어진다
        v.co += v.normal * (0.01 + 0.008 * (1.04 - z) / 0.44) * min(1.0, (z - 0.6) / 0.06)
# 사타구니를 매끈하게 (반바지 천이 덮는다)
crotch = [v for v in bm.verts if abs(v.co.x) < 0.09 and 0.8 < v.co.z < 0.98]
for _ in range(8):
    bmesh.ops.smooth_vert(bm, verts=crotch, factor=0.8, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(human.data)
bm.free()
for n in ('helper-l-eye', 'helper-r-eye'):
    g = human.vertex_groups.get(n)
    if g:
        pts = [v.co for v in human.data.vertices if any(e.group == g.index and e.weight > 0.5 for e in v.groups)]
        c = sum(pts, Vector()) / len(pts)
        print('EYE', n, round(c.x, 3), round(c.z, 3), round(-c.y, 3))  # three 좌표 (x, y, z)

# 줄이기: 선수 13명을 모바일에서도 돌리도록
for g in [g for g in human.vertex_groups if g.name.startswith('helper-')]:
    human.vertex_groups.remove(g)
dec = human.modifiers.new('Decimate', 'DECIMATE')
dec.ratio = 0.5
activate(human)
bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
bpy.ops.object.modifier_apply(modifier='Decimate')
for p in human.data.polygons:
    p.use_smooth = True
print('TRIS', sum(len(p.vertices) - 2 for p in human.data.polygons), 'VERTS', len(human.data.vertices))

activate(qrig)
human.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_animations=True,
                          export_animation_mode='ACTIONS', export_morph=False, export_materials='PLACEHOLDER')
print('WROTE', OUT)
