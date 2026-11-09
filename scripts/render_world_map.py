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

    # 2. Lighting: Angled warm sunlight to create rich elevation relief shadows
    sun_data = bpy.data.lights.new("Sun", type='SUN')
    sun_data.energy = 5.2
    sun_data.color = (1.0, 0.98, 0.92)
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(42), math.radians(18), math.radians(45))

    # Sky fill light from opposite angle to brighten shadows naturally
    fill_data = bpy.data.lights.new("SkyFill", type='SUN')
    fill_data.energy = 2.0
    fill_data.color = (0.75, 0.88, 1.0)
    fill_obj = bpy.data.objects.new("SkyFill", fill_data)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-40), math.radians(-20), math.radians(-135))

    # Ambient World
    if not scene.world:
        scene.world = bpy.data.worlds.new("World")
    scene.world.color = (0.16, 0.32, 0.16)

    # 3. High-res Render Settings (2048 x 1920)
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
