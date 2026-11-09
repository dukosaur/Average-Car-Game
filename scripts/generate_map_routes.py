#!/usr/bin/env python3
"""
Extracts exact 100% matched road spline curves and offset landmark POIs
using the identical Centripetal Catmull-Rom math and control points as build_circuit.py.
Outputs public/assets/map_routes.json.
"""
import json
import math
import os
import sys

from mathutils import Vector

def arc_ctrl_pts(cx, cy, radius, deg_start, deg_end, z_start, z_end, count=5):
    pts = []
    for k in range(count):
        t = k / float(count - 1)
        ang = math.radians(deg_start + t * (deg_end - deg_start))
        x = cx + radius * math.cos(ang)
        y = cy + radius * math.sin(ang)
        z = z_start + t * (z_end - z_start)
        pts.append(Vector((x, y, z)))
    return pts

def catmull_rom_centripetal(p0, p1, p2, p3, t, alpha=0.5):
    def tj(ti, pa, pb):
        d = (pb - pa).length
        return ti + max(1e-4, d) ** alpha

    t0 = 0.0
    t1 = tj(t0, p0, p1)
    t2 = tj(t1, p1, p2)
    t3 = tj(t2, p2, p3)

    u = t1 + t * (t2 - t1)
    A1 = ((t1 - u) / (t1 - t0)) * p0 + ((u - t0) / (t1 - t0)) * p1
    A2 = ((t2 - u) / (t2 - t1)) * p1 + ((u - t1) / (t2 - t1)) * p2
    A3 = ((t3 - u) / (t3 - t2)) * p2 + ((u - t2) / (t3 - t2)) * p3

    B1 = ((t2 - u) / (t2 - t0)) * A1 + ((u - t0) / (t2 - t0)) * A2
    B2 = ((t3 - u) / (t3 - t1)) * A2 + ((u - t1) / (t3 - t1)) * A3

    return ((t2 - u) / (t2 - t1)) * B1 + ((u - t1) / (t2 - t1)) * B2

def sample_smooth_3d_curve(ctrl_pts, step_len=2.5, closed=False):
    n = len(ctrl_pts)
    if n < 2:
        return []

    dense = []
    segs = n if closed else (n - 1)
    samples_per_seg = 48

    for i in range(segs):
        if closed:
            p0 = ctrl_pts[(i - 1) % n]
            p1 = ctrl_pts[i % n]
            p2 = ctrl_pts[(i + 1) % n]
            p3 = ctrl_pts[(i + 2) % n]
        else:
            p0 = ctrl_pts[i - 1] if i > 0 else ctrl_pts[0] + (ctrl_pts[0] - ctrl_pts[1])
            p1 = ctrl_pts[i]
            p2 = ctrl_pts[i + 1]
            p3 = ctrl_pts[i + 2] if i + 2 < n else ctrl_pts[-1] + (ctrl_pts[-1] - ctrl_pts[-2])

        for s in range(samples_per_seg):
            if i > 0 and s == 0:
                continue
            t = s / float(samples_per_seg) if (closed or i < segs - 1) else s / float(samples_per_seg - 1)
            dense.append(catmull_rom_centripetal(p0, p1, p2, p3, t))

    if closed:
        dense.append(ctrl_pts[0].copy())
    elif (dense[-1] - ctrl_pts[-1]).length > 1e-3:
        dense.append(ctrl_pts[-1].copy())

    cum_len = [0.0]
    for i in range(1, len(dense)):
        cum_len.append(cum_len[-1] + (dense[i] - dense[i - 1]).length)
    total_len = cum_len[-1]
    num_steps = max(4, int(round(total_len / step_len)))
    if num_steps % 2 != 0:
        num_steps += 1

    uniform_pts = []
    idx = 0
    for k in range(num_steps + 1):
        target_d = (k / float(num_steps)) * total_len
        while idx + 1 < len(cum_len) and cum_len[idx + 1] < target_d:
            idx += 1
        if idx + 1 >= len(cum_len):
            uniform_pts.append(dense[-1].copy())
        else:
            d0, d1 = cum_len[idx], cum_len[idx + 1]
            alpha = (target_d - d0) / max(1e-6, d1 - d0)
            uniform_pts.append(dense[idx].lerp(dense[idx + 1], alpha))

    if closed:
        uniform_pts[-1] = uniform_pts[0].copy()

    result = []
    m = len(uniform_pts)
    for k in range(m):
        if closed:
            prev_p = uniform_pts[(k - 1) % (m - 1)]
            next_p = uniform_pts[(k + 1) % (m - 1)]
            tan3 = next_p - prev_p
        else:
            if k == 0:
                tan3 = uniform_pts[1] - uniform_pts[0]
            elif k == m - 1:
                tan3 = uniform_pts[-1] - uniform_pts[-2]
            else:
                tan3 = uniform_pts[k + 1] - uniform_pts[k - 1]
        tan2 = Vector((tan3.x, tan3.y, 0.0))
        if tan2.length > 1e-6:
            tan2.normalize()
        else:
            tan2 = Vector((0.0, 1.0, 0.0))
        result.append((uniform_pts[k], tan2))
    return result

def closest_sample_index(pt, poly, closed=False):
    best_k = 0
    best_d = 99999.0
    limit = len(poly) - 1 if closed else len(poly)
    for k in range(limit):
        p = poly[k][0]
        d = math.hypot(pt.x - p.x, pt.y - p.y)
        if d < best_d:
            best_d = d
            best_k = k
    return best_k, best_d

def dist_to_polyline_2d(px, py, poly):
    best_d = 9999.0
    for i in range(len(poly) - 1):
        p1 = poly[i][0]
        p2 = poly[i + 1][0]
        dx = p2.x - p1.x
        dy = p2.y - p1.y
        l2 = dx * dx + dy * dy
        if l2 < 1e-6:
            d = math.hypot(px - p1.x, py - p1.y)
        else:
            t = max(0.0, min(1.0, ((px - p1.x) * dx + (py - p1.y) * dy) / l2))
            proj_x = p1.x + t * dx
            proj_y = p1.y + t * dy
            d = math.hypot(px - proj_x, py - proj_y)
        if d < best_d:
            best_d = d
    return best_d, 0.0

def trim_branch_for_fillet(samples, start_parent, start_half_w, start_closed, end_parent, end_half_w, end_closed, fillet_dist=7.0):
    i_start = 0
    while i_start + 1 < len(samples) // 3:
        d, _ = dist_to_polyline_2d(samples[i_start][0].x, samples[i_start][0].y, start_parent)
        if d >= start_half_w + fillet_dist:
            break
        i_start += 1

    i_end = len(samples) - 1
    while i_end - 1 > (2 * len(samples)) // 3:
        d, _ = dist_to_polyline_2d(samples[i_end][0].x, samples[i_end][0].y, end_parent)
        if d >= end_half_w + fillet_dist:
            break
        i_end -= 1

    trimmed = list(samples[i_start : i_end + 1])
    k_s, _ = closest_sample_index(trimmed[0][0], start_parent, closed=start_closed)
    k_e, _ = closest_sample_index(trimmed[-1][0], end_parent, closed=end_closed)
    return trimmed, (k_s, "side"), (k_e, "side")

def to_three(v):
    # Three.js: X = Blender X, Z = -Blender Y
    return [round(v.x, 2), round(-v.y, 2)]

def extract_and_save():
    # 1. HWY
    hwy_ctrl = [
        Vector((0.0, -70.0, 0.0)),
        Vector((0.0, 0.0, 0.0)),
        Vector((0.0, 85.0, 0.0)),
        Vector((18.0, 145.0, 2.2)),
        Vector((75.0, 172.0, 5.0)),
        Vector((152.0, 150.0, 7.5)),
        Vector((202.0, 82.0, 9.5)),
        Vector((212.0, 0.0, 10.8)),
        Vector((198.0, -85.0, 10.2)),
        Vector((145.0, -148.0, 10.5)),
        Vector((65.0, -164.0, 10.8)),
        Vector((-25.0, -164.0, 10.4)),
        Vector((-108.0, -146.0, 5.2)),
        Vector((-115.0, -98.0, 2.2)),
        Vector((-55.0, -95.0, 0.6)),
    ]
    hwy_samples = sample_smooth_3d_curve(hwy_ctrl, step_len=2.5, closed=True)

    # 2. TOUGE
    touge_ctrl = (
        [
            Vector((-115.0, -98.0, 2.2)),
            Vector((-142.0, -98.0, 3.0)),
            Vector((-165.0, -68.0, 4.5)),
            Vector((-165.0, -28.0, 6.2)),
        ]
        + arc_ctrl_pts(-232.0, 12.0, 22.0, 270.0, 90.0, 7.8, 10.6, count=5)
        + arc_ctrl_pts(-162.0, 56.0, 22.0, -90.0, 90.0, 12.0, 14.8, count=5)
        + arc_ctrl_pts(-234.0, 100.0, 22.0, 270.0, 90.0, 16.2, 19.2, count=5)
        + arc_ctrl_pts(-162.0, 148.0, 23.0, -90.0, 95.0, 20.6, 23.8, count=5)
        + [
            Vector((-195.0, 196.0, 24.8)),
            Vector((-145.0, 232.0, 23.0)),
            Vector((-75.0, 232.0, 17.5)),
            Vector((15.0, 222.0, 10.5)),
            Vector((68.0, 198.0, 6.2)),
            Vector((75.0, 172.0, 5.0)),
        ]
    )
    touge_raw = sample_smooth_3d_curve(touge_ctrl, step_len=2.5, closed=False)
    touge_samples, t_s_info, t_e_info = trim_branch_for_fillet(
        touge_raw, hwy_samples, 7.6, True, hwy_samples, 7.6, True, fillet_dist=6.0
    )

    # 3. OVERPASS
    overpass_ctrl = [
        Vector((-165.0, -28.0, 6.2)),
        Vector((-135.0, -28.0, 6.6)),
        Vector((-65.0, 18.0, 8.8)),
        Vector((0.0, 28.0, 9.6)), # Elevated overpass span +9.6m
        Vector((62.0, 24.0, 8.2)),
        Vector((112.0, -8.0, 6.4)),
        Vector((168.0, -76.0, 9.4)),
        Vector((198.0, -85.0, 10.2)),
    ]
    overpass_raw = sample_smooth_3d_curve(overpass_ctrl, step_len=2.5, closed=False)
    overpass_samples, o_s_info, o_e_info = trim_branch_for_fillet(
        overpass_raw, touge_samples, 5.4, False, hwy_samples, 7.6, True, fillet_dist=6.0
    )

    # 4. VALLEY
    valley_ctrl = [
        Vector((112.0, -8.0, 6.4)),
        Vector((132.0, 18.0, 5.2)),
        Vector((92.0, 78.0, 2.5)),
        Vector((32.0, 85.0, 0.4)),
        Vector((0.0, 85.0, 0.0)),
    ]
    valley_raw = sample_smooth_3d_curve(valley_ctrl, step_len=2.5, closed=False)
    valley_samples, v_s_info, v_e_info = trim_branch_for_fillet(
        valley_raw, overpass_samples, 5.4, False, hwy_samples, 7.6, True, fillet_dist=6.0
    )

    # 5. SOUTH-WEST SHORTCUT
    sw_ctrl = [
        Vector((-165.0, -68.0, 4.5)),
        Vector((-132.0, -64.0, 3.5)),
        Vector((-55.0, -45.0, 1.0)),
        Vector((0.0, -45.0, 0.0)),
    ]
    sw_raw = sample_smooth_3d_curve(sw_ctrl, step_len=2.5, closed=False)
    sw_samples, sw_s_info, sw_e_info = trim_branch_for_fillet(
        sw_raw, touge_samples, 5.4, False, hwy_samples, 7.6, True, fillet_dist=6.0
    )

    # Build connected route polylines:
    # Highway: closed loop
    r1_pts = [to_three(s[0]) for s in hwy_samples]

    # Touge: prepend highway junction point, append highway junction point
    r2_pts = [to_three(hwy_samples[t_s_info[0]][0])] + [to_three(s[0]) for s in touge_samples] + [to_three(hwy_samples[t_e_info[0]][0])]

    # Overpass: prepend touge junction point, append highway junction point
    r3_pts = [to_three(touge_samples[o_s_info[0]][0])] + [to_three(s[0]) for s in overpass_samples] + [to_three(hwy_samples[o_e_info[0]][0])]

    # Extract the elevated bridge section of the overpass (X in [-45, +45], passes over Route 1)
    bridge_pts = []
    for s in overpass_samples:
        pt = s[0]
        if -48.0 <= pt.x <= 48.0:
            bridge_pts.append(to_three(pt))

    # Valley: prepend overpass junction point, append highway junction point
    r4_pts = [to_three(overpass_samples[v_s_info[0]][0])] + [to_three(s[0]) for s in valley_samples] + [to_three(hwy_samples[v_e_info[0]][0])]

    # SW Shortcut: prepend touge junction point, append highway junction point
    r5_pts = [to_three(touge_samples[sw_s_info[0]][0])] + [to_three(s[0]) for s in sw_samples] + [to_three(hwy_samples[sw_e_info[0]][0])]

    # Suspension Bridge Span on Route 1 (X in [-35, +75], Y in [-175, -155])
    suspension_span_pts = []
    for s in hwy_samples:
        pt = s[0]
        if -35.0 <= pt.x <= 75.0 and -172.0 <= pt.y <= -156.0:
            suspension_span_pts.append(to_three(pt))

    # Natural Off-Road POI locations (shifted into roadside terrain so they NEVER block roads or overpass)
    landmarks = [
        {
            "id": "festival",
            "name": "HORIZON FESTIVAL HUB",
            "type": "festival",
            "x": -38.0,
            "z": 10.0,
            "desc": "Main festival paddock & staging grid"
        },
        {
            "id": "overpass",
            "name": "CROSS-VALLEY OVERPASS",
            "type": "overpass",
            "x": 42.0,
            "z": -48.0,
            "desc": "Elevated 2-lane bridge crossing above the express highway"
        },
        {
            "id": "caldera_touge",
            "name": "LA GRAN CALDERA TOUGE",
            "type": "mountain",
            "x": -252.0,
            "z": -118.0,
            "desc": "Mountain summit overlook & technical drift pass"
        },
        {
            "id": "suspension_bridge",
            "name": "CANYON SUSPENSION BRIDGE",
            "type": "bridge",
            "x": 25.0,
            "z": 185.0,
            "desc": "Scenic canyon gorge vista & twin steel suspension towers"
        },
        {
            "id": "speedway_east",
            "name": "EAST COAST SPEEDWAY",
            "type": "speedway",
            "x": 238.0,
            "z": 10.0,
            "desc": "Coastal banked sweeper & top-speed testing corridor"
        },
        {
            "id": "canyon_foothills",
            "name": "SOUTH FOOTHILL SHORTCUT",
            "type": "canyon",
            "x": -126.0,
            "z": 72.0,
            "desc": "Scenic foothill chicane along the canyon walls"
        },
        {
            "id": "meadow_pass",
            "name": "NORTH MEADOW CHICANE",
            "type": "scenic",
            "x": 76.0,
            "z": -210.0,
            "desc": "Rolling meadow vista & high-speed curve"
        }
    ]

    out_data = {
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
            {
                "id": "hwy",
                "name": "Horizon Express Highway",
                "type": "highway",
                "layer": "ground",
                "points": r1_pts
            },
            {
                "id": "touge",
                "name": "West Mountain Touge",
                "type": "secondary",
                "layer": "ground",
                "points": r2_pts
            },
            {
                "id": "overpass",
                "name": "Cross-Valley Overpass Ground Connectors",
                "type": "secondary",
                "layer": "ground",
                "points": r3_pts
            },
            {
                "id": "overpass_bridge",
                "name": "Cross-Valley Overpass Bridge Structure",
                "type": "bridge_elevated",
                "layer": "elevated",
                "points": bridge_pts
            },
            {
                "id": "valley",
                "name": "North-East Meadow Connector",
                "type": "secondary",
                "layer": "ground",
                "points": r4_pts
            },
            {
                "id": "sw_shortcut",
                "name": "South-West Canyon Shortcut",
                "type": "secondary",
                "layer": "ground",
                "points": r5_pts
            }
        ],
        "landmarks": landmarks
    }

    out_path = os.path.abspath("public/assets/map_routes.json")
    with open(out_path, "w") as f:
        json.dump(out_data, f, indent=2)
    print(f"Exported exact matching routes & non-blocking POIs to {out_path} ({len(json.dumps(out_data))} bytes)")

if __name__ == "__main__":
    extract_and_save()
