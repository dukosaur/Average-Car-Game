#!/usr/bin/env python3
"""
Extracts road spline curves and landmark POIs from build_circuit.py definitions
and exports them as public/assets/map_routes.json for the interactive Forza world map.
"""
import json
import math
import os

def arc_ctrl_pts(cx, cy, radius, deg_start, deg_end, z_start, z_end, count=6):
    pts = []
    for k in range(count):
        t = k / float(count - 1)
        ang = math.radians(deg_start + t * (deg_end - deg_start))
        x = cx + radius * math.cos(ang)
        y = cy + radius * math.sin(ang)
        pts.append((round(x, 2), round(-y, 2))) # Three.js: Z = -Blender Y
    return pts

def sample_catmull_rom(control_pts, num_samples=25, closed=False):
    """Generates smooth interpolated points along a 2D polyline."""
    if len(control_pts) < 2:
        return control_pts
    pts = list(control_pts)
    if closed:
        pts = [pts[-1]] + pts + [pts[0], pts[1]]
    else:
        pts = [pts[0]] + pts + [pts[-1]]

    result = []
    n = len(pts) - 3
    for i in range(n):
        p0 = pts[i]
        p1 = pts[i + 1]
        p2 = pts[i + 2]
        p3 = pts[i + 3]
        for step in range(num_samples):
            t = step / float(num_samples)
            t2 = t * t
            t3 = t2 * t
            # Standard Catmull-Rom
            x = 0.5 * ((2 * p1[0]) +
                       (-p0[0] + p2[0]) * t +
                       (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) +
                       (-p0[1] + p2[1]) * t +
                       (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            result.append([round(x, 2), round(y, 2)])
    if not closed:
        result.append([round(control_pts[-1][0], 2), round(control_pts[-1][1], 2)])
    return result

def generate_map_routes():
    # Route 1: Horizon Express Highway (Blender coordinates: x, y -> Three.js: x, -y)
    hwy_blender = [
        (0.0, -70.0),
        (0.0, 0.0),
        (0.0, 85.0),
        (18.0, 145.0),
        (75.0, 172.0),
        (152.0, 150.0),
        (202.0, 82.0),
        (212.0, 0.0),
        (198.0, -85.0),
        (145.0, -148.0),
        (65.0, -164.0),
        (-25.0, -164.0),
        (-108.0, -146.0),
        (-115.0, -98.0),
        (-55.0, -95.0),
    ]
    hwy_pts = [(x, -y) for x, y in hwy_blender]
    route1 = sample_catmull_rom(hwy_pts, num_samples=20, closed=True)

    # Route 2: West Mountain Touge
    touge_blender = [
        (-115.0, -98.0),
        (-142.0, -98.0),
        (-165.0, -68.0),
        (-165.0, -28.0),
    ]
    touge_pts = [(x, -y) for x, y in touge_blender]
    touge_pts += arc_ctrl_pts(-232.0, 12.0, 22.0, 270.0, 90.0, 0, 0, count=6)
    touge_pts += arc_ctrl_pts(-162.0, 56.0, 22.0, -90.0, 90.0, 0, 0, count=6)
    touge_pts += arc_ctrl_pts(-234.0, 100.0, 22.0, 270.0, 90.0, 0, 0, count=6)
    touge_pts += arc_ctrl_pts(-162.0, 148.0, 23.0, -90.0, 95.0, 0, 0, count=6)
    touge_top = [
        (-195.0, 196.0),
        (-145.0, 232.0),
        (-75.0, 232.0),
        (15.0, 222.0),
        (68.0, 198.0),
        (75.0, 172.0),
    ]
    touge_pts += [(x, -y) for x, y in touge_top]
    route2 = sample_catmull_rom(touge_pts, num_samples=18, closed=False)

    # Route 3: Central Crosstown Overpass
    overpass_blender = [
        (-165.0, -28.0),
        (-135.0, -28.0),
        (-65.0, 18.0),
        (0.0, 28.0),
        (62.0, 24.0),
        (112.0, -8.0),
        (168.0, -76.0),
        (198.0, -85.0),
    ]
    route3 = sample_catmull_rom([(x, -y) for x, y in overpass_blender], num_samples=18, closed=False)

    # Route 4: North-East Meadow Valley Connector
    valley_blender = [
        (112.0, -8.0),
        (132.0, 18.0),
        (92.0, 78.0),
        (32.0, 85.0),
        (0.0, 85.0),
    ]
    route4 = sample_catmull_rom([(x, -y) for x, y in valley_blender], num_samples=16, closed=False)

    # Route 5: South-West Canyon Foothill Shortcut
    sw_blender = [
        (-165.0, -68.0),
        (-132.0, -64.0),
        (-55.0, -45.0),
        (0.0, -45.0),
    ]
    route5 = sample_catmull_rom([(x, -y) for x, y in sw_blender], num_samples=16, closed=False)

    # Key Landmarks / Points of Interest (Three.js coordinates: X, Z)
    landmarks = [
        {
            "id": "festival",
            "name": "HORIZON FESTIVAL STAGING",
            "type": "festival",
            "x": 0.0,
            "z": 0.0,
            "desc": "Main paddock & starting grid"
        },
        {
            "id": "suspension_bridge",
            "name": "CANYON SUSPENSION BRIDGE",
            "type": "bridge",
            "x": 20.0,
            "z": 164.0,
            "desc": "Monumental twin-tower steel suspension bridge"
        },
        {
            "id": "caldera_touge",
            "name": "LA GRAN CALDERA TOUGE",
            "type": "mountain",
            "x": -234.0,
            "z": -100.0,
            "desc": "Triple-hairpin technical drift pass"
        },
        {
            "id": "speedway_east",
            "name": "EAST COAST SPEEDWAY",
            "type": "speedway",
            "x": 212.0,
            "z": 0.0,
            "desc": "High-banked wide-open top speed sweeper"
        },
        {
            "id": "overpass",
            "name": "CROSS-VALLEY OVERPASS",
            "type": "overpass",
            "x": 0.0,
            "z": -28.0,
            "desc": "Elevated highway bridge (+9.6m)"
        },
        {
            "id": "meadow_pass",
            "name": "NORTH MEADOW CHICANE",
            "type": "scenic",
            "x": 65.0,
            "z": -195.0,
            "desc": "High-speed sweeping hill curves"
        },
        {
            "id": "canyon_foothills",
            "name": "SOUTH FOOTHILL SHORTCUT",
            "type": "canyon",
            "x": -110.0,
            "z": 55.0,
            "desc": "Tight technical chicane along the canyon walls"
        }
    ]

    map_metadata = {
        "world_bounds": {
            "center_x": -20.0,
            "center_z": -30.0,
            "span_x": 560.0,
            "span_z": 525.0,
            "min_x": -300.0,
            "max_x": 260.0,
            "min_z": -292.5,
            "max_z": 232.5
        },
        "image": {
            "width": 2048,
            "height": 1920,
            "url": "/assets/satellite_world_map.png"
        },
        "routes": [
            {"id": "hwy", "name": "Horizon Express Highway", "type": "highway", "width": 8.0, "color": "#00f0ff", "glow": "#00b4d8", "points": route1},
            {"id": "touge", "name": "La Gran Caldera Touge Pass", "type": "touge", "width": 5.5, "color": "#ff007a", "glow": "#d00060", "points": route2},
            {"id": "overpass", "name": "Crosstown Overpass", "type": "overpass", "width": 5.5, "color": "#ffbe0b", "glow": "#fb5607", "points": route3},
            {"id": "valley", "name": "North Meadow Connector", "type": "connector", "width": 4.5, "color": "#ffffff", "glow": "rgba(255,255,255,0.4)", "points": route4},
            {"id": "shortcut", "name": "South Foothill Shortcut", "type": "connector", "width": 4.5, "color": "#ffffff", "glow": "rgba(255,255,255,0.4)", "points": route5},
        ],
        "landmarks": landmarks
    }

    out_file = os.path.abspath("public/assets/map_routes.json")
    with open(out_file, "w") as f:
        json.dump(map_metadata, f, indent=2)
    print(f"Exported map routes & landmarks metadata -> {out_file} ({os.path.getsize(out_file)} bytes)")

if __name__ == "__main__":
    generate_map_routes()
