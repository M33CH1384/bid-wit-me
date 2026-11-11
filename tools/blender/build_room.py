"""
Builds a venue's room in Blender and path-traces what the player sees around the table.

  python3 tools/blender/fetch_assets.py classic
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/build_room.py -- classic [--draft] [--faces=nz,ny]

With no venue named, every room is rendered. --draft is a fast low-resolution pass for checking a layout.

Outputs, in apps/web/public/assets/rooms/<id>/:
  px nx py ny pz nz .jpg   the room as a cube map seen from the player's eye (the game draws its table over it)
  env.hdr                  a small panorama of the same room, which lights the table so the two always agree

The venue's own table is in the scene while rendering, hidden from the camera: it still throws its shadow on the
floor and shows up in reflections. Coordinates are Blender's (Z up); game (x, y, z) is Blender (x, -z, y).
Furniture is Poly Haven CC0, modelled in metres; SCALE turns metres into game units.
"""
import bpy, math, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
WEB = os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'assets')
FLOOR = -0.9
SCALE = 2.7
EYE = Vector((0.0, -3.55, 3.9))  # the standing camera, midway between its phone and desktop positions


# ---------------------------------------------------------------- materials

def tex_material(name, asset, tile=1.0, tint=(1, 1, 1), rough_mul=1.0, bump=1.0, dye=False):
    """A Poly Haven PBR set, box-projected in object space so walls and floors need no UV work.
    dye=True keeps the weave (roughness and normal) but replaces the colour, for cloth in any colour."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])

    def image(kind, colour):
        path = os.path.join(CACHE, 'textures', asset, f'{kind}.jpg')
        if not os.path.exists(path):
            return None
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(path, check_existing=True)
        n.projection = 'BOX'
        n.projection_blend = 0.15
        if not colour:
            n.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], n.inputs['Vector'])
        return n

    diff = None if dye else image('diff', True)
    if dye:
        bsdf.inputs['Base Color'].default_value = (*tint, 1)
    if diff:
        mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
        mix.inputs[2].default_value = (*tint, 1)
        nt.links.new(diff.outputs['Color'], mix.inputs[1])
        nt.links.new(mix.outputs[0], bsdf.inputs['Base Color'])
    rough = image('rough', False)
    if rough:
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = rough_mul; mul.use_clamp = True
        nt.links.new(rough.outputs['Color'], mul.inputs[0])
        nt.links.new(mul.outputs[0], bsdf.inputs['Roughness'])
    nor = image('nor', False)
    if nor:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = bump
        nt.links.new(nor.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def plain(name, rgb, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def glow(name, rgb, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*rgb, 1)
    e.inputs['Strength'].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    return m


# ---------------------------------------------------------------- building blocks

def box(name, lo, hi, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.object
    ob.name = name
    ob.location = [(a + b) / 2 for a, b in zip(lo, hi)]
    ob.scale = [abs(b - a) for a, b in zip(lo, hi)]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = ob.modifiers.new('bevel', 'BEVEL'); mod.width = bevel; mod.segments = 3
    ob.data.materials.append(mat)
    return ob


def prop(asset, at, rot=0.0, scale=SCALE):
    """Drop a Poly Haven model on the floor (or at a height) facing `rot` degrees about the vertical."""
    path = os.path.join(CACHE, 'models', asset, f'{asset}.gltf')
    if not os.path.exists(path):
        print('missing model', asset)
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(asset, None)
    bpy.context.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    root.location = (at[0], at[1], at[2] if len(at) > 2 else FLOOR)
    root.rotation_euler = (0, 0, math.radians(rot))
    root.scale = (scale, scale, scale)
    return root


def area(name, at, size, colour, watts, aim=(0, 0, -1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = 'RECTANGLE'; data.size, data.size_y = size
    data.color = colour; data.energy = watts
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = at
    ob.rotation_euler = Vector(aim).to_track_quat('-Z', 'Y').to_euler()
    return ob


def point(name, at, colour, watts, radius=0.15):
    data = bpy.data.lights.new(name, 'POINT')
    data.color = colour; data.energy = watts; data.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = at
    return ob


def neon(text, at, size, colour, strength, rot=(90, 0, 0)):
    bpy.ops.object.text_add(location=at, rotation=[math.radians(a) for a in rot])
    t = bpy.context.object
    t.data.body = text; t.data.size = size; t.data.align_x = 'CENTER'
    t.data.extrude = 0.02; t.data.bevel_depth = 0.035; t.data.bevel_resolution = 4
    t.data.materials.append(glow(f'neon-{text}', colour, strength))
    return t


def cyl(name, at, radius, height, mat, segs=24):
    """An upright post standing on `at`."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=radius, depth=height, location=(at[0], at[1], at[2] + height / 2))
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob


def ball(name, at, radius, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=at)
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob


def string_lights(name, a, b, sag=0.6, n=12, colour=(1.0, 0.74, 0.4), watts=9):
    """Festoon bulbs on a sagging line between two points; every third one also lights the scene."""
    bulb = glow(f'{name}-bulb', colour, 40)
    a, b = Vector(a), Vector(b)
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        ball(f'{name}{i}', p, 0.075, bulb)
        if i % 3 == 1:
            point(f'{name}-l{i}', p, colour, watts * 3, 0.08)


def top_of(root):
    """World height of the top of an imported prop, for standing things on it."""
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ Vector(c)).z for o in root.children_recursive if o.type == 'MESH' for c in o.bound_box]
    return max(zs) if zs else root.location.z


def on(base, asset, dx=0.0, dy=0.0, rot=0.0, scale=SCALE):
    """Stand a prop on top of another prop (a cake on the table, bottles on the bar)."""
    if base is None:
        return None
    return prop(asset, (base.location.x + dx, base.location.y + dy, top_of(base)), rot, scale)


def shell(X, Y0, Y1, TOP, floor, back, left, right, ceiling, skirt=None, front=None):
    """Four walls, a floor and a ceiling around the table. The front wall is behind the player."""
    box('floor', (-X, Y0, FLOOR - 0.2), (X, Y1, FLOOR), floor)
    box('ceiling', (-X, Y0, TOP), (X, Y1, TOP + 0.2), ceiling)
    box('wall-back', (-X, Y1, FLOOR), (X, Y1 + 0.3, TOP), back)
    box('wall-left', (-X - 0.3, Y0, FLOOR), (-X, Y1, TOP), left)
    box('wall-right', (X, Y0, FLOOR), (X + 0.3, Y1, TOP), right)
    box('wall-front', (-X, Y0 - 0.3, FLOOR), (X, Y0, TOP), front or right)
    if skirt:
        box('skirt-back', (-X, Y1 - 0.06, FLOOR), (X, Y1, FLOOR + 0.4), skirt, 0.01)
        box('skirt-left', (-X, Y0, FLOOR), (-X + 0.06, Y1, FLOOR + 0.4), skirt, 0.01)
        box('skirt-right', (X - 0.06, Y0, FLOOR), (X, Y1, FLOOR + 0.4), skirt, 0.01)


def wainscot(X, Y0, Y1, height, mat, cap=None):
    """Panelling on the lower part of the back and side walls, with an optional cap rail."""
    box('wainscot-back', (-X, Y1 - 0.08, FLOOR), (X, Y1, FLOOR + height), mat)
    box('wainscot-left', (-X, Y0, FLOOR), (-X + 0.08, Y1, FLOOR + height), mat)
    box('wainscot-right', (X - 0.08, Y0, FLOOR), (X, Y1, FLOOR + height), mat)
    if cap:
        box('cap-back', (-X, Y1 - 0.13, FLOOR + height), (X, Y1, FLOOR + height + 0.08), cap, 0.01)
        box('cap-left', (-X, Y0, FLOOR + height), (-X + 0.13, Y1, FLOOR + height + 0.08), cap, 0.01)
        box('cap-right', (X - 0.13, Y0, FLOOR + height), (X, Y1, FLOOR + height + 0.08), cap, 0.01)


def sky(hdri, strength=1.0, turn=0.0):
    """Outdoor venues: a Poly Haven HDRI is the sky, the horizon and the main light."""
    sc = bpy.context.scene
    w = bpy.data.worlds.new('sky'); w.use_nodes = True
    nt = w.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(CACHE, 'hdris', f'{hdri}.hdr'), check_existing=True)
    coord = nt.nodes.new('ShaderNodeTexCoord'); mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, 0, math.radians(turn))
    nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = strength
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    sc.world = w


def ground(mat, size=120.0):
    box('ground', (-size, -size, FLOOR - 0.3), (size, size, FLOOR), mat)


def water(z, rgb=(0.01, 0.05, 0.08), size=600.0):
    """Open water: a dark, nearly mirror surface with a fine ripple, so it carries the sky's reflection."""
    m = bpy.data.materials.new('water'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = 0.06
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1.6; noise.inputs['Detail'].default_value = 6
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    bpy.context.object.data.materials.append(m)


def fluorescent(name, at, length=3.2, watts=420, colour=(0.92, 0.97, 1.0)):
    """A ceiling tube fitting: a lit diffuser plus the light it throws."""
    box(name, (at[0] - length / 2, at[1] - 0.22, at[2] - 0.08), (at[0] + length / 2, at[1] + 0.22, at[2]), glow(f'{name}-tube', colour, 9))
    area(f'{name}-light', (at[0], at[1], at[2] - 0.12), (length, 0.4), colour, watts)


def window(name, lo, hi, colour=(1.0, 0.86, 0.62), strength=9, watts=700, aim=(1, 0, -0.3)):
    """A bright window: a frame, a glowing pane, and the daylight it lets in."""
    frame = plain(f'{name}-frame', (0.85, 0.83, 0.78), 0.5)
    box(f'{name}-pane', lo, hi, glow(f'{name}-glow', colour, strength))
    cx, cy, cz = [(a + b) / 2 for a, b in zip(lo, hi)]
    w = max(abs(hi[0] - lo[0]), abs(hi[1] - lo[1])); h = abs(hi[2] - lo[2])
    for i, (a, b) in enumerate((((lo[0] - 0.06, lo[1] - 0.06, lo[2] - 0.1), (hi[0] + 0.06, hi[1] + 0.06, lo[2])),
                               ((lo[0] - 0.06, lo[1] - 0.06, hi[2]), (hi[0] + 0.06, hi[1] + 0.06, hi[2] + 0.1)),
                               ((cx - 0.05, cy - 0.05, lo[2]), (cx + 0.05, cy + 0.05, hi[2])))):
        box(f'{name}-bar{i}', a, b, frame)
    area(f'{name}-day', (cx + aim[0] * 0.3, cy + aim[1] * 0.3, cz), (w, h), colour, watts, aim=aim)


def table_standin(venue):
    """The venue's table: invisible to the camera, but it shadows the floor and appears in reflections."""
    path = os.path.join(WEB, 'models', f'table_{venue}.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    dark = plain('table-standin', (0.05, 0.03, 0.025), 0.5)
    felt = plain('felt-standin', (0.02, 0.2, 0.11), 0.95)
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1, fill_type='NGON', location=(0, 0, 0)); top = bpy.context.object; top.scale = (1.72, 2.0, 1)
    top.data.materials.append(felt); objs.append(top)
    for o in objs:
        if o is not top:
            o.data.materials.clear(); o.data.materials.append(dark)
        o.visible_camera = False


# ---------------------------------------------------------------- rooms

def classic():
    """The studio lounge: herringbone floor, plum plaster, a panelled feature wall with the neon, a lounge behind the table."""
    X, Y0, Y1, TOP = 10.0, -10.0, 10.5, 7.4
    floor = tex_material('floor', 'herringbone_parquet', tile=3.2, tint=(0.2, 0.15, 0.13), rough_mul=1.5)
    plaster = tex_material('plaster', 'painted_plaster_wall', tile=5.0, tint=(0.34, 0.22, 0.42))
    panel = tex_material('panel', 'dark_paneled_wood', tile=4.5, tint=(0.75, 0.6, 0.55))
    brick = tex_material('brick', 'brick_wall_001', tile=4.0, tint=(0.55, 0.42, 0.4))
    ceiling = plain('ceiling', (0.035, 0.03, 0.045), 0.9)
    trim = plain('trim', (0.03, 0.025, 0.03), 0.4)
    brass = plain('brass', (0.8, 0.56, 0.24), 0.3, 1.0)
    rug = tex_material('rug', 'velour_velvet', tile=2.0, tint=(0.11, 0.02, 0.035), dye=True)

    box('floor', (-X, Y0, FLOOR - 0.2), (X, Y1, FLOOR), floor)
    box('ceiling', (-X, Y0, TOP), (X, Y1, TOP + 0.2), ceiling)
    box('wall-back', (-X, Y1, FLOOR), (X, Y1 + 0.3, TOP), panel)
    box('wall-left', (-X - 0.3, Y0, FLOOR), (-X, Y1, TOP), brick)
    box('wall-right', (X, Y0, FLOOR), (X + 0.3, Y1, TOP), plaster)
    box('wall-front', (-X, Y0 - 0.3, FLOOR), (X, Y0, TOP), plaster)
    for name, lo, hi in (('skirt-back', (-X, Y1 - 0.06, FLOOR), (X, Y1, FLOOR + 0.42)), ('skirt-left', (-X, Y0, FLOOR), (-X + 0.06, Y1, FLOOR + 0.42)),
                         ('skirt-right', (X - 0.06, Y0, FLOOR), (X, Y1, FLOOR + 0.42))):
        box(name, lo, hi, trim, 0.01)
    # brass picture rail and a lit cove where the walls meet the ceiling
    box('rail-back', (-X, Y1 - 0.05, 4.6), (X, Y1, 4.7), brass)
    cove = glow('cove', (0.55, 0.25, 1.0), 14)
    box('cove-back', (-X + 0.3, Y1 - 0.12, TOP - 0.16), (X - 0.3, Y1 - 0.04, TOP - 0.1), cove)
    box('cove-left', (-X + 0.04, Y0 + 2, TOP - 0.16), (-X + 0.12, Y1 - 0.3, TOP - 0.1), cove)
    box('cove-right', (X - 0.12, Y0 + 2, TOP - 0.16), (X - 0.04, Y1 - 0.3, TOP - 0.1), cove)

    # the wordmark in neon on the feature wall, gold over purple
    neon('BWM', (0, Y1 - 0.12, 3.9), 2.3, (1.0, 0.72, 0.25), 26)
    neon('SPADES WITH THE CREW', (0, Y1 - 0.12, 3.05), 0.42, (0.62, 0.3, 1.0), 30)
    area('neon-spill', (0, Y1 - 0.6, 3.6), (7, 2.2), (1.0, 0.7, 0.45), 260, aim=(0, -1, -0.25))

    # a bordered rug under the game, so the floor around the table is never bare
    box('rug-border', (-5.2, -6.2, FLOOR), (5.2, 4.4, FLOOR + 0.025), plain('rug-border', (0.05, 0.035, 0.03), 0.95), 0.01)
    box('rug', (-4.85, -5.85, FLOOR), (4.85, 4.05, FLOOR + 0.035), rug, 0.01)

    # lounge just behind the table, close enough to sit in the top of the player's view
    prop('Sofa_01', (0, 7.6), 180)
    prop('modern_coffee_table_01', (0, 5.5), 90)
    prop('wine_bottles_01', (0.3, 5.5, FLOOR + 0.42 * SCALE), 20)
    prop('ArmChair_01', (-4.9, 5.6), 125)
    prop('mid_century_lounge_chair', (5.0, 5.4), -125)
    prop('side_table_01', (-3.5, 8.0), 0)
    prop('boombox', (-3.5, 8.0, FLOOR + 0.56 * SCALE), 200)
    prop('potted_plant_01', (-8.4, 8.6), 30, SCALE * 1.5)
    prop('potted_plant_02', (8.6, 8.4), 200, SCALE * 1.5)

    # either side of the table: bar stools and a cabinet on the left, a reading corner on the right
    prop('modern_wooden_cabinet', (-X + 0.9, 2.6), 90)
    prop('wine_bottles_01', (-X + 0.9, 2.4, FLOOR + 0.8 * SCALE), 90)
    prop('bar_chair_round_01', (-6.4, 1.8), 70)
    prop('bar_chair_round_01', (-6.9, -0.4), 110)
    prop('mid_century_lounge_chair', (6.6, 0.6), -80)
    prop('side_table_01', (7.0, 2.6), 0)
    prop('potted_plant_02', (7.4, -2.2), 90, SCALE * 1.3)
    prop('wooden_display_shelves_01', (X - 0.75, 5.4), -90)
    prop('wooden_display_shelves_01', (X - 0.75, 1.6), -90)
    prop('hanging_picture_frame_01', (-X + 0.05, 0.4, 2.6), 90)
    prop('hanging_picture_frame_02', (-X + 0.05, 6.4, 2.8), 90)
    prop('fancy_picture_frame_01', (-6.2, Y1 - 0.06, 2.4), 0)
    prop('hanging_picture_frame_02', (6.2, Y1 - 0.06, 2.6), 0)

    # practical lights: a pendant over the game, warm lamps in the lounge, sconces on the brick
    prop('modern_ceiling_lamp_01', (0, 0, TOP - 0.02), 0, SCALE * 1.4)
    area('pendant', (0, 0, 5.6), (2.4, 2.4), (1.0, 0.86, 0.68), 1500)
    point('lamp-left', (-3.5, 8.0, 2.3), (1.0, 0.72, 0.42), 420, 0.25)
    point('lamp-right', (7.0, 2.6, 2.0), (1.0, 0.72, 0.42), 320, 0.25)
    point('lamp-bar', (-8.2, 1.4, 2.6), (1.0, 0.7, 0.4), 300, 0.25)
    for y in (-2.5, 2.5, 7.5):
        prop('industrial_wall_lamp', (-X + 0.02, y, 3.6), 90)
        point(f'sconce{y}', (-X + 0.6, y, 3.5), (1.0, 0.62, 0.3), 110, 0.12)
        point(f'shelf-glow{y}', (X - 1.3, y, 2.2), (0.72, 0.42, 1.0), 70, 0.2)
    area('fill', (0, -6, 6.4), (8, 5), (0.6, 0.55, 1.0), 220, aim=(0, 0.4, -1))


def backyard():
    """Dusk cookout: lawn, a board fence strung with festoon lights, the grill going, a picnic table behind."""
    sky('qwantani_dusk_2', 0.8, 200)
    bpy.context.scene['exposure'] = -0.4
    ground(tex_material('lawn', 'leafy_grass', tile=5.0, tint=(0.75, 0.85, 0.6)))
    planks = tex_material('fence', 'brown_planks_03', tile=3.0, tint=(0.7, 0.6, 0.5))
    R = 13.0
    box('fence-back', (-R, R, FLOOR), (R, R + 0.12, FLOOR + 4.2), planks)
    box('fence-left', (-R - 0.12, -R, FLOOR), (-R, R, FLOOR + 4.2), planks)
    box('fence-right', (R, -R, FLOOR), (R + 0.12, R, FLOOR + 4.2), planks)
    for x in (-R, -6.5, 0, 6.5, R):
        cyl(f'post{x}', (x, R - 0.1, FLOOR), 0.12, 5.6, planks, 8)
    for x in (-9.0, 9.0):
        cyl(f'pole{x}', (x, -1.0, FLOOR), 0.07, 6.6, plain('pole', (0.08, 0.08, 0.08), 0.5), 10)
    string_lights('s1', (-9.0, -1.0, 5.6), (0, R - 0.1, 4.6), 0.9, 14)
    string_lights('s2', (9.0, -1.0, 5.6), (0, R - 0.1, 4.6), 0.9, 14)
    string_lights('s3', (-9.0, -1.0, 5.6), (9.0, -1.0, 5.6), 1.2, 16)
    prop('wooden_picnic_table', (0.5, 7.4), 8)
    prop('barrel_stove', (-6.2, 5.0), 30)
    point('coals', (-6.2, 5.0, 1.2), (1.0, 0.45, 0.15), 260, 0.2)
    prop('propane_tank', (-7.4, 4.2), 0)
    prop('stone_fire_pit', (6.4, 6.2), 0)
    point('fire', (6.4, 6.2, 0.2), (1.0, 0.5, 0.18), 520, 0.3)
    for i, (x, y, r) in enumerate(((4.6, 4.4, -140), (8.2, 5.0, 160), (6.8, 8.2, -100), (-5.2, 1.4, 70), (5.6, 0.2, -80))):
        prop('plastic_monobloc_chair_01', (x, y), r)
    prop('planter_box_01', (-10.8, 11.4), 0, SCALE * 1.2)
    prop('potted_plant_01', (10.6, 11.2), 40, SCALE * 1.5)
    prop('garden_gnome', (-9.2, 10.2), 150, SCALE * 1.4)
    prop('boombox', (-6.0, -1.2), 110)
    prop('football', (3.4, 3.2), 0)
    prop('plastic_crate_01', (-7.2, 1.0), 20)
    prop('metal_trash_can', (11.4, 2.0), 0)
    prop('wooden_stool_01', (-4.8, 4.0), 0)


def mansion():
    """Grand salon: polished marble, panelled walls, a chandelier over the game, busts and gilt frames."""
    X, Y0, Y1, TOP = 11.0, -10.0, 11.0, 9.0
    marble = tex_material('marble', 'marble_01', tile=5.0, tint=(0.92, 0.9, 0.86), rough_mul=0.35)
    wall = tex_material('wall', 'plastered_wall_04', tile=5.0, tint=(0.82, 0.76, 0.64))
    panel = tex_material('panel', 'dark_paneled_wood', tile=4.5, tint=(0.95, 0.8, 0.62))
    gold = plain('gold', (0.86, 0.62, 0.22), 0.25, 1.0)
    shell(X, Y0, Y1, TOP, marble, wall, wall, wall, plain('ceiling', (0.78, 0.74, 0.66), 0.8))
    wainscot(X, Y0, Y1, 2.6, panel, gold)
    box('cornice', (-X, Y1 - 0.2, TOP - 0.3), (X, Y1, TOP), gold, 0.03)
    box('runner', (-4.6, -6.0, FLOOR), (4.6, 4.2, FLOOR + 0.03), tex_material('runner', 'velour_velvet', tile=2.0, tint=(0.03, 0.04, 0.16), dye=True), 0.01)
    for x in (-7.5, 7.5):
        cyl(f'column{x}', (x, Y1 - 1.0, FLOOR), 0.55, TOP - FLOOR, marble, 32)
        box(f'plinth{x}', (x - 0.75, Y1 - 1.75, FLOOR), (x + 0.75, Y1 - 0.25, FLOOR + 0.5), marble, 0.03)
    prop('Chandelier_01', (0, 0.5, TOP - 0.05), 0, SCALE * 1.3)
    area('chandelier', (0, 0.5, 6.0), (2.6, 2.6), (1.0, 0.86, 0.66), 2200)
    prop('Chandelier_03', (0, 7.2, TOP - 0.05), 0, SCALE)
    point('chandelier-2', (0, 7.2, 5.6), (1.0, 0.82, 0.6), 900, 0.4)
    console = prop('ClassicConsole_01', (0, Y1 - 0.9), 180)
    on(console, 'marble_bust_01', 0, 0, 180)
    on(console, 'brass_candleholders', -1.5, 0, 0)
    on(console, 'brass_vase_01', 1.5, 0, 0)
    prop('ornate_mirror_01', (0, Y1 - 0.08, 3.4), 180, SCALE * 1.2)
    prop('fancy_picture_frame_01', (-5.0, Y1 - 0.08, 3.6), 0, SCALE * 1.3)
    prop('fancy_picture_frame_02', (5.0, Y1 - 0.08, 3.6), 0, SCALE * 1.3)
    prop('vintage_grandfather_clock_01', (-X + 0.8, 4.0), 90)
    prop('horse_statue_01', (X - 1.6, 4.4), -90, SCALE * 1.4)
    prop('sofa_02', (0, 7.4), 180)
    prop('gothic_coffee_table', (0, 5.3), 0)
    prop('GreenChair_01', (-5.0, 5.4), 125)
    prop('GreenChair_01', (5.0, 5.4), -125)
    prop('antique_ceramic_vase_01', (-7.0, 1.2), 0, SCALE * 1.6)
    prop('potted_plant_02', (7.2, 0.6), 0, SCALE * 1.5)
    for y in (-2.0, 4.5):
        point(f'sconce-l{y}', (-X + 0.5, y, 4.2), (1.0, 0.8, 0.55), 240, 0.15)
        point(f'sconce-r{y}', (X - 0.5, y, 4.2), (1.0, 0.8, 0.55), 240, 0.15)
    area('fill', (0, -6, 7.5), (8, 5), (1.0, 0.92, 0.82), 500, aim=(0, 0.4, -1))


def barbershop():
    """Back of the shop: checkerboard floor, a row of chairs under mirrors, tube lights, the OPEN sign in the window."""
    X, Y0, Y1, TOP = 10.0, -10.0, 10.0, 7.2
    floor = tex_material('floor', 'checkered_pavement_tiles', tile=3.2, tint=(0.9, 0.9, 0.9), rough_mul=0.6)
    wall = tex_material('wall', 'beige_wall_001', tile=5.0, tint=(0.86, 0.88, 0.9))
    tile = tex_material('tile', 'blue_floor_tiles_01', tile=2.4, tint=(0.75, 0.85, 0.95), rough_mul=0.5)
    brick = tex_material('brick', 'brick_wall_003', tile=4.0, tint=(0.8, 0.7, 0.66))
    chrome = plain('chrome', (0.8, 0.82, 0.85), 0.15, 1.0)
    shell(X, Y0, Y1, TOP, floor, wall, wall, brick, plain('ceiling', (0.75, 0.75, 0.74), 0.9), plain('skirt', (0.05, 0.05, 0.06), 0.4))
    wainscot(X, Y0, Y1, 2.3, tile, chrome)
    for i, y in enumerate((-1.0, 3.2, 7.4)):
        prop('BarberShopChair_01', (-X + 2.6, y), 90)
        box(f'counter{i}', (-X + 0.05, y - 1.2, FLOOR + 1.9), (-X + 0.9, y + 1.2, FLOOR + 2.05), plain('counter', (0.07, 0.07, 0.08), 0.3), 0.02)
        prop('ornate_mirror_01', (-X + 0.08, y, 3.0), 90, SCALE * 0.9)
        point(f'mirror-light{i}', (-X + 0.7, y, 4.6), (1.0, 0.95, 0.88), 160, 0.2)
    for i, (x, y) in enumerate(((-4.0, -1.5), (4.0, -1.5), (-4.0, 4.5), (4.0, 4.5))):
        fluorescent(f'tube{i}', (x, y, TOP - 0.02))
    bench = prop('painted_wooden_bench', (X - 1.0, 3.0), -90)
    prop('potted_plant_04', (X - 1.2, 6.6), 0, SCALE * 1.6)
    desk = prop('ClassicConsole_01', (3.4, Y1 - 0.9), 180)
    on(desk, 'CashRegister_01', 0, 0, 180)
    prop('wall_clock', (0, Y1 - 0.06, 4.6), 180, SCALE * 1.4)
    prop('Television_01', (-4.2, Y1 - 1.0, FLOOR + 3.0), 170)
    prop('WetFloorSign_01', (6.4, 6.6), 30)
    prop('metal_stool_01', (5.4, 0.2), 0)
    prop('steel_frame_shelves_03', (X - 0.8, -2.4), -90)
    prop('boombox', (X - 1.0, -2.4, FLOOR + 2.4), -90)
    prop('american_football', (X - 1.0, 3.6, FLOOR + 1.3), 0)
    prop('hanging_picture_frame_03', (X - 0.06, 0.6, 3.6), -90)
    neon('OPEN', (-3.4, Y1 - 0.12, 4.9), 1.0, (1.0, 0.1, 0.2), 30)
    area('open-spill', (-3.4, Y1 - 0.5, 4.9), (3, 1.2), (1.0, 0.15, 0.25), 160, aim=(0, -1, -0.3))
    # the pole: red, white and blue bands in a lit glass tube
    for i in range(9):
        cyl(f'pole{i}', (7.4, Y1 - 0.5, 2.6 + i * 0.26), 0.22, 0.26, glow(f'pole{i}', ((1, 0.08, 0.1), (1, 1, 1), (0.1, 0.25, 1))[i % 3], 5), 20)
    cyl('pole-cap', (7.4, Y1 - 0.5, 4.94), 0.27, 0.16, chrome, 20)
    cyl('pole-base', (7.4, Y1 - 0.5, 2.44), 0.27, 0.16, chrome, 20)


def church():
    """Fellowship hall: block walls painted cream, lino floor, tube lights, the potluck table and stacked chairs."""
    X, Y0, Y1, TOP = 12.0, -10.0, 11.5, 6.6
    floor = tex_material('floor', 'old_linoleum_flooring_01', tile=4.0, tint=(0.9, 0.86, 0.76), rough_mul=0.7)
    wall = tex_material('wall', 'concrete_block_wall', tile=4.0, tint=(0.95, 0.9, 0.74))
    shell(X, Y0, Y1, TOP, floor, wall, wall, wall, plain('ceiling', (0.82, 0.82, 0.8), 0.9), plain('skirt', (0.25, 0.2, 0.15), 0.6))
    box('dado', (-X, Y1 - 0.05, FLOOR + 2.2), (X, Y1, FLOOR + 2.36), plain('dado', (0.32, 0.22, 0.14), 0.5))
    for i, (x, y) in enumerate(((-6.0, -1.0), (0.0, -1.0), (6.0, -1.0), (-6.0, 5.5), (0.0, 5.5), (6.0, 5.5))):
        fluorescent(f'tube{i}', (x, y, TOP - 0.02), 3.4, 330)
    prop('ceiling_fan', (0, 2.4, TOP - 0.02), 0, SCALE * 1.2)
    buffet = prop('WoodenTable_01', (0, 8.4), 0, SCALE * 1.2)
    on(buffet, 'pot_enamel_01', -1.4, 0, 0)
    on(buffet, 'carrot_cake', 0, 0.1, 30)
    on(buffet, 'strawberry_chocolate_cake', 1.2, -0.1, 0)
    on(buffet, 'plastic_thermos', 2.1, 0.2, 0)
    for i in range(5):
        prop('SchoolChair_01', (-7.5 + i * 1.5, 5.6), 180 + (i - 2) * 6)
    for i, (x, y, r) in enumerate(((-5.4, 1.6, 70), (5.6, 1.2, -75), (6.4, 4.0, -110), (-6.6, -1.4, 95))):
        prop('plastic_monobloc_chair_01', (x, y), r)
    prop('standing_chalkboard_01', (-8.4, 9.4), 20, SCALE * 1.2)
    prop('projector_screen', (6.6, Y1 - 0.6), 180, SCALE * 1.1)
    prop('wall_clock', (0, Y1 - 0.06, 4.6), 180, SCALE * 1.4)
    prop('hanging_picture_frame_01', (-4.4, Y1 - 0.06, 3.6), 0, SCALE * 1.3)
    prop('fire_alarm', (X - 0.06, 2.0, 3.6), -90)
    prop('korean_fire_extinguisher_01', (X - 0.5, 3.2), -90)
    prop('cardboard_box_01', (-X + 1.2, 6.8), 15)
    prop('cardboard_box_01', (-X + 1.4, 5.2), 70)
    prop('metal_trash_can', (X - 1.0, 8.6), 0)


def rooftop():
    """Up top at night: concrete deck, brick stair bulkhead, parapet, festoon lights, the city all round."""
    sky('rooftop_night', 0.45, 90)
    bpy.context.scene['exposure'] = 0.2
    deck = tex_material('deck', 'concrete_floor_02', tile=5.0, tint=(0.7, 0.7, 0.74))
    brick = tex_material('brick', 'brick_wall_003', tile=4.0, tint=(0.7, 0.6, 0.58))
    conc = tex_material('parapet', 'concrete_wall_006', tile=4.0, tint=(0.75, 0.75, 0.78))
    R = 14.0
    box('roof', (-R, -R, FLOOR - 0.4), (R, R, FLOOR), deck)
    for name, lo, hi in (('p-back', (-R, R - 0.5, FLOOR), (R, R, FLOOR + 2.2)), ('p-left', (-R, -R, FLOOR), (-R + 0.5, R, FLOOR + 2.2)), ('p-right', (R - 0.5, -R, FLOOR), (R, R, FLOOR + 2.2))):
        box(name, lo, hi, conc, 0.03)
    box('bulkhead', (-R + 0.5, 6.0, FLOOR), (-7.0, R - 0.5, FLOOR + 6.4), brick)
    prop('rollershutter_door', (-7.0, 9.6), 90)
    prop('security_light', (-6.96, 9.6, 4.6), 90)
    area('door-light', (-6.6, 9.6, 4.4), (1.2, 0.5), (1.0, 0.85, 0.65), 420, aim=(1, 0, -0.8))
    for x in (-10.0, 10.0):
        cyl(f'mast{x}', (x, 11.0, FLOOR), 0.08, 7.4, plain('mast', (0.06, 0.06, 0.07), 0.5), 10)
        cyl(f'mast-f{x}', (x, -2.0, FLOOR), 0.08, 7.4, plain('mast-f', (0.06, 0.06, 0.07), 0.5), 10)
    string_lights('r1', (-10, 11, 6.2), (10, 11, 6.2), 1.0, 16)
    string_lights('r2', (-10, -2, 6.2), (10, 11, 6.2), 1.4, 20)
    string_lights('r3', (10, -2, 6.2), (-10, 11, 6.2), 1.4, 20)
    prop('exterior_aircon_unit', (8.6, 11.6), 180, SCALE * 1.2)
    prop('exterior_aircon_unit', (5.4, 11.8), 180, SCALE * 1.2)
    prop('outdoor_table_chair_set_01', (2.0, 7.2), 20)
    prop('modular_street_seating', (9.6, 3.4), -90)
    prop('planter_box_02', (-4.0, 12.0), 0, SCALE * 1.3)
    prop('planter_box_03', (11.6, 8.0), 90, SCALE * 1.3)
    prop('potted_plant_01', (-6.0, 4.4), 0, SCALE * 1.5)
    prop('metal_stool_02', (-5.6, 1.4), 0)
    prop('plastic_crate_01', (-7.6, 3.2), 25)
    prop('boombox', (-7.6, 3.2, FLOOR + 0.8), 60)
    box('sign', (2.0, R - 0.56, 2.9), (8.5, R - 0.5, 3.0), glow('sign', (1.0, 0.25, 0.85), 22))
    area('sign-spill', (5.2, R - 1.0, 2.6), (6.5, 0.6), (1.0, 0.3, 0.85), 380, aim=(0, -1, -0.6))
    area('moon', (0, -4, 9), (8, 8), (0.55, 0.65, 1.0), 500, aim=(0, 0.3, -1))


def speakeasy():
    """Behind the false wall: dark panelling, a velvet curtain, the bar and its barrels, low amber light."""
    X, Y0, Y1, TOP = 9.5, -10.0, 10.0, 6.6
    floor = tex_material('floor', 'herringbone_parquet', tile=3.2, tint=(0.24, 0.16, 0.11), rough_mul=1.3)
    panel = tex_material('panel', 'dark_paneled_wood', tile=4.5, tint=(0.62, 0.42, 0.32))
    brick = tex_material('brick', 'brick_wall_001', tile=4.0, tint=(0.4, 0.3, 0.27))
    velvet = tex_material('velvet', 'velour_velvet', tile=1.6, tint=(0.22, 0.012, 0.025), dye=True)
    wood = tex_material('bar-top', 'wood_table_001', tile=2.5, tint=(0.5, 0.32, 0.22), rough_mul=0.6)
    brass = plain('brass', (0.8, 0.56, 0.24), 0.3, 1.0)
    shell(X, Y0, Y1, TOP, floor, panel, brick, panel, plain('ceiling', (0.03, 0.022, 0.018), 0.7), plain('skirt', (0.03, 0.02, 0.015), 0.4))
    box('rug', (-4.7, -5.8, FLOOR), (4.7, 4.1, FLOOR + 0.03), tex_material('rug', 'velour_velvet', tile=2.0, tint=(0.07, 0.015, 0.012), dye=True), 0.01)
    # stage curtain across the back, in pleats
    for i in range(22):
        cyl(f'pleat{i}', (-5.0 + i * 0.48, Y1 - 0.4, FLOOR), 0.3, TOP - FLOOR, velvet, 10)
    # the bar along the left wall
    box('bar', (-X + 0.3, -2.0, FLOOR), (-X + 1.9, 7.0, FLOOR + 2.7), panel, 0.02)
    box('bar-top', (-X + 0.2, -2.15, FLOOR + 2.7), (-X + 2.2, 7.15, FLOOR + 2.86), wood, 0.03)
    box('foot-rail', (-X + 2.3, -2.0, FLOOR + 0.5), (-X + 2.38, 7.0, FLOOR + 0.58), brass)
    for i, y in enumerate((-0.6, 1.6, 3.8, 6.0)):
        prop('bar_chair_round_01', (-X + 3.2, y), 90 + (i - 1.5) * 12)
        prop('wine_bottles_01', (-X + 1.0, y, FLOOR + 2.86), 20 * i)
        point(f'bar-glow{i}', (-X + 1.0, y, 4.6), (1.0, 0.62, 0.28), 150, 0.12)
    prop('brass_goblets', (-X + 1.2, 2.6, FLOOR + 2.86), 0)
    box('back-bar', (-X + 0.02, -1.5, FLOOR + 3.6), (-X + 0.5, 6.5, FLOOR + 3.7), wood)
    box('back-bar-glow', (-X + 0.03, -1.5, FLOOR + 3.5), (-X + 0.08, 6.5, FLOOR + 3.56), glow('amber', (1.0, 0.55, 0.2), 10))
    prop('wine_barrel_01', (7.6, 8.0), 0, SCALE * 1.1)
    prop('wine_barrel_01', (6.0, 8.6), 40, SCALE * 1.1)
    prop('wooden_barrels_01', (X - 1.6, 4.6), -90)
    prop('sofa_03', (2.6, 7.4), 180)
    table = prop('gothic_coffee_table', (2.6, 5.4), 0)
    on(table, 'vintage_oil_lamp', 0, 0, 0)
    on(table, 'brass_candleholders', 0.9, 0, 0)
    point('oil-lamp', (2.6, 5.4, 1.2), (1.0, 0.6, 0.25), 260, 0.1)
    prop('GreenChair_01', (5.6, 3.2), -110)
    shelf = prop('wooden_display_shelves_01', (X - 0.75, 0.4), -90)
    prop('vintage_radio_transceiver', (X - 0.9, 0.4, FLOOR + 2.4), -90)
    prop('mantel_clock_01', (X - 0.9, 1.4, FLOOR + 2.4), -90)
    prop('fancy_picture_frame_01', (X - 0.06, 4.0, 3.6), -90, SCALE * 1.2)
    prop('fancy_picture_frame_02', (X - 0.06, -2.6, 3.4), -90, SCALE * 1.2)
    prop('Chandelier_02', (0, 0.4, TOP - 0.05), 0, SCALE * 1.1)
    area('chandelier', (0, 0.4, 5.0), (2.2, 2.2), (1.0, 0.74, 0.46), 1250)
    for y in (-2.0, 3.0, 8.0):
        prop('industrial_wall_sconce', (X - 0.04, y, 4.2), -90)
        point(f'sconce{y}', (X - 0.6, y, 4.1), (1.0, 0.58, 0.26), 120, 0.12)
    area('stage', (0, Y1 - 2.0, 6.2), (9, 1.0), (1.0, 0.45, 0.25), 420, aim=(0, 0.6, -1))


def slot_machine(name, at, rot, hue):
    """No CC0 slot machine exists, so this one is built: a cabinet, a lit screen, a glowing topper and a chrome tray."""
    body = plain(f'{name}-body', (0.03, 0.03, 0.04), 0.3, 0.6)
    chrome = plain(f'{name}-chrome', (0.8, 0.8, 0.82), 0.15, 1.0)
    root = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(root)
    parts = [box(f'{name}-cab', (-0.7, -0.6, 0), (0.7, 0.6, 3.6), body, 0.05),
             box(f'{name}-screen', (-0.56, -0.63, 1.9), (0.56, -0.6, 3.0), glow(f'{name}-scr', hue, 6)),
             box(f'{name}-reels', (-0.56, -0.64, 1.25), (0.56, -0.6, 1.75), glow(f'{name}-reel', (1.0, 0.95, 0.8), 4)),
             box(f'{name}-top', (-0.75, -0.66, 3.6), (0.75, 0.66, 4.3), glow(f'{name}-topper', hue, 9), 0.06),
             box(f'{name}-tray', (-0.6, -0.9, 0.9), (0.6, -0.6, 1.05), chrome, 0.02)]
    for p_ in parts:
        p_.parent = root
    root.location = (at[0], at[1], FLOOR); root.rotation_euler = (0, 0, math.radians(rot))
    point(f'{name}-glow', (at[0] - math.sin(math.radians(rot)) * -1.2, at[1] - math.cos(math.radians(rot)) * 1.2, 1.6), hue, 120, 0.3)


def vegas():
    """High-roller room: patterned carpet, dark panelling with gold, marble columns, banks of slots, the cage."""
    X, Y0, Y1, TOP = 12.0, -10.0, 11.5, 7.8
    carpet = tex_material('carpet', 'quatrefoil_jacquard_fabric', tile=5.0, tint=(0.62, 0.1, 0.14), rough_mul=1.4)
    panel = tex_material('panel', 'dark_paneled_wood', tile=4.5, tint=(0.6, 0.36, 0.3))
    marble = tex_material('marble', 'marble_01', tile=4.0, tint=(0.5, 0.42, 0.36), rough_mul=0.35)
    gold = plain('gold', (0.9, 0.66, 0.22), 0.22, 1.0)
    shell(X, Y0, Y1, TOP, carpet, panel, panel, panel, plain('ceiling', (0.035, 0.02, 0.03), 0.6), gold)
    box('cornice', (-X, Y1 - 0.16, TOP - 0.5), (X, Y1, TOP - 0.3), gold, 0.02)
    box('cove', (-X + 0.3, Y1 - 0.2, TOP - 0.28), (X - 0.3, Y1 - 0.1, TOP - 0.2), glow('cove', (1.0, 0.7, 0.3), 12))
    for x in (-8.0, 8.0):
        for y in (-3.0, 6.0):
            cyl(f'col{x}{y}', (x, y, FLOOR), 0.5, TOP - FLOOR, marble, 32)
            cyl(f'col-base{x}{y}', (x, y, FLOOR), 0.66, 0.4, gold, 32)
            cyl(f'col-cap{x}{y}', (x, y, TOP - 0.4), 0.66, 0.4, gold, 32)
    hues = ((1.0, 0.2, 0.5), (0.2, 0.7, 1.0), (1.0, 0.75, 0.15), (0.5, 0.3, 1.0), (0.2, 1.0, 0.6))
    for i in range(5):
        slot_machine(f'slot-b{i}', (-4.4 + i * 1.7, Y1 - 1.0), 0, hues[i])
    for i in range(4):
        slot_machine(f'slot-l{i}', (-X + 1.0, 0.4 + i * 1.8), -90, hues[(i + 2) % 5])
        slot_machine(f'slot-r{i}', (X - 1.0, 0.4 + i * 1.8), 90, hues[(i + 4) % 5])
    for i, x in enumerate((-3.6, -1.9, -0.2, 1.5, 3.2)):
        prop('bar_chair_round_01', (x, Y1 - 2.7), 180)
    neon('HIGH ROLLER', (0, Y1 - 0.14, 5.9), 1.15, (1.0, 0.74, 0.2), 28)
    neon('JACKPOT', (0, Y1 - 0.14, 5.0), 0.6, (1.0, 0.2, 0.5), 30)
    area('sign-spill', (0, Y1 - 0.7, 5.4), (9, 1.6), (1.0, 0.65, 0.3), 420, aim=(0, -1, -0.4))
    prop('Chandelier_01', (0, 0.5, TOP - 0.05), 0, SCALE * 1.4)
    area('chandelier', (0, 0.5, 5.8), (2.6, 2.6), (1.0, 0.84, 0.6), 1900)
    for x in (-5.0, 5.0):
        for y in (-4.0, 3.0):
            area(f'down{x}{y}', (x, y, TOP - 0.05), (0.5, 0.5), (1.0, 0.82, 0.6), 320)
    # velvet rope either side of the table
    for sx in (-1, 1):
        for i, y in enumerate((-3.0, 0.0, 3.0)):
            cyl(f'post{sx}{i}', (sx * 6.0, y, FLOOR), 0.07, 2.4, gold, 12)
            ball(f'post-top{sx}{i}', (sx * 6.0, y, FLOOR + 2.46), 0.13, gold)
        box(f'rope{sx}', (sx * 6.0 - 0.05, -3.0, FLOOR + 2.0), (sx * 6.0 + 0.05, 3.0, FLOOR + 2.1), tex_material(f'rope{sx}', 'velour_velvet', tile=1.0, tint=(0.3, 0.012, 0.03), dye=True))
    prop('sofa_02', (-6.6, 7.8), 150)
    prop('modern_arm_chair_01', (6.6, 7.6), -150)
    prop('brass_vase_02', (-9.6, 9.6), 0, SCALE * 2.0)
    prop('potted_plant_02', (9.8, 9.6), 0, SCALE * 1.6)


def tiki_torch(name, at):
    cyl(name, (at[0], at[1], FLOOR), 0.06, 4.6, tex_material(f'{name}-pole', 'bamboo_veneer', tile=1.0, tint=(0.8, 0.65, 0.4)), 10)
    cyl(f'{name}-cup', (at[0], at[1], FLOOR + 4.5), 0.16, 0.4, plain(f'{name}-cup', (0.12, 0.08, 0.05), 0.8), 12)
    ball(f'{name}-flame', (at[0], at[1], FLOOR + 5.1), 0.14, glow(f'{name}-fl', (1.0, 0.5, 0.12), 60))
    point(f'{name}-light', (at[0], at[1], FLOOR + 5.2), (1.0, 0.52, 0.2), 620, 0.15)


def beach():
    """Sunset on the sand: a thatched cabana overhead, torches lit, palms, the sea to the horizon."""
    sky('umhlanga_sunrise', 1.0, 250)
    bpy.context.scene['exposure'] = 0.2
    ground(tex_material('sand', 'coast_sand_01', tile=6.0, tint=(1.0, 0.92, 0.8)), 400)
    bamboo = tex_material('bamboo', 'bamboo_veneer', tile=1.2, tint=(0.85, 0.7, 0.45))
    thatch = tex_material('thatch', 'thatch_roof_angled', tile=3.0, tint=(1.0, 0.85, 0.55))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f'post{sx}{sy}', (sx * 5.6, sy * 5.6 + 0.5, FLOOR), 0.16, 7.0, bamboo, 14)
    box('roof', (-6.6, -6.0, 6.1), (6.6, 7.0, 6.5), thatch, 0.05)
    box('roof-ridge', (-4.4, -3.8, 6.5), (4.4, 4.8, 7.2), thatch, 0.05)
    for i, (x, y) in enumerate(((-7.6, 6.4), (7.6, 6.4), (-8.4, -0.5), (8.4, -0.5), (-3.4, 10.5), (3.4, 10.5))):
        tiki_torch(f'torch{i}', (x, y))
    prop('island_tree_01', (-11.0, 13.0), 0, 1.6)
    prop('island_tree_02', (12.0, 15.0), 90, 1.6)
    prop('island_tree_01', (5.0, 22.0), 200, 1.9)
    prop('painted_wooden_bench', (0, 9.0), 180)
    prop('wooden_barrels_01', (-7.0, 9.4), 30)
    prop('Ukulele_01', (1.2, 8.4, FLOOR + 1.3), 40)
    prop('lifebuoy', (5.7, 6.1, 2.6), 90)
    prop('wicker_basket_01', (-2.6, 8.2), 0)
    prop('wooden_lantern_01', (2.8, 6.8), 0)
    point('lantern', (2.8, 6.8, 0.0), (1.0, 0.6, 0.25), 180, 0.1)
    prop('folding_wooden_stool', (-5.6, 2.6), 60)
    prop('folding_wooden_stool', (5.8, 1.8), -70)
    prop('life_jacket', (6.6, 4.0), 20)
    prop('wooden_crate_01', (7.2, 8.6), 15)
    prop('treasure_chest', (-5.4, 6.4), 150)
    prop('wooden_bucket_01', (4.2, 9.6), 0)


def grandma():
    """The kitchen: lino floor, painted boards to the chair rail, the stove, the sideboard, a sunny window, plastic on the couch."""
    X, Y0, Y1, TOP = 9.5, -10.0, 9.5, 6.6
    floor = tex_material('floor', 'linoleum_brown', tile=3.0, tint=(0.95, 0.88, 0.74), rough_mul=0.6)
    wall = tex_material('wall', 'beige_wall_002', tile=5.0, tint=(1.0, 0.9, 0.62))
    boards = tex_material('boards', 'distressed_painted_planks', tile=3.0, tint=(0.82, 0.9, 0.8))
    shell(X, Y0, Y1, TOP, floor, wall, wall, wall, plain('ceiling', (0.88, 0.86, 0.8), 0.9))
    wainscot(X, Y0, Y1, 2.4, boards, plain('rail', (0.9, 0.88, 0.8), 0.5))
    window('window', (-2.2, Y1 - 0.04, 2.6), (2.2, Y1, 5.2), aim=(0, -1, -0.35))
    box('curtain-l', (-3.1, Y1 - 0.14, 2.4), (-2.2, Y1 - 0.06, 5.5), plain('curtain', (0.85, 0.3, 0.28), 0.9))
    box('curtain-r', (2.2, Y1 - 0.14, 2.4), (3.1, Y1 - 0.06, 5.5), plain('curtain2', (0.85, 0.3, 0.28), 0.9))
    box('counter', (-X + 0.05, 1.0, FLOOR), (-X + 1.7, 8.6, FLOOR + 2.35), boards, 0.02)
    box('worktop', (-X + 0.05, 0.9, FLOOR + 2.35), (-X + 1.85, 8.7, FLOOR + 2.5), plain('worktop', (0.8, 0.74, 0.62), 0.35), 0.02)
    prop('electric_stove', (-X + 1.0, -0.6), 90)
    prop('vintage_microwave', (-X + 0.95, 6.8, FLOOR + 2.5), 90)
    prop('vintage_electric_kettle', (-X + 0.95, 4.6, FLOOR + 2.5), 60)
    prop('pot_enamel_01', (-X + 0.95, 3.2, FLOOR + 2.5), 0)
    prop('brass_pan_01', (-X + 0.95, 2.0, FLOOR + 2.5), 30)
    prop('painted_wooden_shelves', (-X + 0.5, 5.0, FLOOR + 3.6), 90)
    prop('painted_wooden_cabinet', (X - 0.9, 5.4), -90)
    prop('painted_wooden_cabinet_02', (X - 0.9, 1.6), -90)
    prop('mantel_clock_01', (X - 0.9, 1.6, FLOOR + 2.9), -90)
    prop('painted_wooden_sofa', (2.6, 7.6), 180)
    prop('throw_pillows_01', (2.6, 7.4, FLOOR + 1.3), 180)
    side = prop('painted_wooden_nightstand', (6.2, 8.0), 180)
    on(side, 'Television_01', 0, 0, 190)
    prop('Rockingchair_01', (-4.4, 5.4), 130)
    tea = prop('WoodenTable_02', (-3.6, 8.0), 0, SCALE * 0.9)
    on(tea, 'tea_set_01', 0, 0, 0)
    on(tea, 'carrot_cake', 0.9, 0.1, 0)
    prop('WoodenChair_01', (6.0, 1.6), -80)
    prop('WoodenChair_01', (-5.8, 1.2), 80)
    prop('potted_plant_04', (0, Y1 - 0.5, FLOOR + 2.5), 0, SCALE * 1.2)
    prop('wall_clock', (5.4, Y1 - 0.06, 4.6), 180, SCALE * 1.3)
    prop('hanging_picture_frame_01', (-5.4, Y1 - 0.06, 3.8), 0, SCALE * 1.2)
    prop('hanging_picture_frame_02', (X - 0.06, -1.6, 3.8), -90, SCALE * 1.2)
    prop('hanging_picture_frame_03', (X - 0.06, 3.4, 4.2), -90, SCALE * 1.2)
    prop('jug_01', (-X + 0.95, 8.0, FLOOR + 2.5), 0)
    prop('wooden_bowl_01', (-X + 0.95, 5.6, FLOOR + 2.5), 0)
    prop('ceiling_fan', (0, 0.6, TOP - 0.02), 0, SCALE * 1.1)
    area('ceiling-light', (0, 0.6, 5.6), (1.6, 1.6), (1.0, 0.88, 0.7), 1500)
    point('stove-light', (-X + 1.2, -0.6, 4.4), (1.0, 0.85, 0.65), 200, 0.2)
    area('fill', (0, -6, 6.0), (8, 5), (1.0, 0.92, 0.8), 380, aim=(0, 0.4, -1))


def yacht():
    """On deck at sunset: teak boards, white bulwarks with a chrome rail, loungers aft, open water on every side."""
    sky('venice_sunset', 1.0, 100)
    bpy.context.scene['exposure'] = 0.0
    water(FLOOR - 3.0)
    teak = tex_material('teak', 'wood_floor_deck', tile=4.0, tint=(0.95, 0.78, 0.58), rough_mul=0.8)
    white = plain('hull', (0.9, 0.9, 0.88), 0.25)
    chrome = plain('chrome', (0.85, 0.86, 0.88), 0.1, 1.0)
    W, A, F = 7.2, -12.0, 16.0  # half beam, aft, bow
    box('deck', (-W, A, FLOOR - 0.5), (W, F, FLOOR), teak)
    box('bulwark-l', (-W - 0.3, A, FLOOR - 0.5), (-W, F, FLOOR + 1.0), white, 0.05)
    box('bulwark-r', (W, A, FLOOR - 0.5), (W + 0.3, F, FLOOR + 1.0), white, 0.05)
    box('bulwark-bow', (-W - 0.3, F, FLOOR - 0.5), (W + 0.3, F + 0.3, FLOOR + 1.0), white, 0.05)
    box('cap-l', (-W - 0.4, A, FLOOR + 1.0), (-W + 0.1, F, FLOOR + 1.12), teak, 0.03)
    box('cap-r', (W - 0.1, A, FLOOR + 1.0), (W + 0.4, F, FLOOR + 1.12), teak, 0.03)
    box('cap-bow', (-W - 0.4, F - 0.1, FLOOR + 1.0), (W + 0.4, F + 0.4, FLOOR + 1.12), teak, 0.03)
    for sx in (-1, 1):
        for i in range(10):
            y = A + 1.5 + i * 2.9
            cyl(f'stanchion{sx}{i}', (sx * (W + 0.15), y, FLOOR + 1.1), 0.045, 1.4, chrome, 10)
        for h in (1.8, 2.5):
            box(f'rail{sx}{h}', (sx * (W + 0.15) - 0.04, A + 1.0, FLOOR + h), (sx * (W + 0.15) + 0.04, F, FLOOR + h + 0.08), chrome)
    for i in range(6):
        x = -W + 0.6 + i * (2 * W - 1.2) / 5
        cyl(f'bow-st{i}', (x, F + 0.15, FLOOR + 1.1), 0.045, 1.4, chrome, 10)
    for h in (1.8, 2.5):
        box(f'bow-rail{h}', (-W, F + 0.11, FLOOR + h), (W, F + 0.19, FLOOR + h + 0.08), chrome)
    cyl('jackstaff', (0, F - 0.4, FLOOR), 0.05, 5.0, chrome, 10)
    box('ensign', (0.05, F - 0.42, FLOOR + 3.6), (1.8, F - 0.38, FLOOR + 4.8), plain('ensign', (0.75, 0.08, 0.1), 0.8))
    prop('lifebuoy', (-W + 0.02, 4.0, FLOOR + 1.9), 90)
    prop('lifebuoy', (W - 0.02, 4.0, FLOOR + 1.9), -90)
    prop('mid_century_lounge_chair', (-3.2, 8.6), 170)
    prop('mid_century_lounge_chair', (3.2, 8.6), -170)
    side = prop('side_table_01', (0, 9.0), 0)
    on(side, 'brass_goblets', 0, 0, 0)
    on(side, 'wine_bottles_01', 0.3, 0.2, 0)
    prop('life_jacket', (-5.6, 2.0), 30)
    prop('wooden_bucket_01', (5.6, 1.4), 0)
    prop('wicker_basket_02', (5.2, 11.6), 0)
    prop('potted_plant_04', (-5.4, 12.0), 0, SCALE * 1.5)
    prop('vintage_binocular', (0.6, 9.2, FLOOR + 1.6), 40)
    for x in (-W + 0.4, W - 0.4):
        for y in (-2.0, 6.0, 13.0):
            point(f'deck-light{x}{y}', (x, y, FLOOR + 0.5), (1.0, 0.8, 0.55), 60, 0.08)


ROOMS = {'classic': classic, 'backyard': backyard, 'mansion': mansion, 'barbershop': barbershop, 'church': church, 'rooftop': rooftop,
         'speakeasy': speakeasy, 'vegas': vegas, 'beach': beach, 'grandma': grandma, 'yacht': yacht}


# ---------------------------------------------------------------- rendering

def look(forward, up):
    f, u = Vector(forward).normalized(), Vector(up).normalized()
    r = f.cross(u).normalized()
    u = r.cross(f)
    return Matrix((r, u, -f)).transposed().to_euler()


# file name -> (forward, up) in Blender axes. Each face is the natural view in that direction; three.js flips X when it
# samples a cube background, so the file called px is the view toward game -X.
FACES = {
    'px': ((-1, 0, 0), (0, 0, 1)), 'nx': ((1, 0, 0), (0, 0, 1)),
    'py': ((0, 0, 1), (0, 1, 0)), 'ny': ((0, 0, -1), (0, -1, 0)),
    'pz': ((0, -1, 0), (0, 0, 1)), 'nz': ((0, 1, 0), (0, 0, 1)),
}


def render(venue, draft, only=None):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:  # no GPU: the CPU still gets there
        print('GPU unavailable:', e)
    sc.cycles.samples = 24 if draft else 64
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.cycles.sample_clamp_indirect = 8
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'Medium High Contrast'
    sc.view_settings.exposure = float(sc.get('exposure', 0.3))
    if sc.world is None:  # indoors: nothing outside the walls
        sc.world = bpy.data.worlds.new('dark'); sc.world.use_nodes = True
        sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.004, 0.003, 0.006, 1)
    out = os.path.abspath(os.path.join(WEB, 'rooms', venue))
    os.makedirs(out, exist_ok=True)

    cam_data = bpy.data.cameras.new('eye')
    cam = bpy.data.objects.new('eye', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = EYE
    cam_data.clip_start = 0.05

    size = 384 if draft else 1536
    cam_data.type = 'PERSP'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.angle = math.pi / 2
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 86
    for name, (f, u) in FACES.items():
        if only and name not in only:
            continue
        # straight up and straight behind are hardly ever on screen: a quarter of the pixels is plenty
        sc.render.resolution_x = sc.render.resolution_y = size // 2 if name in ('py', 'pz') and not draft else size
        cam.rotation_euler = look(f, u)
        sc.render.filepath = os.path.join(out, f'{name}.jpg')
        bpy.ops.render.render(write_still=True)

    if only:
        print('RENDERED', out)
        return
    # lighting panorama: centre of the image is game +X, as three's equirect lookup expects
    cam_data.type = 'PANO'
    cam_data.panorama_type = 'EQUIRECTANGULAR'
    cam.location = (0, 0, 0.6)  # the table top, which is what this light falls on
    cam.rotation_euler = look((1, 0, 0), (0, 0, 1))
    sc.render.resolution_x, sc.render.resolution_y = 512, 256
    sc.cycles.samples = 24 if draft else 96
    sc.render.image_settings.file_format = 'HDR'
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.render.filepath = os.path.join(out, 'env.hdr')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', out)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    draft = '--draft' in args
    only = next((a.split('=')[1].split(',') for a in args if a.startswith('--faces=')), None)
    for venue in [a for a in args if not a.startswith('--')] or list(ROOMS):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        ROOMS[venue]()
        table_standin(venue)
        render(venue, draft, only)
