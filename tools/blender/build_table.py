"""
Builds a venue's card table in Blender and exports it as a geometry-only GLB for the web game.

  ~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/build_table.py -- classic

The game owns the materials (so its shader warm-up stays in charge); this file owns the shapes. Every part is
lofted around the same rounded rectangle the game deals cards on (FELT in apps/web/src/three/layout.ts), so the
playing surface never moves: only what surrounds it changes per venue. Ambient occlusion is baked in Cycles into
vertex colours, which the game multiplies into each material.

Mesh names are the contract with the loader: cushion, rail, apron, inlay, base.
With no venue named, every table is rebuilt.
Units are game units, Blender Z up (the glTF exporter turns that into the game's Y up).
"""
import bpy, bmesh, math, sys, os

FELT = dict(hx=1.5, hz=1.78, r=0.95)
FLOOR = -0.9
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'web', 'public', 'assets', 'models')


def half_round(d0, d1, h0, top, n=14, tuck=0.0, power=0.75):
    """Padded roll: a squashed half ellipse from d0 to d1, rising to `top`. A lower `power` flattens the crown."""
    c, rx = (d0 + d1) / 2, (d1 - d0) / 2
    pts = []
    for i in range(n + 1):
        a = math.pi - math.pi * i / n
        pts.append((c + rx * math.cos(a), h0 + (top - h0) * (max(0.0, math.sin(a)) ** power)))
    if tuck:
        pts.append((d1, h0 - tuck))
    return pts


def fillet(points, radius=0.012, steps=4):
    """Round every interior corner of a polyline, the way a router bit eases an edge."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        p0, p1, p2 = points[i - 1], points[i], points[i + 1]
        def toward(a, b, dist):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1
            k = min(dist, L * 0.45) / L
            return (a[0] + dx * k, a[1] + dy * k)
        a, b = toward(p1, p0, radius), toward(p1, p2, radius)
        for s in range(steps + 1):
            t = s / steps
            out.append(((1 - t) ** 2 * a[0] + 2 * t * (1 - t) * p1[0] + t * t * b[0],
                        (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * p1[1] + t * t * b[1]))
    out.append(points[-1])
    return out


def circle(cd, ch, r, n=18):
    """A pole seen end on: bamboo and tube rails."""
    return [(cd + r * math.cos(math.pi - 2 * math.pi * i / n), ch + r * math.sin(math.pi - 2 * math.pi * i / n)) for i in range(n + 1)]


def corners(x, y, top, foot_x, foot_y, r):
    """Four legs, one per corner, from under the top out to the floor."""
    return [((sx * x, sy * y, top), (sx * foot_x, sy * foot_y, FLOOR), r) for sx in (-1, 1) for sy in (-1, 1)]


PEDESTAL = [(0, -0.35), (0.34, -0.35), (0.3, -0.4), (0.16, -0.44), (0.12, -0.52), (0.2, -0.6), (0.2, -0.64), (0.11, -0.7), (0.14, -0.78), (0.4, -0.86), (0.42, -0.9), (0, -0.9)]

# ---------------------------------------------------------------- the card contract
# The game's card layout (apps/web/src/three/layout.ts, tableTopY / RAIL_TOP_Y) knows ONE table surface: felt at 0,
# an inner bevel from 0.05 inside the felt outline, a cap at CAP across the 0.2 rail band, an outer bevel, and nothing
# past 0.24. Won books rest on that cap, opponents' fans settle onto it, and the figures' hands follow the fans. So
# every table here must sit inside that envelope and present a top at (about) CAP across the band, or books float
# and cards cut through the rail. check_envelope() fails the build on any profile that breaks it.
CAP = 0.098        # a hair under the game's 0.10 so resting cards never z-fight the rail
EDGE = 0.24        # no table material past this distance from the felt outline
_IN = [(-0.05, 0.0), (-0.04, 0.08), (-0.03, 0.09), (-0.02, 0.095), (-0.01, 0.098), (0.0, 0.1)]
_OUT = [(0.2, 0.1), (0.21, 0.098), (0.22, 0.095), (0.23, 0.09), (0.24, 0.08)]


def envelope(d):
    """Highest the table may stand at outward distance d from the felt outline (None = no table allowed)."""
    if d <= -0.05:
        return 0.0
    for prof in (_IN, _OUT):
        for (d0, h0), (d1, h1) in zip(prof, prof[1:]):
            if d0 <= d <= d1:
                return h0 + (h1 - h0) * (d - d0) / (d1 - d0)
    if 0.0 <= d <= 0.2:
        return 0.1
    return None if d > EDGE else 0.08


def check_envelope(style_id, st):
    for part in ('cushion', 'rail', 'inlay', 'apron'):
        pts = st.get(part) or []
        # sample along each segment, not just the listed points
        for (d0, h0), (d1, h1) in zip(pts, pts[1:]):
            for k in range(9):
                d, h = d0 + (d1 - d0) * k / 8, h0 + (h1 - h0) * k / 8
                top = envelope(d)
                if d > EDGE + 1e-6:
                    raise SystemExit(f'{style_id}.{part}: material at d={d:.3f}, past the table edge {EDGE}')
                if top is not None and h > top + 0.0015:
                    raise SystemExit(f'{style_id}.{part}: height {h:.3f} at d={d:.3f} is above the card surface {top:.3f}')


def ribbed(d0, d1, hi, lo, pitch=0.02):
    """A slatted or reeded top: alternating crests and shallow grooves across the band."""
    pts, d, up = [], d0, True
    while d < d1 - 1e-6:
        pts.append((round(d, 4), hi if up else lo))
        d += pitch / 2
        up = not up
    pts.append((d1, hi))
    return pts


STYLES = {
    # Studio poker table: padded leather roll, a lacquered racetrack with a brass inlay, deep apron, drum base.
    'classic': dict(
        cushion=half_round(-0.045, 0.10, 0.004, CAP, tuck=0.03),
        rail=fillet([(0.09, 0.03), (0.098, CAP), (0.204, CAP), (0.226, 0.088), (0.24, 0.066), (0.24, -0.045)], 0.008),
        inlay=[(0.152, CAP + 0.0004), (0.154, CAP + 0.0016), (0.166, CAP + 0.0016), (0.168, CAP + 0.0004)],
        apron=fillet([(0.232, -0.035), (0.232, -0.30), (0.205, -0.335), (0.0, -0.335)], 0.02),
        base=dict(kind='drum', profile=[(0.0, -0.33), (0.62, -0.33), (0.62, -0.37), (0.5, -0.4), (0.44, -0.62), (0.47, -0.74), (0.74, -0.83), (0.78, -0.9), (0.0, -0.9)]),
    ),
    # Banquet folding table: a wide brushed-aluminium frame round the picnic cloth, tube leg frames with braces.
    'backyard': dict(
        rail=fillet([(-0.045, 0.0), (-0.039, 0.068), (-0.024, 0.088), (-0.006, CAP), (0.204, CAP), (0.226, 0.088), (0.24, 0.07), (0.24, 0.0), (0.24, -0.04)], 0.005),
        apron=fillet([(0.236, -0.03), (0.236, -0.055), (0.21, -0.066), (0.0, -0.066)], 0.006),
        base=dict(kind='tubes', tubes=[seg for y in (-1.2, 1.2) for seg in (
            ((-1.0, y, -0.06), (-1.08, y, FLOOR), 0.03), ((1.0, y, -0.06), (1.08, y, FLOOR), 0.03),
            ((-1.07, y, -0.74), (1.07, y, -0.74), 0.024), ((0.0, y, -0.74), (0.0, y * 0.45, -0.07), 0.018))]),
    ),
    # Cut crystal: a thick faceted glass rail and apron on a faceted pedestal. Flat shaded so every facet catches light.
    'mansion': dict(
        flat=True,
        rail=[(-0.045, 0.0), (-0.036, 0.07), (-0.004, CAP), (0.2, CAP), (0.24, 0.06), (0.24, -0.02), (0.21, -0.06)],
        apron=[(0.21, -0.06), (0.15, -0.2), (0.0, -0.2)],
        base=dict(kind='drum', segs=12, profile=[(0, -0.2), (0.5, -0.2), (0.3, -0.3), (0.22, -0.6), (0.3, -0.75), (0.6, -0.85), (0.62, -0.9), (0, -0.9)]),
    ),
    # Back-room card table: one broad leather roll, a chrome band on the apron, barber-chair pedestal.
    'barbershop': dict(
        rail=half_round(-0.045, 0.24, 0.004, CAP, n=22, tuck=0.06, power=0.36),
        inlay=[(0.2325, -0.1), (0.2365, -0.105), (0.2365, -0.135), (0.2325, -0.14)],
        apron=fillet([(0.231, -0.05), (0.231, -0.22), (0.2, -0.25), (0.0, -0.25)], 0.02),
        base=dict(kind='drum', squash=1.0, profile=[(0, -0.25), (0.3, -0.25), (0.16, -0.3), (0.14, -0.7), (0.2, -0.76), (0.7, -0.86), (0.72, -0.9), (0, -0.9)]),
    ),
    # Fellowship-hall table: laminate top with a rounded T-moulding edge, steel skirt, four straight legs with braces.
    'church': dict(
        rail=fillet([(-0.045, 0.0), (-0.039, 0.068), (-0.024, 0.088), (-0.006, CAP), (0.204, CAP), (0.226, 0.088), (0.24, 0.066), (0.24, -0.07)], 0.005),
        apron=fillet([(0.236, -0.065), (0.236, -0.088), (0.06, -0.088), (0.06, -0.15), (0.04, -0.15), (0.04, -0.088), (-0.2, -0.088)], 0.004),
        base=dict(kind='tubes', tubes=corners(1.05, 1.3, -0.09, 1.05, 1.3, 0.034) + [((-1.05, y, -0.6), (1.05, y, -0.6), 0.02) for y in (-1.3, 1.3)]),
    ),
    # Modern terrace table: a slim cushion, a wide flat hardwood deck, two slab legs.
    'rooftop': dict(
        cushion=half_round(-0.045, 0.05, 0.004, CAP, n=10, tuck=0.02),
        rail=fillet([(0.043, 0.03), (0.049, CAP), (0.204, CAP), (0.226, 0.088), (0.24, 0.07), (0.24, -0.06)], 0.005),
        apron=fillet([(0.236, -0.05), (0.236, -0.12), (0.18, -0.14), (0.0, -0.14)], 0.01),
        base=dict(kind='slabs', slabs=[((0.0, y), (1.7, 0.16), -0.14) for y in (-1.15, 1.15)]),
    ),
    # Prohibition-era table: padded roll, a beaded rail with a brass line in the groove, moulded apron, twin turned pedestals.
    'speakeasy': dict(
        cushion=half_round(-0.045, 0.09, 0.004, CAP, tuck=0.03),
        rail=fillet([(0.08, 0.03), (0.088, CAP), (0.13, CAP), (0.137, 0.086), (0.152, 0.086), (0.159, CAP), (0.204, CAP), (0.226, 0.088), (0.24, 0.066), (0.24, 0.03), (0.232, -0.01), (0.232, -0.05)], 0.005),
        inlay=[(0.139, 0.0864), (0.141, 0.0884), (0.148, 0.0884), (0.15, 0.0864)],
        apron=fillet([(0.23, -0.04), (0.23, -0.2), (0.24, -0.215), (0.24, -0.245), (0.226, -0.26), (0.226, -0.33), (0.2, -0.36), (0.0, -0.36)], 0.008),
        base=dict(kind='lathes', at=[(0.0, -0.85), (0.0, 0.85)], profile=PEDESTAL),
    ),
    # Casino table: a wide padded armrest, a slim leather ledge, a gold band, deep apron, twin drums.
    'vegas': dict(
        cushion=half_round(-0.045, 0.165, 0.004, CAP, n=20, tuck=0.02, power=0.45),
        rail=fillet([(0.155, 0.03), (0.162, 0.094), (0.226, 0.094), (0.24, 0.07), (0.24, -0.05)], 0.008),
        inlay=[(0.2325, -0.07), (0.2365, -0.075), (0.2365, -0.11), (0.2325, -0.115)],
        apron=fillet([(0.231, -0.04), (0.231, -0.36), (0.2, -0.39), (0.0, -0.39)], 0.02),
        base=dict(kind='lathes', at=[(0.0, -0.8), (0.0, 0.8)], profile=[(0, -0.38), (0.5, -0.38), (0.46, -0.44), (0.4, -0.8), (0.5, -0.86), (0.52, -0.9), (0, -0.9)]),
    ),
    # Tiki table: a deck of split-bamboo slats round the felt over a bamboo pole frame, splayed bamboo legs.
    'beach': dict(
        rail=[(-0.045, 0.0), (-0.039, 0.066), (-0.024, 0.086)] + ribbed(-0.006, 0.2, CAP, 0.089, 0.0294) + [(0.226, 0.086), (0.24, 0.068), (0.24, -0.02)],
        apron=circle(0.176, -0.075, 0.062) + [(0.0, -0.075)],
        base=dict(kind='tubes', tubes=corners(0.9, 1.1, -0.1, 1.2, 1.5, 0.06) + [((-1.05, y, -0.5), (1.05, y, -0.5), 0.04) for y in (-1.3, 1.3)]),
    ),
    # 1950s dinette: a broad chrome band round the cloth with a reeded edge, four splayed chrome legs.
    'grandma': dict(
        rail=fillet([(-0.045, 0.0), (-0.039, 0.068), (-0.024, 0.088), (-0.006, CAP), (0.2, CAP), (0.226, 0.088), (0.24, 0.07)], 0.004)
             + [(0.234, 0.058), (0.24, 0.046), (0.234, 0.034), (0.24, 0.022), (0.234, 0.01), (0.24, -0.002), (0.234, -0.014), (0.24, -0.026), (0.24, -0.07)],
        apron=[(0.232, -0.07), (0.232, -0.09), (0.0, -0.09)],
        base=dict(kind='tubes', tubes=corners(0.85, 1.05, -0.09, 1.15, 1.4, 0.04)),
    ),
    # Deck table: a broad teak cap rail with a steel stripe, single pedestal.
    'yacht': dict(
        rail=fillet([(-0.045, 0.0), (-0.039, 0.068), (-0.024, 0.088), (-0.006, CAP), (0.204, CAP), (0.226, 0.088), (0.24, 0.07), (0.24, -0.05)], 0.005),
        inlay=[(0.1, CAP + 0.0004), (0.101, CAP + 0.0016), (0.113, CAP + 0.0016), (0.114, CAP + 0.0004)],
        apron=fillet([(0.236, -0.04), (0.236, -0.13), (0.21, -0.15), (0.0, -0.15)], 0.012),
        base=dict(kind='drum', squash=1.0, profile=[(0, -0.15), (0.35, -0.15), (0.33, -0.19), (0.13, -0.22), (0.12, -0.8), (0.5, -0.86), (0.52, -0.9), (0, -0.9)]),
    ),
}


def outline(n_corner=28, n_side=10):
    """The felt's rounded rectangle as (point, outward normal, arclength), counter-clockwise seen from above."""
    hx, hz, r = FELT['hx'], FELT['hz'], FELT['r']
    pts = []
    corners = [(hx - r, hz - r, 0), (-(hx - r), hz - r, 90), (-(hx - r), -(hz - r), 180), (hx - r, -(hz - r), 270)]
    for k, (cx, cy, a0) in enumerate(corners):
        for i in range(n_corner + 1):
            a = math.radians(a0 + 90 * i / n_corner)
            pts.append(((cx + r * math.cos(a), cy + r * math.sin(a)), (math.cos(a), math.sin(a))))
        nx, ny, _ = corners[(k + 1) % 4]
        a1 = math.radians(a0 + 90)
        sx, sy = cx + r * math.cos(a1), cy + r * math.sin(a1)
        ex, ey = nx + r * math.cos(a1), ny + r * math.sin(a1)
        for i in range(1, n_side):
            t = i / n_side
            pts.append(((sx + (ex - sx) * t, sy + (ey - sy) * t), (math.cos(a1), math.sin(a1))))
    out, s = [], 0.0
    for i, (p, n) in enumerate(pts):
        if i:
            q = pts[i - 1][0]
            s += math.hypot(p[0] - q[0], p[1] - q[1])
        out.append((p, n, s))
    return out


def loft(name, profile, uv_scale=1.0, flat=False):
    """Sweep a (outward distance, height) profile around the felt outline. UVs: u along the table, v across."""
    path = outline()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    vlen = [0.0]
    for j in range(1, len(profile)):
        vlen.append(vlen[-1] + math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]))
    rings = [[bm.verts.new((p[0] + n[0] * d, p[1] + n[1] * d, h)) for (d, h) in profile] for (p, n, _s) in path]
    total = path[-1][2] + math.hypot(path[0][0][0] - path[-1][0][0], path[0][0][1] - path[-1][0][1])
    for i in range(len(path)):
        a, b = rings[i], rings[(i + 1) % len(path)]
        u0, u1 = path[i][2], (path[i + 1][2] if i + 1 < len(path) else total)
        for j in range(len(profile) - 1):
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            f.smooth = not flat
            for loop, (u, v) in zip(f.loops, ((u0, vlen[j]), (u1, vlen[j]), (u1, vlen[j + 1]), (u0, vlen[j + 1]))):
                loop[uv].uv = (u * uv_scale, v * uv_scale)
    return finish(name, bm)


def lathe(name, profile, at=(0.0, 0.0), segs=64, squash=1.0, flat=False):
    """Spin a (radius, height) profile around the vertical axis: turned legs and drum bases."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    vlen = [0.0]
    for j in range(1, len(profile)):
        vlen.append(vlen[-1] + math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]))
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        rings.append([bm.verts.new((at[0] + r * math.cos(a), at[1] + r * math.sin(a) * squash, h)) for (r, h) in profile])
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        for j in range(len(profile) - 1):
            if profile[j][0] == 0 and profile[j + 1][0] == 0:
                continue
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            f.smooth = not flat
            r = max(profile[j][0], profile[j + 1][0])
            for loop, (u, v) in zip(f.loops, ((i, vlen[j]), (i + 1, vlen[j]), (i + 1, vlen[j + 1]), (i, vlen[j + 1]))):
                loop[uv].uv = (u / segs * 2 * math.pi * r, v)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return finish(name, bm)


def tube(name, a, b, radius, segs=20):
    """A round leg or brace between two points, capped at both ends."""
    from mathutils import Vector
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up = axis.cross(side)
    L = (b - a).length
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    ra = [bm.verts.new(a + (side * math.cos(2 * math.pi * i / segs) + up * math.sin(2 * math.pi * i / segs)) * radius) for i in range(segs)]
    rb = [bm.verts.new(b + (side * math.cos(2 * math.pi * i / segs) + up * math.sin(2 * math.pi * i / segs)) * radius) for i in range(segs)]
    for i in range(segs):
        k = (i + 1) % segs
        f = bm.faces.new((ra[i], ra[k], rb[k], rb[i]))
        f.smooth = True
        c = 2 * math.pi * radius
        for loop, (u, v) in zip(f.loops, ((i / segs * c, 0), ((i + 1) / segs * c, 0), ((i + 1) / segs * c, L), (i / segs * c, L))):
            loop[uv].uv = (u, v)
    bm.faces.new(ra)
    bm.faces.new(rb)
    return finish(name, bm)


def slab(name, centre, size, top):
    """An upright panel leg from under the top to the floor, with eased edges."""
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    h = top - FLOOR
    for v in bm.verts:
        v.co.x = centre[0] + v.co.x * size[0]
        v.co.y = centre[1] + v.co.y * size[1]
        v.co.z = FLOOR + (v.co.z + 0.5) * h
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.015, segments=3, affect='EDGES')
    uv = bm.loops.layers.uv.active
    for f in bm.faces:
        f.smooth = True
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co.x + co.y, co.z)
    return finish(name, bm)


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def build_base(base, flat):
    kind = base['kind']
    if kind == 'drum':
        return lathe('base', base['profile'], segs=base.get('segs', 64), squash=base.get('squash', FELT['hz'] / FELT['hx']), flat=flat)
    if kind == 'lathes':
        return join('base', [lathe(f'base{i}', base['profile'], at=at, flat=flat) for i, at in enumerate(base['at'])])
    if kind == 'tubes':
        return join('base', [tube(f'base{i}', a, b, r) for i, (a, b, r) in enumerate(base['tubes'])])
    if kind == 'slabs':
        return join('base', [slab(f'base{i}', c, size, top) for i, (c, size, top) in enumerate(base['slabs'])])
    raise ValueError(kind)


def finish(name, bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    me.materials.append(mat)
    return ob


def occluder(name, verts):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [tuple(range(len(verts)))])
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def bake_ao(objects, samples=96):
    """Cycles AO into a vertex colour layer. The felt and the floor are in the scene so they darken what they touch."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.6
    for ob in objects:
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        attr = ob.data.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        ob.data.color_attributes.active_color = attr
        ob.data.color_attributes.render_color_index = 0
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        # Lift the floor of the bake: the game's own lights and shadow map add the hard contact shadows.
        for c in attr.data:
            v = 0.3 + 0.7 * (c.color[0] ** 0.8)
            c.color = (v, v, v, 1.0)


def main(style_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    st = STYLES[style_id]
    check_envelope(style_id, st)
    flat = bool(st.get('flat'))
    parts = [loft(name, st[name], flat=flat) for name in ('cushion', 'rail', 'apron', 'inlay') if st.get(name)]
    if st.get('base'):
        parts.append(build_base(st['base'], flat))
    hx, hz = FELT['hx'] + 0.02, FELT['hz'] + 0.02
    helpers = [occluder('felt', [(-hx, -hz, 0), (hx, -hz, 0), (hx, hz, 0), (-hx, hz, 0)]),
               occluder('floor', [(-8, -8, FLOOR), (8, -8, FLOOR), (8, 8, FLOOR), (-8, 8, FLOOR)])]
    bake_ao(parts)
    for h in helpers:
        bpy.data.objects.remove(h)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT, f'table_{style_id}.glb'))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_normals=True, export_texcoords=True, export_draco_mesh_compression_enable=False)
    tris = sum(len(o.data.polygons) * 2 for o in parts)
    print(f'BUILT {path} {os.path.getsize(path) / 1024:.0f} KB, {tris} triangles')


if __name__ == '__main__':
    args = (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) or list(STYLES)
    for a in args:
        main(a)
