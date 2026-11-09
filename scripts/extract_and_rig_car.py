"""
Blender Python (bpy) Script: Isolate, Rig, Normalize, and Export Playable Cars
==============================================================================
Target Asset Pack: 190-low-poly-cars-mega-pack/190-low-poly-cars-mega-pack.blend

Exports 5 rigged, game-ready vehicles into `public/assets/`:
  1. `player_car.glb`  — JDM Widebody Supra GT Tuner (White w/ Red Stripe)
  2. `car_veneno.glb`  — Lamborghini Veneno Hypercar (Yellow & Black w/ Red-Lip Rims)
  3. `car_mustang.glb` — Classic Shelby Mustang Fastback (White w/ Blue Stripes)
  4. `car_fordgt.glb`  — Ford GT Supercar (Gunmetal Grey w/ White Stripes)
  5. `car_amg.glb`     — Mercedes-AMG GT Coupe (Solarbeam Orange)

Each `.glb` contains 5 distinct root objects:
  - Chassis_Body (origin at wheelbase center, Z=0.36m near Center of Mass)
  - Wheel_FL     (origin at exact geometric bounds center)
  - Wheel_FR     (origin at exact geometric bounds center)
  - Wheel_RL     (origin at exact geometric bounds center)
  - Wheel_RR     (origin at exact geometric bounds center)
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix


VEHICLE_CONFIGS = [
    {
        "filename": "player_car.glb",
        "label": "JDM Widebody Supra GT Tuner",
        "center": Vector((10.00, -31.04, 0.61)),
        "half_extents": Vector((1.50, 2.50, 1.00)),
        "source_meshes": [
            "0_Sketchfab_CARS_Color_1_Material_0.006",
            "0_Sketchfab_CARS_Lights_Material_0",
        ],
        "align_yaw_deg": 180.0 - 4.3568,
        "target_length": 4.42,
        "target_width": 1.94,
        "wheels": {
            "Wheel_FL": {"center": Vector((9.1336, -29.8816, 0.3590)), "unsteer_deg": 25.0},
            "Wheel_FR": {"center": Vector((10.6855, -29.7504, 0.3590)), "unsteer_deg": 25.0},
            "Wheel_RL": {"center": Vector((9.2917, -32.3406, 0.3590)), "unsteer_deg": 0.0},
            "Wheel_RR": {"center": Vector((10.9033, -32.2201, 0.3590)), "unsteer_deg": 0.0},
        },
    },
    {
        "filename": "car_veneno.glb",
        "label": "Lamborghini Veneno Hypercar",
        "center": Vector((40.99, -1.98, 0.53)),
        "half_extents": Vector((2.60, 1.40, 1.00)),
        "source_meshes": [
            "0_Sketchfab_CARS_Color_1_Material_0.006",
            "0_Sketchfab_CARS_Lights_Material_0",
        ],
        "align_yaw_deg": 90.0 + 1.2308,
        "target_length": 4.52,
        "target_width": 1.98,
        "wheels": {
            "Wheel_FL": {"center": Vector((39.8932, -2.7516, 0.3210)), "unsteer_deg": 25.0},
            "Wheel_FR": {"center": Vector((39.9132, -1.2012, 0.3210)), "unsteer_deg": 25.0},
            "Wheel_RL": {"center": Vector((42.2343, -2.8183, 0.3395)), "unsteer_deg": 0.0},
            "Wheel_RR": {"center": Vector((42.2676, -1.2354, 0.3395)), "unsteer_deg": 0.0},
        },
    },
    {
        "filename": "car_mustang.glb",
        "label": "Classic Shelby Mustang Fastback",
        "center": Vector((-28.02, -3.00, 0.61)),
        "half_extents": Vector((2.60, 1.40, 1.00)),
        "source_meshes": [
            "0_Sketchfab_CARS_Color_1_Material_0",
            "0_Sketchfab_CARS_Lights_Material_0",
        ],
        "align_yaw_deg": -90.0,
        "target_length": 4.50,
        "target_width": 1.90,
        "wheels": {
            "Wheel_FL": {"center": Vector((-26.7406, -2.3046, 0.3043)), "unsteer_deg": 25.0},
            "Wheel_FR": {"center": Vector((-26.7284, -3.6953, 0.3043)), "unsteer_deg": 25.0},
            "Wheel_RL": {"center": Vector((-29.2977, -2.2723, 0.3146)), "unsteer_deg": 0.0},
            "Wheel_RR": {"center": Vector((-29.2977, -3.7276, 0.3146)), "unsteer_deg": 0.0},
        },
    },
    {
        "filename": "car_fordgt.glb",
        "label": "Ford GT Supercar",
        "center": Vector((11.00, -23.04, 0.52)),
        "half_extents": Vector((1.50, 2.50, 1.00)),
        "source_meshes": [
            "0_Sketchfab_CARS_Color_1_Material_0.007",
            "0_Sketchfab_CARS_Lights_Material_0",
        ],
        "align_yaw_deg": 180.0 - 6.1099,
        "target_length": 4.46,
        "target_width": 1.96,
        "wheels": {
            "Wheel_FL": {"center": Vector((10.1236, -21.9513, 0.3221)), "unsteer_deg": 25.0},
            "Wheel_FR": {"center": Vector((11.6331, -21.7787, 0.3221)), "unsteer_deg": 25.0},
            "Wheel_RL": {"center": Vector((10.3692, -24.4601, 0.3221)), "unsteer_deg": 0.0},
            "Wheel_RR": {"center": Vector((11.9257, -24.2967, 0.3221)), "unsteer_deg": 0.0},
        },
    },
    {
        "filename": "car_amg.glb",
        "label": "Mercedes-AMG GT Coupe",
        "center": Vector((4.00, 12.02, 0.61)),
        "half_extents": Vector((1.50, 2.50, 1.00)),
        "source_meshes": [
            "0_Sketchfab_CARS_Color_1_Material_0",
            "0_Sketchfab_CARS_Lights_Material_0",
        ],
        "align_yaw_deg": 0.0,
        "target_length": 4.40,
        "target_width": 1.92,
        "wheels": {
            "Wheel_FL": {"center": Vector((4.7872, 10.7392, 0.3343)), "unsteer_deg": 25.0},
            "Wheel_FR": {"center": Vector((3.2124, 10.7258, 0.3343)), "unsteer_deg": 25.0},
            "Wheel_RL": {"center": Vector((4.8035, 13.2601, 0.3343)), "unsteer_deg": 0.0},
            "Wheel_RR": {"center": Vector((3.1963, 13.2601, 0.3343)), "unsteer_deg": 0.0},
        },
    },
]


def get_bounds(mesh_data):
    xs = [v.co.x for v in mesh_data.vertices]
    ys = [v.co.y for v in mesh_data.vertices]
    zs = [v.co.z for v in mesh_data.vertices]
    b_min = Vector((min(xs), min(ys), min(zs)))
    b_max = Vector((max(xs), max(ys), max(zs)))
    return b_min, b_max, (b_min + b_max) * 0.5


def process_single_vehicle(cfg, output_dir):
    car_center = cfg["center"]
    bmin = car_center - cfg["half_extents"]
    bmax = car_center + cfg["half_extents"]

    extracted_objs = []
    for src_name in cfg["source_meshes"]:
        src_obj = bpy.data.objects.get(src_name)
        if src_obj is None:
            raise RuntimeError(f"Source object {src_name} not found.")

        mw = src_obj.matrix_world.copy()
        new_mesh = src_obj.data.copy()
        new_mesh.transform(mw)

        bm = bmesh.new()
        bm.from_mesh(new_mesh)
        bm.faces.ensure_lookup_table()

        faces_to_delete = [
            f for f in bm.faces
            if not (
                bmin.x <= f.calc_center_median().x <= bmax.x
                and bmin.y <= f.calc_center_median().y <= bmax.y
            )
        ]
        bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")

        verts_to_delete = [v for v in bm.verts if len(v.link_faces) == 0]
        if verts_to_delete:
            bmesh.ops.delete(bm, geom=verts_to_delete, context="VERTS")

        bm.to_mesh(new_mesh)
        bm.free()
        new_mesh.update()

        part_obj = bpy.data.objects.new(f"Tmp_{src_name}", new_mesh)
        bpy.context.scene.collection.objects.link(part_obj)
        extracted_objs.append(part_obj)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in extracted_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = extracted_objs[0]
    bpy.ops.object.join()

    master_obj = bpy.context.view_layer.objects.active
    master_obj.name = "Vehicle_Working"

    # Classify welded sub-islands into Chassis_Body vs Wheel_FL/FR/RL/RR
    raw_wheel_specs = cfg["wheels"]
    me = master_obj.data
    bm_weld = bmesh.new()
    bm_weld.from_mesh(me)
    bmesh.ops.remove_doubles(bm_weld, verts=bm_weld.verts, dist=0.0005)
    bm_weld.verts.ensure_lookup_table()
    bm_weld.faces.ensure_lookup_table()

    visited_verts = set()
    face_to_wheel = {}
    for v in bm_weld.verts:
        if v.index in visited_verts:
            continue
        stack = [v]
        visited_verts.add(v.index)
        comp_verts = []
        comp_faces = set()
        while stack:
            curr = stack.pop()
            comp_verts.append(curr)
            for f in curr.link_faces:
                comp_faces.add(f.index)
            for e in curr.link_edges:
                ov = e.other_vert(curr)
                if ov.index not in visited_verts:
                    visited_verts.add(ov.index)
                    stack.append(ov)

        if len(comp_verts) > 300:
            continue

        xs = [p.co.x for p in comp_verts]
        ys = [p.co.y for p in comp_verts]
        zs = [p.co.z for p in comp_verts]
        island_center = Vector(((min(xs) + max(xs)) * 0.5,
                                (min(ys) + max(ys)) * 0.5,
                                (min(zs) + max(zs)) * 0.5))

        for w_name, spec in raw_wheel_specs.items():
            if (island_center - spec["center"]).length < 0.40:
                for f_idx in comp_faces:
                    face_to_wheel[f_idx] = w_name
                break

    bm_weld.free()

    part_names = ["Chassis_Body", "Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]
    created_objects = {}

    for part_name in part_names:
        part_mesh = master_obj.data.copy()
        bm_part = bmesh.new()
        bm_part.from_mesh(part_mesh)
        bm_part.faces.ensure_lookup_table()

        if part_name == "Chassis_Body":
            del_faces = [f for f in bm_part.faces if f.index in face_to_wheel]
        else:
            del_faces = [f for f in bm_part.faces if face_to_wheel.get(f.index) != part_name]

        bmesh.ops.delete(bm_part, geom=del_faces, context="FACES")
        del_verts = [v for v in bm_part.verts if len(v.link_faces) == 0]
        if del_verts:
            bmesh.ops.delete(bm_part, geom=del_verts, context="VERTS")

        if part_name in ("Wheel_FL", "Wheel_FR"):
            unsteer_deg = raw_wheel_specs[part_name]["unsteer_deg"]
            if abs(unsteer_deg) > 1e-4:
                xs = [v.co.x for v in bm_part.verts]
                ys = [v.co.y for v in bm_part.verts]
                zs = [v.co.z for v in bm_part.verts]
                w_center = Vector(((min(xs) + max(xs)) * 0.5,
                                   (min(ys) + max(ys)) * 0.5,
                                   (min(zs) + max(zs)) * 0.5))
                rot_unsteer = Matrix.Rotation(math.radians(unsteer_deg), 3, "Z")
                for v in bm_part.verts:
                    v.co = w_center + rot_unsteer @ (v.co - w_center)

        bm_part.normal_update()
        bm_part.to_mesh(part_mesh)
        bm_part.free()
        part_mesh.update()

        part_obj = bpy.data.objects.new(part_name, part_mesh)
        bpy.context.scene.collection.objects.link(part_obj)
        created_objects[part_name] = part_obj

    bpy.data.objects.remove(master_obj, do_unlink=True)

    # Rotate car around Z to face Blender -Y (+Z forward in Three.js)
    rot_align = Matrix.Rotation(math.radians(cfg["align_yaw_deg"]), 3, "Z")
    for obj in created_objects.values():
        for v in obj.data.vertices:
            v.co = rot_align @ (v.co - car_center)
        obj.data.update()

    rl_min, _, rl_c = get_bounds(created_objects["Wheel_RL"].data)
    rr_min, _, rr_c = get_bounds(created_objects["Wheel_RR"].data)
    fl_min, _, fl_c = get_bounds(created_objects["Wheel_FL"].data)
    fr_min, _, fr_c = get_bounds(created_objects["Wheel_FR"].data)

    ground_z = min(rl_min.z, rr_min.z, fl_min.z, fr_min.z)
    center_x = (rl_c.x + rr_c.x) * 0.5
    rear_y = (rl_c.y + rr_c.y) * 0.5
    front_y = (fl_c.y + fr_c.y) * 0.5
    wheelbase_mid_y = (rear_y + front_y) * 0.5

    base_offset = Vector((center_x, wheelbase_mid_y, ground_z))
    for obj in created_objects.values():
        for v in obj.data.vertices:
            v.co -= base_offset
        obj.data.update()

    # Symmetrize left/right track width and set all 4 wheel bottoms exactly on Z=0
    rl_min, rl_max, rl_c = get_bounds(created_objects["Wheel_RL"].data)
    rr_min, rr_max, rr_c = get_bounds(created_objects["Wheel_RR"].data)
    fl_min, fl_max, fl_c = get_bounds(created_objects["Wheel_FL"].data)
    fr_min, fr_max, fr_c = get_bounds(created_objects["Wheel_FR"].data)

    target_track_x = (abs(rl_c.x) + abs(rr_c.x)) * 0.5
    target_front_y = (fl_c.y + fr_c.y) * 0.5
    target_rear_y = (rl_c.y + rr_c.y) * 0.5
    front_radius_z = (fl_max.z - fl_min.z) * 0.5
    rear_radius_z = (rl_max.z - rl_min.z) * 0.5

    wheel_targets = {
        "Wheel_FL": Vector((+target_track_x, target_front_y, front_radius_z)),
        "Wheel_FR": Vector((-target_track_x, target_front_y, front_radius_z)),
        "Wheel_RL": Vector((+target_track_x, target_rear_y,  rear_radius_z)),
        "Wheel_RR": Vector((-target_track_x, target_rear_y,  rear_radius_z)),
    }
    for w_name, target_c in wheel_targets.items():
        w_mesh = created_objects[w_name].data
        _, _, curr_c = get_bounds(w_mesh)
        delta = target_c - curr_c
        for v in w_mesh.vertices:
            v.co += delta
        w_mesh.update()

    # Normalize vehicle dimensions while keeping Y and Z scale equal so wheels stay circular
    all_xs, all_ys, all_zs = [], [], []
    for obj in created_objects.values():
        for v in obj.data.vertices:
            all_xs.append(v.co.x)
            all_ys.append(v.co.y)
            all_zs.append(v.co.z)

    curr_width = max(all_xs) - min(all_xs)
    curr_length = max(all_ys) - min(all_ys)
    scale_yz = cfg["target_length"] / curr_length
    scale_x = cfg["target_width"] / curr_width

    for obj in created_objects.values():
        for v in obj.data.vertices:
            v.co.x *= scale_x
            v.co.y *= scale_yz
            v.co.z *= scale_yz
        obj.data.update()

    # Set exact origins & apply transforms
    for w_name in ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]:
        w_obj = created_objects[w_name]
        bpy.ops.object.select_all(action="DESELECT")
        w_obj.select_set(True)
        bpy.context.view_layer.objects.active = w_obj
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    chassis_obj = created_objects["Chassis_Body"]
    bpy.context.scene.cursor.location = Vector((0.0, 0.0, 0.36))
    bpy.ops.object.select_all(action="DESELECT")
    chassis_obj.select_set(True)
    bpy.context.view_layer.objects.active = chassis_obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Select only our 5 prepared objects and export to GLB
    bpy.ops.object.select_all(action="DESELECT")
    for obj in created_objects.values():
        obj.select_set(True)

    output_glb = os.path.join(output_dir, cfg["filename"])
    bpy.ops.export_scene.gltf(
        filepath=output_glb,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    print(f"Exported {cfg['label']} -> {output_glb} ({os.path.getsize(output_glb)} bytes)")

    # Clean up the 5 objects before processing the next vehicle
    for obj in created_objects.values():
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    output_dir = os.path.join(project_root, "public", "assets")
    os.makedirs(output_dir, exist_ok=True)

    for cfg in VEHICLE_CONFIGS:
        process_single_vehicle(cfg, output_dir)


if __name__ == "__main__":
    main()
