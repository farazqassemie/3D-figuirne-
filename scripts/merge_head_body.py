# Auto-merge a Hi3D Portrait head onto a Hi3D General body into one figure.
# Method (the one that actually works for these meshes): keep the WHOLE head
# bust (never cut through the face — that leaves a flat slice), size it to the
# body's original head width, and sink its shoulders into the body so the two
# identical shirts blend. Preserves textures (no boolean).
#
# Blender headless usage:
#   blender --background --python scripts/merge_head_body.py -- \
#       --body BODY.glb --head HEAD.glb --out MERGED.glb [--png PREVIEW.png]
import bpy, bmesh, mathutils, sys

def argval(flag, default=None):
    a = sys.argv
    return a[a.index(flag) + 1] if flag in a else default

BODY = argval('--body'); HEAD = argval('--head')
OUT = argval('--out'); PNG = argval('--png')
if not (BODY and HEAD and OUT):
    raise SystemExit('need --body --head --out')

bpy.ops.wm.read_factory_settings(use_empty=True)

def imp(p, n):
    b = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=p)
    nw = [o for o in bpy.data.objects if o not in b and o.type == 'MESH']
    for o in bpy.data.objects: o.select_set(False)
    for o in nw: o.select_set(True)
    bpy.context.view_layer.objects.active = nw[0]
    if len(nw) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = n
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); return ob

def bnd(o):
    mn = mathutils.Vector((1e9,)*3); mx = mathutils.Vector((-1e9,)*3)
    for v in o.data.vertices:
        for i in range(3): mn[i] = min(mn[i], v.co[i]); mx[i] = max(mx[i], v.co[i])
    return mn, mx

def stats(o, zc, tol):  # robust left-right width + center of a horizontal slice
    xs = []; ys = []
    for v in o.data.vertices:
        if abs(v.co.z - zc) < tol: xs.append(v.co.x); ys.append(v.co.y)
    if len(xs) < 15: return None
    xs.sort(); ys.sort(); n = len(xs)
    return xs[int(n*0.95)] - xs[int(n*0.05)], (xs[int(n*0.95)] + xs[int(n*0.05)])/2, (ys[int(n*0.95)] + ys[int(n*0.05)])/2

def wat(o, frac):
    mn, mx = bnd(o); h = mx.z - mn.z; return stats(o, mn.z + h*frac, h*0.012)

def cutz(o, below=None):
    bm = bmesh.new(); bm.from_mesh(o.data); d = []
    for v in bm.verts:
        if below is not None and v.co.z > below: d.append(v)
    bmesh.ops.delete(bm, geom=d, context='VERTS'); bm.to_mesh(o.data); bm.free()

body = imp(BODY, 'body'); bmn, bmx = bnd(body); bH = bmx.z - bmn.z
orig_crown = bmx.z
bhw, bhcx, bhcy = wat(body, 0.94)             # body's original head width/center
cutz(body, below=bmn.z + bH*0.82)             # drop the weak head, keep body to collar

# HEAD_SCALE trims the head down: the body's generated head runs ~30% oversized
# and hair inflates the width match, so 0.72 lands a natural head:body ratio.
HEAD_SCALE = float(argval('--head-scale', '0.72'))
head = imp(HEAD, 'head'); hmn, hmx = bnd(head)
hfw, _, _ = wat(head, 0.60)                   # bust head width
s = (bhw/hfw) * HEAD_SCALE if hfw else 1.0    # size head to body, trimmed
head.scale = (s, s, s)
bpy.context.view_layer.objects.active = head
for o in bpy.data.objects: o.select_set(False)
head.select_set(True); bpy.ops.object.transform_apply(scale=True)
hmn2, hmx2 = bnd(head); hf = wat(head, 0.60)
head.location.x += bhcx - hf[1]
head.location.y += bhcy - hf[2]
# Anchor by the neck (where it emerges from the collar), NOT the crown — so
# changing the head size never opens a gap or slices the face.
collar_z = bmn.z + bH*0.82
neck_z = hmn2.z + (hmx2.z - hmn2.z) * 0.40
head.location.z += collar_z - neck_z + bH*0.005
bpy.ops.object.transform_apply(location=True)

for o in bpy.data.objects: o.select_set(False)
body.select_set(True); head.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join(); bpy.ops.object.shade_smooth()
fin = bpy.context.view_layer.objects.active
for o in bpy.data.objects: o.select_set(False)
fin.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB')
print('MERGED', OUT)

if PNG:
    mn, mx = bnd(fin); ctr = (mx + mn)/2; H = (mx - mn).z
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x = 760; sc.render.resolution_y = 1240
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.88, 0.89, 0.9, 1)
    cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = H*1.08
    loc = mathutils.Vector((ctr.x, ctr.y - H, ctr.z)); cam.location = loc
    cam.rotation_euler = (ctr - loc).normalized().to_track_quat('-Z', 'Z').to_euler()
    for off, en in [(0.7, 3.4), (-0.6, 1.9), (0.0, 1.1)]:
        l = bpy.data.lights.new('L', 'AREA'); l.energy = en*H*H*45; l.size = H*0.7
        lo = bpy.data.objects.new('L', l); sc.collection.objects.link(lo)
        lo.location = loc + mathutils.Vector((off*H, -0.2*H, H*0.35))
        lo.rotation_euler = (ctr - lo.location).normalized().to_track_quat('-Z', 'Z').to_euler()
    sc.render.filepath = PNG; bpy.ops.render.render(write_still=True); print('PREVIEW', PNG)
