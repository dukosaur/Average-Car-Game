#!/usr/bin/env python3
"""
Forza Horizon Style Satellite Top-Down Map Renderer
Renders high-resolution orthographic satellite photograph directly from circuit_track.glb.
"""
import bpy
import os
import math

def render_map():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    glb_path = os.path.abspath("public/assets/circuit_track.glb")
    out_path = os.path.abspath("public/assets/satellite_world_map.png")

    print(f"Loading GLB from {glb_path}...")
    bpy.ops.import_scene.gltf(filepath=glb_path)

    # World bounds for the circuit:
    # X spans -260m to +220m (center = -20.0m)
    # Y spans -190m to +250m (center = +30.0m)
    # Orthographic scale: 560.0m provides a tight, gorgeous frame filling ~85% with the circuit
    center_x = -20.0
    center_y = 30.0
    ortho_scale = 560.0

    # 1. Orthographic Top-Down Camera
    cam_data = bpy.data.cameras.new("SatelliteCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 1.0
    cam_data.clip_end = 1000.0

    cam_obj = bpy.data.objects.new("SatelliteCam", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # Position looking straight down along -Z
    cam_obj.location = (center_x, center_y, 400.0)
    cam_obj.rotation_euler = (0.0, 0.0, 0.0)

    # 2. Add Canyon River Water Surface Mesh at Z = -8.2m beneath Suspension Bridge
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(20.0, -164.0, -8.2))
    water_obj = bpy.context.active_object
    water_obj.name = "Canyon_River"
    water_obj.scale = (240.0, 42.0, 1.0)

    water_mat = bpy.data.materials.new("RiverWater")
    water_mat.use_nodes = True
    w_nodes = water_mat.node_tree.nodes
    w_links = water_mat.node_tree.links
    w_nodes.clear()
    w_bsdf = w_nodes.new(type="ShaderNodeBsdfPrincipled")
    w_bsdf.inputs["Base Color"].default_value = (0.05, 0.28, 0.42, 1.0) # Deep Azure River Water
    w_bsdf.inputs["Roughness"].default_value = 0.10
    w_bsdf.inputs["Specular IOR Level"].default_value = 0.8
    w_out = w_nodes.new(type="ShaderNodeOutputMaterial")
    w_links.new(w_bsdf.outputs["BSDF"], w_out.inputs["Surface"])
    water_obj.data.materials.append(water_mat)

    # 3. Lighting: Angled warm sunlight to create rich elevation relief shadows
    sun_data = bpy.data.lights.new("Sun", type='SUN')
    sun_data.energy = 5.5
    sun_data.color = (1.0, 0.98, 0.94)
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(46), math.radians(22), math.radians(48))

    # Sky fill light from opposite angle to brighten shadows naturally
    fill_data = bpy.data.lights.new("SkyFill", type='SUN')
    fill_data.energy = 2.2
    fill_data.color = (0.72, 0.86, 1.0)
    fill_obj = bpy.data.objects.new("SkyFill", fill_data)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-42), math.radians(-18), math.radians(-132))

    # Ambient World
    if not scene.world:
        scene.world = bpy.data.worlds.new("World")
    scene.world.color = (0.16, 0.32, 0.16)

    # 4. High-res Render Settings (2048 x 1920)
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1920
    scene.render.resolution_percentage = 100
    scene.render.filepath = out_path
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'

    print("Rendering high-res satellite world map...")
    bpy.ops.render.render(write_still=True)
    print(f"Satellite map rendered -> {out_path} ({os.path.getsize(out_path)} bytes)")

if __name__ == "__main__":
    render_map()
