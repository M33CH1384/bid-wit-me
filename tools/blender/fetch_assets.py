"""
Downloads CC0 source assets from Poly Haven (https://polyhaven.com, licence CC0 1.0) into tools/blender/cache/.
The cache is not committed: the rooms rendered from it are. Run with the system Python, before build_room.py.

  python3 tools/blender/fetch_assets.py classic
"""
import json, os, subprocess, sys

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
UA = 'asset-fetch-script/1.0'

# what each room is built from
ROOMS = {
    'classic': dict(
        textures=['herringbone_parquet', 'painted_plaster_wall', 'dark_paneled_wood', 'brick_wall_001', 'velour_velvet', 'ceiling_interior'],
        models=['Sofa_01', 'ArmChair_01', 'mid_century_lounge_chair', 'modern_coffee_table_01', 'side_table_01', 'potted_plant_01', 'potted_plant_02',
                'wooden_display_shelves_01', 'wine_bottles_01', 'hanging_picture_frame_01', 'hanging_picture_frame_02',
                'fancy_picture_frame_01', 'modern_ceiling_lamp_01', 'industrial_wall_lamp', 'bar_chair_round_01', 'modern_wooden_cabinet', 'boombox'],
    ),
    'backyard': dict(
        hdris=['qwantani_dusk_2'], textures=['leafy_grass', 'brown_planks_03', 'brick_wall_003'],
        models=['wooden_picnic_table', 'plastic_monobloc_chair_01', 'barrel_stove', 'propane_tank', 'stone_fire_pit', 'planter_box_01', 'garden_gnome',
                'boombox', 'football', 'plastic_crate_01', 'potted_plant_01', 'wooden_stool_01', 'metal_trash_can'],
    ),
    'mansion': dict(
        textures=['marble_01', 'plastered_wall_04', 'dark_paneled_wood', 'velour_velvet'],
        models=['Chandelier_01', 'Chandelier_03', 'marble_bust_01', 'ornate_mirror_01', 'ClassicConsole_01', 'fancy_picture_frame_01', 'fancy_picture_frame_02',
                'vintage_grandfather_clock_01', 'horse_statue_01', 'brass_vase_01', 'antique_ceramic_vase_01', 'sofa_02', 'GreenChair_01',
                'brass_candleholders', 'potted_plant_02', 'gothic_coffee_table'],
    ),
    'barbershop': dict(
        textures=['checkered_pavement_tiles', 'beige_wall_001', 'brick_wall_003', 'blue_floor_tiles_01'],
        models=['BarberShopChair_01', 'ornate_mirror_01', 'ClassicConsole_01', 'CashRegister_01', 'wall_clock', 'WetFloorSign_01', 'Television_01',
                'mounted_fluorescent_lights', 'metal_stool_01', 'steel_frame_shelves_03', 'boombox', 'painted_wooden_bench', 'potted_plant_04',
                'hanging_picture_frame_03', 'american_football'],
    ),
    'church': dict(
        textures=['old_linoleum_flooring_01', 'concrete_block_wall', 'ceiling_interior'],
        models=['SchoolChair_01', 'plastic_monobloc_chair_01', 'WoodenTable_01', 'pot_enamel_01', 'carrot_cake', 'strawberry_chocolate_cake', 'plastic_thermos',
                'standing_chalkboard_01', 'projector_screen', 'fire_alarm', 'korean_fire_extinguisher_01', 'wall_clock', 'mounted_fluorescent_lights',
                'ceiling_fan', 'cardboard_box_01', 'metal_trash_can', 'hanging_picture_frame_01'],
    ),
    'rooftop': dict(
        hdris=['rooftop_night'], textures=['concrete_floor_02', 'brick_wall_003', 'concrete_wall_006'],
        models=['exterior_aircon_unit', 'outdoor_table_chair_set_01', 'planter_box_02', 'planter_box_03', 'security_light', 'caged_hanging_light',
                'metal_stool_02', 'plastic_crate_01', 'rollershutter_door', 'modular_street_seating', 'potted_plant_01', 'boombox'],
    ),
    'speakeasy': dict(
        textures=['herringbone_parquet', 'dark_paneled_wood', 'brick_wall_001', 'velour_velvet', 'wood_table_001'],
        models=['Chandelier_02', 'wine_barrel_01', 'wooden_barrels_01', 'wine_bottles_01', 'brass_goblets', 'bar_chair_round_01', 'sofa_03', 'vintage_oil_lamp',
                'brass_candleholders', 'mantel_clock_01', 'vintage_radio_transceiver', 'fancy_picture_frame_01', 'fancy_picture_frame_02',
                'wooden_display_shelves_01', 'gothic_coffee_table', 'GreenChair_01', 'industrial_wall_sconce'],
    ),
    'vegas': dict(
        textures=['quatrefoil_jacquard_fabric', 'dark_paneled_wood', 'marble_01', 'velour_velvet'],
        models=['Chandelier_01', 'CashRegister_01', 'bar_chair_round_01', 'brass_vase_02', 'sofa_02', 'wine_bottles_01', 'brass_goblets', 'potted_plant_02',
                'fancy_picture_frame_02', 'modern_arm_chair_01'],
    ),
    'beach': dict(
        hdris=['umhlanga_sunrise'], textures=['coast_sand_01', 'bamboo_veneer', 'thatch_roof_angled', 'brown_planks_03'],
        models=['island_tree_01', 'island_tree_02', 'wooden_barrels_01', 'Ukulele_01', 'lifebuoy', 'wicker_basket_01', 'wooden_lantern_01', 'painted_wooden_bench',
                'folding_wooden_stool', 'life_jacket', 'wooden_crate_01', 'treasure_chest', 'wooden_bucket_01'],
    ),
    'grandma': dict(
        textures=['linoleum_brown', 'beige_wall_002', 'distressed_painted_planks', 'ceiling_interior'],
        models=['electric_stove', 'vintage_microwave', 'vintage_electric_kettle', 'painted_wooden_cabinet', 'painted_wooden_cabinet_02', 'painted_wooden_shelves',
                'WoodenChair_01', 'Rockingchair_01', 'painted_wooden_sofa', 'throw_pillows_01', 'wall_clock', 'mantel_clock_01', 'Television_01', 'carrot_cake',
                'tea_set_01', 'WoodenTable_02', 'pot_enamel_01', 'brass_pan_01', 'wooden_bowl_01', 'hanging_picture_frame_01', 'hanging_picture_frame_02',
                'hanging_picture_frame_03', 'ceiling_fan', 'potted_plant_04', 'jug_01', 'painted_wooden_nightstand'],
    ),
    'yacht': dict(
        hdris=['venice_sunset'], textures=['wood_floor_deck', 'teak_veneer'],
        models=['lifebuoy', 'life_jacket', 'mid_century_lounge_chair', 'side_table_01', 'brass_goblets', 'wine_bottles_01', 'wooden_bucket_01', 'vintage_binocular',
                'potted_plant_04', 'wicker_basket_02'],
    ),
}


def get(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # curl uses the system certificate store (python.org builds of Python ship without one)
    subprocess.run(['curl', '-sS', '--fail', '-L', '-m', '300', '-A', UA, '-o', dest + '.part', url], check=True)
    os.replace(dest + '.part', dest)


def files(asset):
    out = subprocess.run(['curl', '-sS', '--fail', '-m', '60', '-A', UA, f'https://api.polyhaven.com/files/{asset}'], check=True, capture_output=True)
    return json.loads(out.stdout)


def texture(asset, res='2k'):
    if os.path.exists(os.path.join(CACHE, 'textures', asset, 'diff.jpg')):
        return
    f = files(asset)
    for key, short in (('Diffuse', 'diff'), ('Rough', 'rough'), ('nor_gl', 'nor')):
        if key in f:
            get(f[key][res]['jpg']['url'], os.path.join(CACHE, 'textures', asset, f'{short}.jpg'))


def hdri(asset, res='2k'):
    f = files(asset)
    get(f['hdri'][res]['hdr']['url'], os.path.join(CACHE, 'hdris', f'{asset}.hdr'))


def model(asset, res='1k'):
    if os.path.exists(os.path.join(CACHE, 'models', asset, f'{asset}.gltf')):
        return
    f = files(asset)
    if 'gltf' not in f:
        print('skip (no gltf):', asset, list(f)[:6], flush=True)
        return
    entry = f['gltf'][res]['gltf']
    root = os.path.join(CACHE, 'models', asset)
    get(entry['url'], os.path.join(root, f'{asset}.gltf'))
    for rel, inc in entry.get('include', {}).items():
        get(inc['url'], os.path.join(root, rel))


if __name__ == '__main__':
    for room in sys.argv[1:] or list(ROOMS):
        spec = ROOMS[room]
        for h in spec.get('hdris', []):
            hdri(h); print('hdri', h, flush=True)
        for t in spec['textures']:
            texture(t); print('texture', t, flush=True)
        for m in spec['models']:
            model(m); print('model', m, flush=True)
