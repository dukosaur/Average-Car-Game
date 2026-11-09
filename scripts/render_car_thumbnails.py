import bpy
import os
import math

cars = [
    ("player_car.glb", "thumb_supra.png"),
    ("car_veneno.glb", "thumb_veneno.png"),
    ("car_mustang.glb", "thumb_mustang.png"),
    ("car_fordgt.glb", "thumb_fordgt.png"),
    ("car_amg.glb", "thumb_amg.png")
]

assets_dir = os.path.abspath("public/assets")

for glb_name, out_name in cars:
    glb_path = os.path.join(assets_dir, glb_name)
    out_path = os.path.join(assets_dir, out_name)
    
    bpy.ops.wm.read_factory_settings(use_empty=True)
    
    # Import GLB
    bpy.ops.import_scene.gltf(filepath=glb_path)
    
    # Calculate bounding box of all imported meshes
    min_x, max_x = 999.0, -999.0
    min_y, max_y = 999.0, -999.0
    min_z, max_z = 999.0, -999.0
    
    imported_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in imported_objs:
        for v in obj.bound_box:
            world_v = obj.matrix_world @ bpy.types.mathutils.Vector(v) if hasattr(bpy.types, 'mathutils') else obj.matrix_world @ __import__('mathutils').Vector(v)
            min_x = min(min_x, world_v.x)
            max_x = max(max_x, world_v.x)
            min_y = min(min_y, world_v.y)
            max_y = max(max_y, world_v.y)
            min_z = min(min_z, world_v.z)
            max_z = max(max_z, world_v.z)
            
    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5
    center_z = (min_z + max_z) * 0.5
    
    size_x = max_x - min_x
    size_y = max_y - min_y
    size_z = max_z - min_z
    max_dim = max(size_x, size_y, size_z)
    
    # Shift car so center is at origin
    for obj in imported_objs:
        obj.location.x -= center_x
        obj.location.y -= center_y
        obj.location.z -= center_z
        
    # Setup Camera (Forza 3/4 dynamic front view)
    cam_data = bpy.data.cameras.new("ThumbCamera")
    cam_data.lens = 55 # 55mm portrait/studio lens
    cam_obj = bpy.data.objects.new("ThumbCamera", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    
    # Position camera: 3/4 front-left angle
    dist = max_dim * 1.55
    cam_obj.location = (dist * 0.85, -dist * 1.05, dist * 0.42)
    
    # Look at origin
    direction = -cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()
    
    # Setup Studio Lights
    # Key light
    key_light = bpy.data.lights.new("KeyLight", type='SUN')
    key_light.energy = 4.5
    key_light.color = (1.0, 0.98, 0.95)
    key_obj = bpy.data.objects.new("KeyLight", key_light)
    key_obj.rotation_euler = (math.radians(45), math.radians(25), math.radians(-35))
    bpy.context.scene.collection.objects.link(key_obj)
    
    # Fill light
    fill_light = bpy.data.lights.new("FillLight", type='SUN')
    fill_light.energy = 2.2
    fill_light.color = (0.85, 0.92, 1.0)
    fill_obj = bpy.data.objects.new("FillLight", fill_light)
    fill_obj.rotation_euler = (math.radians(35), math.radians(-40), math.radians(130))
    bpy.context.scene.collection.objects.link(fill_obj)
    
    # Rim light
    rim_light = bpy.data.lights.new("RimLight", type='SUN')
    rim_light.energy = 3.0
    rim_light.color = (1.0, 1.0, 1.0)
    rim_obj = bpy.data.objects.new("RimLight", rim_light)
    rim_obj.rotation_euler = (math.radians(-30), math.radians(60), math.radians(-160))
    bpy.context.scene.collection.objects.link(rim_obj)
    
    # Render settings: transparent PNG, 480x280
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.render.resolution_x = 480
    scene.render.resolution_y = 280
    scene.render.filepath = out_path
    
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {out_name} to {out_path}")
