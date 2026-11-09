#!/usr/bin/env python3
import os
import math
import random
import bpy

def natural_terrain_z(wx, wy):
    w_mtn = 26.0 * math.exp(-(((wx + 205.0) / 95.0) ** 2 + ((wy - 85.0) / 135.0) ** 2))
    nw_peak = 22.0 * math.exp(-(((wx + 95.0) / 80.0) ** 2 + ((wy - 215.0) / 70.0) ** 2))
    e_ridge = 13.5 * math.exp(-(((wx - 215.0) / 70.0) ** 2 + ((wy + 10.0) / 140.0) ** 2))

    river_center_y = -164.0 + 8.0 * math.sin(wx / 55.0)
    gorge_y = math.exp(-(((wy - river_center_y) / 24.0) ** 2))
    gorge_x = 1.0 if (-100.0 < wx < 145.0) else 0.0
    river_gorge = -9.5 * gorge_y * gorge_x

    hills = 2.4 * math.sin(wx / 42.0) * math.cos(wy / 42.0) + 1.4 * math.sin((wx + wy) / 30.0)
    rim = max(
        0.0,
        (-295.0 - wx) / 65.0,
        (wx - 255.0) / 65.0,
        (-225.0 - wy) / 65.0,
        (wy - 265.0) / 65.0,
    )
    h_rim = 30.0 * (rim ** 1.5) if rim > 0.0 else 0.0
    return w_mtn + nw_peak + e_ridge + river_gorge + hills + h_rim

def test():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    fbx_dir = os.path.join(project_root, "raw_assets", "Ultimate Nature Pack by Quaternius", "FBX")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    templates = {}
    model_files = {
        "pine1": "PineTree_1.fbx",
        "pine_autumn": "PineTree_Autumn_1.fbx",
        "common1": "CommonTree_1.fbx",
        "autumn1": "CommonTree_Autumn_1.fbx",
        "birch1": "BirchTree_1.fbx",
        "rock1": "Rock_1.fbx",
        "rock2": "Rock_2.fbx",
        "rock3": "Rock_3.fbx",
        "rock_moss1": "Rock_Moss_1.fbx",
        "rock_moss2": "Rock_Moss_2.fbx",
        "bush1": "Bush_1.fbx",
        "bush_berry": "BushBerries_1.fbx",
        "plant1": "Plant_1.fbx",
        "woodlog": "WoodLog.fbx"
    }

    for key, fbx_name in model_files.items():
        fbx_path = os.path.join(fbx_dir, fbx_name)
        bpy.ops.import_scene.fbx(filepath=fbx_path)
        obj = bpy.context.selected_objects[0]
        bpy.context.scene.collection.objects.unlink(obj)
        templates[key] = obj

    print("Loaded all templates.")

    random.seed(42)

    # 1. Trees
    tree_instances = []
    # Anchor dummy at origin
    dummy_tree = bpy.data.objects.new("Circuit_Trees", bpy.data.meshes.new("Circuit_Trees_Mesh"))
    bpy.context.scene.collection.objects.link(dummy_tree)
    tree_instances.append(dummy_tree)

    # Place sample pines and common trees
    for i in range(120):
        wx = random.uniform(-280, 260)
        wy = random.uniform(-220, 260)
        tz = natural_terrain_z(wx, wy)
        if tz < 1.0: continue
        
        tmpl_key = "pine1" if tz > 8.0 else ("autumn1" if random.random() < 0.4 else "common1")
        tmpl = templates[tmpl_key]
        cp = tmpl.copy()
        cp.data = tmpl.data.copy()
        cp.location = (wx, wy, tz)
        cp.rotation_euler = (0, 0, random.uniform(0, math.pi * 2))
        sc = random.uniform(2.6, 4.0)
        cp.scale = (sc, sc, sc)
        bpy.context.scene.collection.objects.link(cp)
        tree_instances.append(cp)

    bpy.ops.object.select_all(action='DESELECT')
    for o in tree_instances: o.select_set(True)
    bpy.context.view_layer.objects.active = dummy_tree
    bpy.ops.object.join()
    print(f"Joined Circuit_Trees: {len(dummy_tree.data.vertices)} verts, {len(dummy_tree.data.polygons)} faces")

test()
