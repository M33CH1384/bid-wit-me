"""
Contact sheet of every built table, so a shape can be checked without loading the game.

  ~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/preview_tables.py

Writes screenshots/photoreal/tables.png. Part colours here are stand-ins: the game supplies the real materials.
"""
import bpy, os, glob, math

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
MODELS = sorted(glob.glob(os.path.join(ROOT, 'apps', 'web', 'public', 'assets', 'models', 'table_*.glb')))
TINT = {'cushion': (0.09, 0.05, 0.04), 'rail': (0.45, 0.25, 0.13), 'apron': (0.25, 0.14, 0.08), 'inlay': (0.9, 0.7, 0.3), 'base': (0.2, 0.12, 0.08)}

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, ao=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.45
    if ao:
        col = nt.nodes.new('ShaderNodeVertexColor')
        mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
        mix.inputs[1].default_value = (*rgb, 1)
        nt.links.new(col.outputs['Color'], mix.inputs[2])
        nt.links.new(mix.outputs[0], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    return m


mats = {k: material(k, v) for k, v in TINT.items()}
felt = material('felt', (0.03, 0.25, 0.14), ao=False)
floor = material('floor', (0.12, 0.11, 0.1), ao=False)
cols = 4
for i, path in enumerate(MODELS):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    ox, oy = (i % cols) * 4.6, -(i // cols) * 5.0
    for ob in set(bpy.data.objects) - before:
        if ob.type != 'MESH':
            continue
        ob.location.x += ox; ob.location.y += oy
        ob.data.materials.clear()
        ob.data.materials.append(mats.get(ob.name.split('.')[0], mats['base']))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(ox, oy, 0.0))
    p = bpy.context.object; p.scale = (3.2, 3.76, 1); p.data.materials.append(felt)
    bpy.ops.object.text_add(location=(ox - 1.6, oy - 2.55, -0.89), rotation=(0, 0, 0))
    t = bpy.context.object; t.data.body = os.path.basename(path)[6:-4]; t.data.size = 0.5; t.data.materials.append(felt)
rows = math.ceil(len(MODELS) / cols)
bpy.ops.mesh.primitive_plane_add(size=80, location=(7, -5, -0.9)); bpy.context.object.data.materials.append(floor)
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30))); bpy.context.object.data.energy = 3.5
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(-55), 0, math.radians(200))); bpy.context.object.data.energy = 1.0
cx, cy = (cols - 1) * 4.6 / 2, -(rows - 1) * 5.0 / 2
bpy.ops.object.camera_add(location=(cx, cy - 13, 12), rotation=(math.radians(47), 0, 0))
cam = bpy.context.object; cam.data.type = 'ORTHO'; cam.data.ortho_scale = cols * 4.6 + 0.6
sc = bpy.context.scene
sc.camera = cam
sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x, sc.render.resolution_y = 1840, 1300
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.3, 0.3, 0.32, 1)
out = os.path.abspath(os.path.join(ROOT, 'screenshots', 'photoreal', 'tables.png'))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
