#!/usr/bin/env python3
"""
Forza Horizon Style Satellite Top-Down Map Renderer
Renders high-resolution orthographic satellite photograph directly from circuit_track.glb.
"""
import bpy
import json
import os
import math


def render_map():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    glb_path = os.path.abspath("public/assets/circuit_track.glb")
    inst_path = os.path.abspath("public/assets/nature_instances.json")
    out_path = os.path.abspath("public/assets/satellite_world_map.png")

    print(f"Loading GLB from {glb_path}...")
    bpy.ops.import_scene.gltf(filepath=glb_path)

    # Hide flat 3D water cutout plane during top-down orthographic render and collect NatTmpl_* templates
    tmpl_nodes = {}
    for obj in list(bpy.data.objects):
        if "Water" in obj.name:
            obj.hide_render = True
            obj.hide_viewport = True
        elif obj.name.startswith("NatTmpl_"):
            key = obj.name[len("NatTmpl_"):]
            tmpl_nodes[key] = obj
            obj.hide_render = True
            obj.hide_viewport = True
            for child in obj.children:
                child.hide_render = True
                child.hide_viewport = True

    # Instantiate lightweight shared-datablock tree/rock/vegetation objects for satellite rendering
    if os.path.exists(inst_path):
        with open(inst_path, "r") as f:
            instances = json.load(f)
        inst_col = bpy.data.collections.new("NatureInstances")
        scene.collection.children.link(inst_col)
        # Collect child mesh datablocks for each template (handles single or multi-primitive glTF nodes)
        tmpl_meshes = {}
        for key, node in tmpl_nodes.items():
            meshes = []
            if node.type == "MESH" and node.data:
                meshes.append(node.data)
            for ch in node.children:
                if ch.type == "MESH" and ch.data:
                    meshes.append(ch.data)
            if meshes:
                tmpl_meshes[key] = meshes
        placed = 0
        for idx, item in enumerate(instances):
            key, x3, y3, z3, sc, rot_y = item
            meshes = tmpl_meshes.get(key)
            if not meshes:
                continue
            wx, wy, tz = x3, -z3, y3
            for m_idx, mesh_data in enumerate(meshes):
                inst_obj = bpy.data.objects.new(f"NatInst_{idx}_{m_idx}", mesh_data)
                inst_obj.location = (wx, wy, tz)
                inst_obj.rotation_euler = (0.0, 0.0, rot_y)
                inst_obj.scale = (sc, sc, sc)
                inst_col.objects.link(inst_obj)
            placed += 1
        print(f"Linked {placed} lightweight nature instances for satellite map render.")

    # Expanded World Bounds:
    # X spans -900.0m to +900.0m (center_x = 0.0, span_x = 1800.0)
    # Y spans -843.75m to +843.75m (center_y = 0.0, span_y = 1687.5 at 2048x1920 aspect ratio)
    center_x = 0.0
    center_y = 0.0
    ortho_scale = 1800.0

    # 1. Orthographic Top-Down Camera
    cam_data = bpy.data.cameras.new("SatelliteCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 1.0
    cam_data.clip_end = 2500.0

    cam_obj = bpy.data.objects.new("SatelliteCam", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    cam_obj.location = (center_x, center_y, 900.0)
    cam_obj.rotation_euler = (0.0, 0.0, 0.0)

    # 2. Lighting: Angled warm sunlight to create rich elevation relief shadows across mountains & canyons
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 5.4
    sun_data.color = (1.0, 0.98, 0.94)
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(46), math.radians(22), math.radians(48))

    # Sky fill light from opposite angle to brighten shadows naturally
    fill_data = bpy.data.lights.new("SkyFill", type="SUN")
    fill_data.energy = 2.3
    fill_data.color = (0.74, 0.87, 1.0)
    fill_obj = bpy.data.objects.new("SkyFill", fill_data)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-42), math.radians(-18), math.radians(-132))

    if not scene.world:
        scene.world = bpy.data.worlds.new("World")
    scene.world.color = (0.16, 0.32, 0.16)

    # 3. High-res Render Settings (2048 x 1920)
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1920
    scene.render.resolution_percentage = 100
    scene.render.filepath = out_path
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"

    print("Rendering high-res expanded satellite world map...")
    bpy.ops.render.render(write_still=True)
    print(f"Satellite map rendered -> {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == "__main__":
    render_map()
