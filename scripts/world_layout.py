"""
Shared Single Source of Truth for the Expanded Multi-Biome Open-World Layout.
Used by both `scripts/build_circuit.py` (3D Blender GLB mesh + terrain + props)
and `scripts/generate_map_routes.py` (2D World Map splines + GPS A* graph + POIs).

World Scale:
  - Playable Satellite Map Bounds (2048 x 1920):
      X in [-900.0, +900.0] (1800m East-West)
      Y in [-843.75, +843.75] (1687.5m North-South; Three.js Z = -Y)
  - Total Drivable Road Network: ~14.5 km across 11 interconnected routes
  - Elevation Range: -12.0m (Ocean Floor) to +76.0m (Snowy Alpine Summit)
"""

import math
from mathutils import Vector

WORLD_BOUNDS = {
    "center_x": 0.0,
    "center_z": 0.0,
    "span_x": 4240.0,
    "span_z": 3975.0,
    "min_x": -2120.0,
    "max_x": 2120.0,
    "min_z": -1987.5,
    "max_z": 1987.5,
}

TERRAIN_MIN_X = -2160.0
TERRAIN_MAX_X = 2160.0
TERRAIN_MIN_Y = -2025.0
TERRAIN_MAX_Y = 2025.0
TERRAIN_GRID_STEP = 12


def smoothstep(edge0, edge1, x):
    if edge1 == edge0:
        return 1.0 if x >= edge1 else 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def arc_ctrl_pts(cx, cy, radius, deg_start, deg_end, z_start, z_end, count=5):
    """Generate `count` control points along a smooth circular arc in 3D for round touge hairpins."""
    pts = []
    for k in range(count):
        t = k / float(count - 1)
        ang = math.radians(deg_start + t * (deg_end - deg_start))
        x = cx + radius * math.cos(ang)
        y = cy + radius * math.sin(ang)
        z = z_start + t * (z_end - z_start)
        pts.append(Vector((x, y, z)))
    return pts


def roundabout_ctrl_pts(cx, cy, radius, z, count=12):
    """Generate CCW circular control points for a real-life roundabout (exterior on 'right')."""
    pts = []
    for i in range(count):
        ang = 2.0 * math.pi * i / float(count)
        pts.append(Vector((cx + radius * math.cos(ang), cy + radius * math.sin(ang), z)))
    return pts


def catmull_rom_centripetal(p0, p1, p2, p3, t, alpha=0.5):
    """Centripetal Catmull-Rom spline evaluation in 3D (never forms cusps or self-loops)."""
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
    """
    Sample a 3D Centripetal Catmull-Rom spline passing through `ctrl_pts` at uniform
    arc-length steps `step_len`. Returns `[(pos_vec3, tangent_vec2_xy), ...]`.
    """
    n = len(ctrl_pts)
    if n < 2:
        return []

    dense = []
    segs = n if closed else (n - 1)
    samples_per_seg = 64

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
    """Find the index `k` in `poly` (`[(pos, tan2), ...]`) closest in 2D to `pt`."""
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
    best_z = 0.0
    for i in range(len(poly) - 1):
        pA = poly[i][0]
        pB = poly[i + 1][0]
        vx = pB.x - pA.x
        vy = pB.y - pA.y
        l2 = vx * vx + vy * vy
        t = 0.0 if l2 < 1e-8 else max(0.0, min(1.0, ((px - pA.x) * vx + (py - pA.y) * vy) / l2))
        cx = pA.x + t * vx
        cy = pA.y + t * vy
        d = math.hypot(px - cx, py - cy)
        if d < best_d:
            best_d = d
            best_z = pA.z + t * (pB.z - pA.z)
    return best_d, best_z


def smooth_spline_z(samples, closed=False, passes=160, pin_fn=None):
    """
    Smooth vertical elevation profile `pt.z` along a uniformly sampled spline while keeping XY
    untouched, eliminating vertical spline oscillation & grade slope creases (`d^2z/ds^2` kinks).
    """
    m = len(samples)
    if m < 5:
        return samples

    work_n = m - 1 if closed else m
    z = [samples[k][0].z for k in range(work_n)]
    pinned = [False] * work_n
    if not closed:
        pinned[0] = True
        pinned[work_n - 1] = True
    if pin_fn is not None:
        for k in range(work_n):
            if pin_fn(samples[k][0]):
                pinned[k] = True

    for _ in range(passes):
        nz = z[:]
        for k in range(work_n):
            if pinned[k]:
                continue
            if closed:
                z_prev = z[(k - 1) % work_n]
                z_next = z[(k + 1) % work_n]
            else:
                z_prev = z[k - 1]
                z_next = z[k + 1]
            nz[k] = 0.25 * z_prev + 0.5 * z[k] + 0.25 * z_next
        z = nz

    out = []
    for k in range(m):
        zk = z[0] if (closed and k == m - 1) else z[k]
        pt, tn = samples[k]
        out.append((Vector((pt.x, pt.y, zk)), tn))
    return out


def trim_branch_for_fillet(
    samples,
    start_parent,
    start_half_w,
    start_closed,
    end_parent,
    end_half_w,
    end_closed,
    fillet_dist=7.0,
    blend_max=38.0,
):
    """
    Trim the start and end of a branch road so its first cross-section ring stops cleanly
    at `start_half_w + fillet_dist` outside `start_parent` and its last ring stops at
    `end_half_w + fillet_dist` outside `end_parent`, and blend both 2D plan-view alignment
    and 3D elevation C2-smoothly into the perpendicular parent normal ray.
    """
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

    # Choose parent junction anchor between untrimmed endpoint and first trimmed sample
    # so even angled approaches center their apron cleanly without doglegs
    anchor_s = 0.35 * samples[0][0] + 0.65 * trimmed[0][0]
    k_s, _ = closest_sample_index(anchor_s, start_parent, closed=start_closed)
    p_s, tan_s = start_parent[k_s]
    right_s = Vector((tan_s.y, -tan_s.x, 0.0)).normalized()
    side_s = "right" if (trimmed[0][0] - p_s).dot(right_s) > 0.0 else "left"
    out_s = right_s if side_s == "right" else -right_s

    anchor_e = 0.35 * samples[-1][0] + 0.65 * trimmed[-1][0]
    k_e, _ = closest_sample_index(anchor_e, end_parent, closed=end_closed)
    p_e, tan_e = end_parent[k_e]
    right_e = Vector((tan_e.y, -tan_e.x, 0.0)).normalized()
    side_e = "right" if (trimmed[-1][0] - p_e).dot(right_e) > 0.0 else "left"
    out_e = right_e if side_e == "right" else -right_e

    m = len(trimmed)
    d_s = start_half_w + fillet_dist
    d_e = end_half_w + fillet_dist

    # Cumulative 2D arc-length along trimmed branch
    cum_s = [0.0] * m
    for k in range(1, m):
        cum_s[k] = cum_s[k - 1] + math.hypot(
            trimmed[k][0].x - trimmed[k - 1][0].x,
            trimmed[k][0].y - trimmed[k - 1][0].y,
        )
    total_len = max(1.0, cum_s[-1])
    frac = 0.42 if blend_max > 38.0 else 0.30
    blend_dist = min(blend_max, frac * total_len)

    # C2 quintic 3D (X, Y, Z) blend from perpendicular parent normal ray at start and end
    pts = [Vector(p) for p, _ in trimmed]
    for k in range(m):
        s_start = cum_s[k]
        if s_start < blend_dist:
            u = s_start / blend_dist
            w = u * u * u * (u * (u * 6.0 - 15.0) + 10.0)
            ray_pt = Vector((
                p_s.x + out_s.x * (d_s + s_start),
                p_s.y + out_s.y * (d_s + s_start),
                p_s.z,
            ))
            pts[k] = ray_pt.lerp(pts[k], w)

        s_end = total_len - cum_s[k]
        if s_end < blend_dist:
            u = s_end / blend_dist
            w = u * u * u * (u * (u * 6.0 - 15.0) + 10.0)
            ray_pt = Vector((
                p_e.x + out_e.x * (d_e + s_end),
                p_e.y + out_e.y * (d_e + s_end),
                p_e.z,
            ))
            pts[k] = ray_pt.lerp(pts[k], w)

    # Pin first 3 and last 3 rings strictly to parent Z and relax interior Z for C2 grade smoothness
    if m >= 8:
        for k in (0, 1, 2):
            pts[k].z = p_s.z
            pts[m - 1 - k].z = p_e.z
        for _ in range(32):
            new_z = [p.z for p in pts]
            for k in range(3, m - 3):
                new_z[k] = 0.25 * pts[k - 1].z + 0.50 * pts[k].z + 0.25 * pts[k + 1].z
            for k in range(3, m - 3):
                pts[k].z = new_z[k]

    # Recompute exact 2D unit tangents from the blended curve so cross-section rings are orthogonal
    rebuilt = []
    for k in range(m):
        if k == 0:
            tn = Vector((out_s.x, out_s.y, 0.0)).normalized()
        elif k == m - 1:
            tn = Vector((-out_e.x, -out_e.y, 0.0)).normalized()
        else:
            dv = pts[k + 1] - pts[k - 1]
            tn = Vector((dv.x, dv.y, 0.0))
            if tn.length > 1e-6:
                tn.normalize()
            else:
                tn = trimmed[k][1]
        rebuilt.append((pts[k], tn))

    return rebuilt, (k_s, side_s), (k_e, side_e)


def closest_point_on_polyline_3d(px, py, poly):
    best_d = 99999.0
    best_pt = Vector((px, py, 0.0))
    for i in range(len(poly) - 1):
        pA = poly[i][0]
        pB = poly[i + 1][0]
        vx = pB.x - pA.x
        vy = pB.y - pA.y
        l2 = vx * vx + vy * vy
        t = 0.0 if l2 < 1e-8 else max(0.0, min(1.0, ((px - pA.x) * vx + (py - pA.y) * vy) / l2))
        cx = pA.x + t * vx
        cy = pA.y + t * vy
        d = math.hypot(px - cx, py - cy)
        if d < best_d:
            best_d = d
            best_pt = Vector((cx, cy, pA.z + t * (pB.z - pA.z)))
    return best_pt


def snap_ctrl_endpoints_z(ctrl_pts, start_poly=None, end_poly=None):
    """Align first/last control point XYZ directly onto final smoothed parent splines."""
    if start_poly is not None:
        ctrl_pts[0] = closest_point_on_polyline_3d(ctrl_pts[0].x, ctrl_pts[0].y, start_poly)
    if end_poly is not None:
        ctrl_pts[-1] = closest_point_on_polyline_3d(ctrl_pts[-1].x, ctrl_pts[-1].y, end_poly)
    return ctrl_pts


def compute_road_network(step_len=2.5):
    """
    Computes all 11 interconnected road splines, trimmed branch geometry, junction anchor indices,
    elevated bridge spans, tunnel spans, and map landmark POIs.
    """
    z_passes = max(40, int(round(120.0 * (2.5 / max(0.5, step_len)) ** 1.6)))
    half_open_steps = max(2, int(round(10.0 / max(0.5, step_len))))

    # 1. HORIZON GRAND EXPRESSWAY (4-Lane Divided Highway Loop, closed=True)
    # Mixes high-speed festival launch straight with fast sweeping S-chicanes & coastal viaducts
    hwy_ctrl = [
        Vector((0.0, -210.0, 0.0)),
        Vector((0.0, -100.0, 0.0)),      # Junc: canyon_cut_end
        Vector((0.0, 0.0, 0.0)),         # Player spawn at (0, 0, 0) facing +Y (North)!
        Vector((0.0, 150.0, 0.0)),       # Passed OVER by overpass Bridge 1 (+15.6m)
        Vector((0.0, 265.0, 0.5)),       # Junc: valley_end
        Vector((18.0, 355.0, 4.5)),
        Vector((75.0, 445.0, 11.5)),     # Junc: touge_end
        Vector((155.0, 530.0, 18.5)),
        Vector((250.0, 580.0, 23.0)),    # Junc: hwy_west_end
        Vector((360.0, 592.0, 24.0)),    # Junc: river_run_end
        Vector((460.0, 578.0, 22.8)),    # Junc: hwy_north_start (wide unobstructed north exit!)
        Vector((565.0, 520.0, 19.8)),    # Junc: autumn_loop_start
        Vector((650.0, 435.0, 15.8)),    # Passed OVER by autumn_loop Overpass (+31.5m)
        Vector((718.0, 285.0, 11.5)),    # Junc: east_ridge_end
        Vector((742.0, 165.0, 11.5)),    # Smooth East Valley Sweeper
        Vector((710.0, 35.0, 10.8)),
        Vector((745.0, -75.0, 12.2)),    # Junc: volcano_ridge_start
        Vector((715.0, -195.0, 13.8)),   # Junc: overpass_end
        Vector((640.0, -330.0, 18.0)),   # Junc: east_ridge_start
        Vector((572.0, -430.0, 21.0)),   # Junc: island_causeway_end
        Vector((505.0, -502.0, 23.0)),   # Junc: coastal_loop_end
        Vector((380.0, -552.0, 25.5)),   # Grand Ocean Suspension Bridge East Tower
        Vector((190.0, -550.0, 25.0)),   # Grand Ocean Suspension Bridge West Tower
        Vector((55.0, -530.0, 18.8)),    # Junc: river_run_start
        Vector((-135.0, -495.0, 11.5)),  # Junc: coastal_loop_start
        Vector((-230.0, -405.0, 5.2)),   # Junc: hwy_west_start (relaxed SW sweeper)
        Vector((-182.0, -295.0, 2.8)),   # Smooth Southwest Return Sweeper
        Vector((-75.0, -265.0, 0.8)),
    ]
    hwy_raw = sample_smooth_3d_curve(hwy_ctrl, step_len=step_len, closed=True)
    hwy_raw = smooth_spline_z(
        hwy_raw,
        closed=True,
        passes=z_passes,
        pin_fn=lambda p: ((-12.0 <= p.x <= 12.0 and -215.0 <= p.y <= 155.0) or (215.0 <= p.x <= 360.0 and -590.0 <= p.y <= -510.0)),
    )

    # 2. WESTERN MESA EXPRESSWAY (4-Lane Divided Highway Spur, closed=False)
    hwy_west_ctrl = snap_ctrl_endpoints_z([
        Vector((-230.0, -405.0, 5.2)),
        Vector((-295.0, -412.0, 7.2)),
        Vector((-390.0, -412.0, 9.5)),   # Junc: meadow_cross_end
        Vector((-535.0, -368.0, 12.2)),  # Junc: west_mesa_rim_start
        Vector((-675.0, -295.0, 16.8)),
        Vector((-740.0, -195.0, 21.5)),  # Red-Rock Canyon Viaduct Bridge OVER canyon_cut (+6.0m -> 15.5m!)
        Vector((-775.0, -90.0, 17.5)),
        Vector((-768.0, -15.0, 15.0)),   # Junc: touge_start
        Vector((-738.0, 145.0, 17.5)),
        Vector((-778.0, 295.0, 21.0)),   # Junc: west_mesa_rim_end
        Vector((-695.0, 485.0, 26.5)),
        Vector((-545.0, 650.0, 29.0)),
        Vector((-465.0, 695.0, 30.2)),   # Junc: fjord_switchbacks_start (north side of alpine pass)
        Vector((-365.0, 745.0, 31.5)),   # Northern Alpine Pass Sweeper
        Vector((-175.0, 675.0, 27.0)),
        Vector((40.0, 725.0, 28.5)),     # Junc: alpine_fjord_link_start
        Vector((175.0, 700.0, 25.5)),
        Vector((220.0, 652.0, 24.0)),    # Smooth perpendicular approach to hwy (250, 580)
        Vector((250.0, 580.0, 23.0)),
    ], hwy_raw, hwy_raw)
    hwy_west_raw = sample_smooth_3d_curve(hwy_west_ctrl, step_len=step_len, closed=False)
    hwy_west_raw = smooth_spline_z(
        hwy_west_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-755.0 <= p.x <= -725.0 and -215.0 <= p.y <= -175.0),
    )
    hwy_west_trim, hw_s_info, hw_e_info = trim_branch_for_fillet(
        hwy_west_raw, hwy_raw, 7.6, True, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 3. ALPINE SUMMIT TOUGE & MOUNTAIN TUNNEL (2-Lane Secondary)
    touge_ctrl = snap_ctrl_endpoints_z((
        [
            Vector((-768.0, -15.0, 15.0)),
            Vector((-665.0, -32.0, 17.0)),
            Vector((-605.0, -26.0, 18.2)),
            Vector((-548.0, -12.0, 19.5)),  # Junc: overpass_start
        ]
        + arc_ctrl_pts(-516.0, 22.0, 32.0, -75.0, 80.0, 20.1, 21.8, count=5)
        + [Vector((-544.0, 54.0, 22.3))]
        + arc_ctrl_pts(-565.0, 92.0, 34.0, 250.0, 90.0, 22.8, 28.5, count=7)
        + [Vector((-510.0, 120.0, 29.8)), Vector((-485.0, 118.0, 30.8))]
        + arc_ctrl_pts(-445.0, 148.0, 32.0, -90.0, 90.0, 31.5, 37.5, count=7)
        + [Vector((-520.0, 182.0, 38.8)), Vector((-568.0, 184.0, 40.0))]
        + arc_ctrl_pts(-615.0, 214.0, 30.0, 270.0, 90.0, 40.8, 46.8, count=7)
        + [Vector((-520.0, 248.0, 48.2)), Vector((-465.0, 254.0, 49.6))]
        + arc_ctrl_pts(-410.0, 288.0, 34.0, -90.0, 90.0, 50.4, 56.5, count=7)
        + [Vector((-495.0, 326.0, 57.8)), Vector((-535.0, 332.0, 58.8))]
        + arc_ctrl_pts(-580.0, 364.0, 32.0, 270.0, 90.0, 59.5, 64.8, count=7)
        + [Vector((-505.0, 400.0, 65.8)), Vector((-452.0, 408.0, 66.8))]
        + arc_ctrl_pts(-395.0, 444.0, 34.0, -90.0, 90.0, 67.6, 70.8, count=7)
        + arc_ctrl_pts(-445.0, 520.0, 38.0, 270.0, 90.0, 71.5, 68.0, count=7)
        + [
            Vector((-365.0, 554.0, 65.2)),
            Vector((-265.0, 536.0, 62.5)),   # Alpine Tunnel West Portal
            Vector((-150.0, 538.0, 53.0)),   # Inside Alpine Summit Tunnel
            Vector((-40.0, 540.0, 42.5)),    # Alpine Tunnel East Portal
        ]
        + arc_ctrl_pts(22.0, 515.0, 38.0, 90.0, -90.0, 36.0, 29.0, count=7)
        + [Vector((-15.0, 480.0, 26.2))]
        + arc_ctrl_pts(-45.0, 448.0, 34.0, 90.0, 320.0, 23.0, 17.8, count=7)
        + arc_ctrl_pts(31.8, 425.4, 42.0, 138.0, 52.0, 15.8, 12.2, count=5)
        + [
            Vector((75.0, 445.0, 11.5)),
        ]
    ), hwy_west_trim, hwy_raw)
    touge_raw = sample_smooth_3d_curve(touge_ctrl, step_len=step_len, closed=False)
    touge_raw = smooth_spline_z(
        touge_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (
            (-490.0 <= p.x <= -455.0 and 505.0 <= p.y <= 535.0)
            or (-275.0 <= p.x <= -30.0 and 515.0 <= p.y <= 550.0)
        ),
    )
    touge_trim, touge_s_info, touge_e_info = trim_branch_for_fillet(
        touge_raw, hwy_west_trim, 7.6, False, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 4. CROSSTOWN SKYWAY TWIN-VIADUCT OVERPASS (2-Lane Secondary)
    overpass_ctrl = snap_ctrl_endpoints_z([
        Vector((-548.0, -12.0, 19.5)),
        Vector((-524.0, -54.0, 18.7)),   # Leaves touge perpendicularly SSE
        Vector((-478.0, -64.0, 18.0)),
        Vector((-415.0, -34.0, 17.5)),
        Vector((-325.0, 18.0, 16.8)),    # Underpass clearance OVER town_west_ave
        Vector((-195.0, 118.0, 16.5)),   # Underpass clearance OVER town_north_st
        Vector((-85.0, 148.0, 15.8)),
        Vector((0.0, 150.0, 15.6)),       # Overpass Bridge 1 OVER Main Highway (Z=0.0 -> 15.6m clearance!)
        Vector((135.0, 130.0, 14.0)),    # Junc: valley_start
        Vector((205.0, 50.0, 15.5)),     # Junc: emerald_bypass_start
        Vector((265.0, -35.0, 18.5)),
        Vector((365.0, -80.0, 21.0)),    # Overpass Bridge 2 OVER River Gorge & River Run (Z=2.5m -> 18.5m!)
        Vector((485.0, -108.0, 16.5)),
        Vector((572.0, -196.0, 14.5)),
        Vector((652.0, -172.0, 14.0)),
        Vector((715.0, -195.0, 13.8)),
    ], touge_trim, hwy_raw)
    overpass_raw = sample_smooth_3d_curve(overpass_ctrl, step_len=step_len, closed=False)
    overpass_raw = smooth_spline_z(
        overpass_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (
            (-345.0 <= p.x <= -165.0 and 0.0 <= p.y <= 135.0)
            or (-15.0 <= p.x <= 15.0 and 138.0 <= p.y <= 162.0)
            or (345.0 <= p.x <= 385.0 and -95.0 <= p.y <= -65.0)
        ),
    )
    overpass_trim, over_s_info, over_e_info = trim_branch_for_fillet(
        overpass_raw, touge_trim, 5.4, False, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 5. EMERALD RIVER CANYON & LAKEFRONT RUN (2-Lane Secondary)
    river_run_ctrl = snap_ctrl_endpoints_z([
        Vector((55.0, -530.0, 18.8)),
        Vector((68.0, -472.0, 15.2)),    # Smooth perpendicular takeoff off hwy
        Vector((115.0, -425.0, 11.4)),
        Vector((148.0, -385.0, 7.8)),
        Vector((190.0, -345.0, 4.5)),    # Junc: emerald_bypass_end
        Vector((248.0, -210.0, 2.4)),
        Vector((365.0, -80.0, 2.5)),     # Drives UNDER Overpass Bridge 2 (+21.0m vs +2.5m!)
        Vector((352.0, 62.0, 3.4)),      # Lakeside Drift S-Chicane
        Vector((438.0, 165.0, 4.6)),
        Vector((442.0, 275.0, 5.8)),     # Junc: autumn_loop_end
        Vector((392.0, 415.0, 12.8)),
        Vector((412.0, 488.0, 18.2)),
        Vector((368.0, 538.0, 21.4)),
        Vector((360.0, 592.0, 24.0)),
    ], hwy_raw, hwy_raw)
    river_run_raw = sample_smooth_3d_curve(river_run_ctrl, step_len=step_len, closed=False)
    river_run_raw = smooth_spline_z(
        river_run_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (350.0 <= p.x <= 380.0 and -95.0 <= p.y <= -65.0),
    )
    river_run_trim, riv_s_info, riv_e_info = trim_branch_for_fillet(
        river_run_raw, hwy_raw, 7.6, True, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 6. GOLDEN BAY & PALM PENINSULA COASTAL LOOP (2-Lane Secondary)
    coastal_ctrl = snap_ctrl_endpoints_z((
        [
            Vector((-135.0, -495.0, 11.5)),
            Vector((-175.0, -545.0, 7.5)),   # Smooth Western Cove Bluff Descent
            Vector((-168.0, -610.0, 4.8)),
            Vector((-178.0, -660.0, 3.3)),
            Vector((-208.0, -682.0, 2.5)),
        ]
        + arc_ctrl_pts(-196.0, -722.0, 38.0, 145.0, 270.0, 2.2, 2.0, count=6)
        + [
            Vector((-125.0, -762.0, 2.0)),
            Vector((-45.0, -740.0, 2.0)),    # Junc: island_causeway_start
            Vector((115.0, -702.0, 2.0)),    # Harbor Lagoon Chicane
            Vector((275.0, -752.0, 2.2)),
            Vector((455.0, -705.0, 5.4)),
            Vector((545.0, -662.0, 10.4)),   # Smooth Palm Peninsula Hairpin Climb
            Vector((578.0, -612.0, 14.6)),
            Vector((555.0, -562.0, 18.2)),
            Vector((538.0, -532.0, 21.0)),
            Vector((505.0, -502.0, 23.0)),
        ]
    ), hwy_raw, hwy_raw)
    coastal_raw = sample_smooth_3d_curve(coastal_ctrl, step_len=step_len, closed=False)
    coastal_raw = smooth_spline_z(coastal_raw, closed=False, passes=z_passes)
    coastal_trim, coast_s_info, coast_e_info = trim_branch_for_fillet(
        coastal_raw, hwy_raw, 7.6, True, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 7. EASTERN CLIFFSIDE SKYBRIDGE VIADUCT (Skinny Technical Ridge Backroad)
    east_ridge_ctrl = snap_ctrl_endpoints_z((
        [
            Vector((640.0, -330.0, 18.0)),   # Smoothly North of island_causeway_end (572, -430)
            Vector((695.0, -385.0, 20.5)),
            Vector((758.0, -408.0, 22.6)),
        ]
        + arc_ctrl_pts(782.0, -376.0, 34.0, -90.0, 90.0, 23.2, 27.0, count=7)
        + [Vector((752.0, -340.0, 28.0))]
        + arc_ctrl_pts(735.0, -306.0, 34.0, 270.0, 90.0, 28.6, 32.2, count=7)
        + [
            Vector((810.0, -268.0, 35.4)),
            Vector((855.0, -175.0, 46.5)),   # Elevated Cliffside Viaduct South Overlook
            Vector((838.0, -25.0, 51.0)),    # Highest Eastern Cliff Escarpment (+51.0m!)
            Vector((852.0, 125.0, 47.5)),    # Overlooking the Giant Emerald Reservoir Lake
            Vector((822.0, 240.0, 31.5)),
            Vector((780.0, 285.0, 25.0)),    # Smooth Northern Cliff Descent
            Vector((718.0, 285.0, 11.5)),
        ]
    ), hwy_raw, hwy_raw)
    east_ridge_raw = sample_smooth_3d_curve(east_ridge_ctrl, step_len=step_len, closed=False)
    east_ridge_raw = smooth_spline_z(
        east_ridge_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (800.0 <= p.x <= 885.0 and -240.0 <= p.y <= 165.0),
    )
    east_ridge_trim, er_s_info, er_e_info = trim_branch_for_fillet(
        east_ridge_raw, hwy_raw, 7.6, True, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 8. FESTIVAL MEADOW INTERCHANGE CONNECTOR (2-Lane Secondary)
    valley_ctrl = snap_ctrl_endpoints_z([
        Vector((135.0, 130.0, 14.0)),
        Vector((148.0, 182.0, 10.2)),
        Vector((118.0, 218.0, 7.0)),     # Smooth Interchange Sweeper
        Vector((78.0, 245.0, 4.0)),
        Vector((42.0, 262.0, 1.8)),
        Vector((0.0, 265.0, 0.5)),
    ], overpass_trim, hwy_raw)
    valley_raw = sample_smooth_3d_curve(valley_ctrl, step_len=step_len, closed=False)
    valley_raw = smooth_spline_z(valley_raw, closed=False, passes=z_passes)
    valley_trim, val_s_info, val_e_info = trim_branch_for_fillet(
        valley_raw, overpass_trim, 5.4, False, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 9. RED-ROCK CANYON TECHNICAL GORGE (Skinny Technical Road, passes UNDER hwy_west!)
    canyon_cut_ctrl = [
        Vector((-845.0, -205.0, 10.5)),  # Leaves west_mesa_rim ('right')
        Vector((-740.0, -195.0, 6.0)),   # Passes UNDERNEATH hwy_west Red-Rock Viaduct (+21.5m -> 15.5m gap!)
        Vector((-628.0, -172.0, 6.5)),
        Vector((-545.0, -132.0, 6.2)),   # Smooth Canyon Snake S-Curves
        Vector((-442.0, -190.0, 5.5)),
        Vector((-335.0, -120.0, 3.8)),   # Junc: meadow_cross_start
        Vector((-208.0, -172.0, 2.2)),
        Vector((-102.0, -104.0, 0.6)),
        Vector((0.0, -100.0, 0.0)),
    ]

    # 10. WESTERN DESERT MESA & BLUFF RIM (2-Lane Secondary)
    west_mesa_ctrl = snap_ctrl_endpoints_z([
        Vector((-535.0, -368.0, 12.2)),
        Vector((-595.0, -455.0, 14.5)),
        Vector((-745.0, -478.0, 16.5)),  # Junc: badlands_loop_start
        Vector((-825.0, -455.0, 14.4)),
        Vector((-855.0, -365.0, 13.5)),
        Vector((-845.0, -205.0, 10.5)),  # Junc: canyon_cut_start
        Vector((-865.0, -65.0, 19.5)),   # Junc: mesa_canyon_link_start
        Vector((-818.0, 105.0, 24.5)),   # Junc: north_badlands_spur_start
        Vector((-865.0, 222.0, 25.2)),   # High Desert Mesa Overlook (+25.2m) / hwy_north_end
        Vector((-844.0, 282.0, 22.8)),   # Smooth northern return to hwy_west (no wiggle!)
        Vector((-778.0, 295.0, 21.0)),
    ], hwy_west_trim, hwy_west_trim)
    west_mesa_raw = sample_smooth_3d_curve(west_mesa_ctrl, step_len=step_len, closed=False)
    west_mesa_raw = smooth_spline_z(west_mesa_raw, closed=False, passes=z_passes)
    west_mesa_trim, wm_s_info, wm_e_info = trim_branch_for_fillet(
        west_mesa_raw, hwy_west_trim, 7.6, False, hwy_west_trim, 7.6, False, fillet_dist=7.0
    )

    canyon_cut_ctrl = snap_ctrl_endpoints_z(canyon_cut_ctrl, west_mesa_trim, hwy_raw)
    canyon_cut_raw = sample_smooth_3d_curve(canyon_cut_ctrl, step_len=step_len, closed=False)
    canyon_cut_raw = smooth_spline_z(
        canyon_cut_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-755.0 <= p.x <= -725.0 and -215.0 <= p.y <= -175.0),
    )
    canyon_cut_trim, cc_s_info, cc_e_info = trim_branch_for_fillet(
        canyon_cut_raw, west_mesa_trim, 5.4, False, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 11. AUTUMN HIGHLAND SKYBRIDGE LOOP (Skinny Technical Road crossing OVER hwy!)
    autumn_loop_ctrl = snap_ctrl_endpoints_z([
        Vector((565.0, 520.0, 19.8)),    # Clean NE takeoff east of hwy_north (460, 578)
        Vector((608.0, 575.0, 24.5)),
        Vector((650.0, 660.0, 34.0)),
        Vector((735.0, 682.0, 39.5)),    # Junc: autumn_crest_loop_start
        Vector((775.0, 615.0, 38.5)),
        Vector((738.0, 525.0, 35.5)),
        Vector((692.0, 472.0, 34.2)),
        Vector((650.0, 435.0, 33.0)),    # Elevated Autumn Overpass Bridge OVER hwy (+15.8m -> 17.2m gap!)
        Vector((582.0, 358.0, 22.2)),
        Vector((548.0, 295.0, 13.5)),
        Vector((492.0, 282.0, 8.2)),
        Vector((442.0, 275.0, 5.8)),
    ], hwy_raw, river_run_trim)
    autumn_loop_raw = sample_smooth_3d_curve(autumn_loop_ctrl, step_len=step_len, closed=False)
    autumn_loop_raw = smooth_spline_z(
        autumn_loop_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (620.0 <= p.x <= 680.0 and 405.0 <= p.y <= 465.0),
    )
    autumn_loop_trim, aut_s_info, aut_e_info = trim_branch_for_fillet(
        autumn_loop_raw, hwy_raw, 7.6, True, river_run_trim, 5.4, False, fillet_dist=7.0
    )

    # 12. NORTHERN TRANS-ALPINE EXPRESSWAY (4-Lane Highway + Glacial Fjord Bridge)
    hwy_north_ctrl = snap_ctrl_endpoints_z([
        Vector((460.0, 578.0, 22.8)),    # Unobstructed perpendicular north exit off hwy!
        Vector((476.0, 675.0, 25.5)),
        Vector((465.0, 800.0, 30.5)),    # Junc: autumn_crest_loop_end (well south of alpine_fjord_link)
        Vector((355.0, 995.0, 26.5)),
        Vector((145.0, 1042.0, 23.0)),   # Northern Glacial Fjord Bridge (over water!)
        Vector((-125.0, 1045.0, 23.0)),
        Vector((-295.0, 1032.0, 24.5)),  # Junc: fjord_switchbacks_end
        Vector((-430.0, 1015.0, 26.5)),
        Vector((-675.0, 962.0, 31.0)),   # High-speed alpine sweeping bend
        Vector((-915.0, 855.0, 34.5)),
        Vector((-1085.0, 635.0, 30.5)),  # Junc: badlands_loop_end (NW Outer Rim)
        Vector((-1065.0, 415.0, 26.0)),
        Vector((-1018.0, 285.0, 24.5)),  # Wide sweeping curve straight into west_mesa_rim
        Vector((-945.0, 222.0, 24.8)),
        Vector((-865.0, 222.0, 25.2)),   # Joins west_mesa_rim perpendicularly at High Desert Overlook
    ], hwy_raw, west_mesa_trim)
    hwy_north_raw = sample_smooth_3d_curve(hwy_north_ctrl, step_len=step_len, closed=False)
    hwy_north_raw = smooth_spline_z(
        hwy_north_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-240.0 <= p.x <= 240.0 and 970.0 <= p.y <= 1110.0),
    )
    hwy_north_trim, hn_s_info, hn_e_info = trim_branch_for_fillet(
        hwy_north_raw, hwy_raw, 7.6, True, west_mesa_trim, 5.4, False, fillet_dist=7.0
    )

    # 13. OBSIDIAN VOLCANIC CALDERA PASS (Narrow 2-Lane Technical Rim & Smooth Hairpins)
    volcano_ctrl = snap_ctrl_endpoints_z((
        [
            Vector((745.0, -75.0, 12.2)),    # Clean east takeoff off hwy (normal points ENE)
            Vector((815.0, -48.0, 21.0)),    # Passes cleanly UNDER East Ridge Viaduct (+50.5m vs +23m!)
            Vector((945.0, -90.0, 33.5)),
            Vector((1050.0, -165.0, 41.5)),  # Junc: caldera_inner_rim_start
            Vector((1115.0, -188.0, 44.5)),
        ]
        + arc_ctrl_pts(1172.0, -146.0, 40.0, -100.0, -12.0, 45.5, 51.0, count=7)
        + [
            Vector((1245.0, -35.0, 53.5)),
            Vector((1285.0, 105.0, 57.5)),   # Volcanic Caldera East Rim Crest (+57.5m!)
            Vector((1245.0, 255.0, 54.0)),
        ]
        + arc_ctrl_pts(1165.0, 310.0, 42.0, 20.0, 95.0, 51.5, 46.5, count=7)
        + [
            Vector((1035.0, 355.0, 40.5)),   # Junc: caldera_inner_rim_end
            Vector((915.0, 395.0, 32.0)),    # Geothermal Ash Valley Descent
            Vector((790.0, 402.0, 23.0)),
            Vector((688.0, 360.0, 14.5)),    # Clean perpendicular approach north of east_ridge_end (718, 285)
        ]
    ), hwy_raw, hwy_raw)
    volcano_raw = sample_smooth_3d_curve(volcano_ctrl, step_len=step_len, closed=False)
    volcano_raw = smooth_spline_z(volcano_raw, closed=False, passes=z_passes)
    volcano_trim, vol_s_info, vol_e_info = trim_branch_for_fillet(
        volcano_raw, hwy_raw, 7.6, True, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 14. PAINTED BADLANDS SCENIC RUN (2-Lane Desert Canyon & Broad Mesas)
    badlands_ctrl = snap_ctrl_endpoints_z([
        Vector((-745.0, -478.0, 16.5)),  # Clean perpendicular takeoff south off west_mesa_rim!
        Vector((-785.0, -552.0, 19.5)),
        Vector((-985.0, -572.0, 24.0)),
        Vector((-1205.0, -455.0, 28.0)),
        Vector((-1290.0, -265.0, 32.5)), # Outer Monument Butte Sweeper
        Vector((-1248.0, -90.0, 34.5)),  # Junc: mesa_canyon_link_end (wide smooth S-sweep!)
        Vector((-1195.0, 45.0, 36.0)),
        Vector((-1255.0, 205.0, 34.0)),  # Junc: north_badlands_spur_end
        Vector((-1278.0, 355.0, 32.0)),  # Painted Sandstone Mesa North Sweeper
        Vector((-1235.0, 520.0, 30.0)),
        Vector((-1175.0, 642.0, 30.0)),  # Smooth WNW perpendicular approach to hwy_north (-1085, 635)
        Vector((-1085.0, 635.0, 30.5)),
    ], west_mesa_trim, hwy_north_trim)
    badlands_raw = sample_smooth_3d_curve(badlands_ctrl, step_len=step_len, closed=False)
    badlands_raw = smooth_spline_z(badlands_raw, closed=False, passes=z_passes)
    badlands_trim, bad_s_info, bad_e_info = trim_branch_for_fillet(
        badlands_raw, west_mesa_trim, 5.4, False, hwy_north_trim, 7.6, False, fillet_dist=7.0
    )

    # 15. TROPICAL ARCHIPELAGO CAUSEWAY (4-Lane Ocean Causeway Bridge & Barrier Islands)
    island_ctrl = snap_ctrl_endpoints_z([
        Vector((-45.0, -740.0, 2.0)),    # Clean perpendicular SSE exit off coastal_loop beach
        Vector((-14.0, -845.0, 6.5)),
        Vector((25.0, -990.0, 10.5)),    # Southern Ocean Causeway Bridge West Span
        Vector((215.0, -1082.0, 10.5)),
        Vector((535.0, -1036.0, 11.2)),  # Tropical Barrier Island 1 (+12m) / island_harbor_loop_start
        Vector((735.0, -945.0, 12.5)),   # Tropical Barrier Island 2
        Vector((875.0, -755.0, 14.0)),   # Junc: island_harbor_loop_end
        Vector((865.0, -565.0, 17.0)),   # Eastern Tropical Peninsula Climb (stays clear south of east_ridge!)
        Vector((725.0, -495.0, 19.5)),
        Vector((625.0, -468.0, 20.5)),
        Vector((572.0, -430.0, 21.0)),   # Clean perpendicular join into hwy south of east_ridge_start
    ], coastal_trim, hwy_raw)
    island_raw = sample_smooth_3d_curve(island_ctrl, step_len=step_len, closed=False)
    island_raw = smooth_spline_z(
        island_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-65.0 <= p.x <= 465.0 and -1140.0 <= p.y <= -930.0),
    )
    island_trim, isl_s_info, isl_e_info = trim_branch_for_fillet(
        island_raw, coastal_trim, 5.4, False, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 16. GLACIAL FJORD SWITCHBACKS (Narrow 2-Lane Alpine Staircase on North Face!)
    fjord_ctrl = snap_ctrl_endpoints_z((
        [
            Vector((-465.0, 695.0, 30.2)),  # Branches cleanly NORTH off hwy_west Alpine Pass
            Vector((-484.0, 764.0, 33.0)),
            Vector((-435.0, 808.0, 31.5)),
            Vector((-365.0, 812.0, 30.0)),
        ]
        + arc_ctrl_pts(-310.0, 846.0, 34.0, -90.0, 90.0, 29.0, 25.0, count=7)
        + [
            Vector((-385.0, 880.0, 23.5)),
        ]
        + arc_ctrl_pts(-450.0, 914.0, 34.0, 270.0, 90.0, 22.0, 19.5, count=7)
        + [
            Vector((-345.0, 952.0, 20.5)),
            Vector((-295.0, 980.0, 22.5)),
            Vector((-295.0, 1032.0, 24.5)), # Clean perpendicular join into hwy_north west of Fjord Bridge!
        ]
    ), hwy_west_trim, hwy_north_trim)
    fjord_raw = sample_smooth_3d_curve(fjord_ctrl, step_len=step_len, closed=False)
    fjord_raw = smooth_spline_z(fjord_raw, closed=False, passes=z_passes)
    fjord_trim, fjd_s_info, fjd_e_info = trim_branch_for_fillet(
        fjord_raw, hwy_west_trim, 7.6, False, hwy_north_trim, 7.6, False, fillet_dist=7.0
    )

    # 17. MEADOW CROSS COUNTRY LANE (Narrow 2-Lane SW Starter Meadow Connector)
    meadow_ctrl = snap_ctrl_endpoints_z([
        Vector((-335.0, -120.0, 3.8)),
        Vector((-342.0, -210.0, 5.2)),
        Vector((-368.0, -315.0, 7.2)),
        Vector((-390.0, -412.0, 9.5)),
    ], canyon_cut_trim, hwy_west_trim)
    meadow_raw = sample_smooth_3d_curve(meadow_ctrl, step_len=step_len, closed=False)
    meadow_raw = smooth_spline_z(meadow_raw, closed=False, passes=z_passes)
    meadow_trim, mdw_s_info, mdw_e_info = trim_branch_for_fillet(
        meadow_raw, canyon_cut_trim, 5.4, False, hwy_west_trim, 7.6, False, fillet_dist=7.0
    )

    # 18. EMERALD VALLEY TRIANGLE BYPASS (2-Lane Secondary Interior Connector)
    emerald_bypass_ctrl = snap_ctrl_endpoints_z([
        Vector((205.0, 50.0, 15.5)),
        Vector((166.0, 16.0, 12.2)),
        Vector((136.0, -110.0, 8.2)),
        Vector((132.0, -250.0, 6.0)),
        Vector((152.0, -312.0, 5.0)),
        Vector((190.0, -345.0, 4.5)),
    ], overpass_trim, river_run_trim)
    emerald_bypass_raw = sample_smooth_3d_curve(emerald_bypass_ctrl, step_len=step_len, closed=False)
    emerald_bypass_raw = smooth_spline_z(emerald_bypass_raw, closed=False, passes=z_passes)
    emerald_bypass_trim, emb_s_info, emb_e_info = trim_branch_for_fillet(
        emerald_bypass_raw, overpass_trim, 5.4, False, river_run_trim, 5.4, False, fillet_dist=7.0
    )

    # 19. AUTUMN CREST RIDGE LOOP (Narrow 2-Lane NE Highlands Sub-Loop)
    autumn_crest_ctrl = snap_ctrl_endpoints_z([
        Vector((735.0, 682.0, 39.5)),
        Vector((755.0, 755.0, 37.5)),
        Vector((680.0, 815.0, 34.5)),
        Vector((565.0, 795.0, 31.8)),
        Vector((465.0, 770.0, 29.0)),
    ], autumn_loop_trim, hwy_north_trim)
    autumn_crest_raw = sample_smooth_3d_curve(autumn_crest_ctrl, step_len=step_len, closed=False)
    autumn_crest_raw = smooth_spline_z(autumn_crest_raw, closed=False, passes=z_passes)
    autumn_crest_trim, acr_s_info, acr_e_info = trim_branch_for_fillet(
        autumn_crest_raw, autumn_loop_trim, 5.4, False, hwy_north_trim, 7.6, False, fillet_dist=7.0
    )

    # 20. CALDERA INNER CRATER SHELF (Narrow 2-Lane Inner Volcano Cut-Through)
    caldera_inner_ctrl = snap_ctrl_endpoints_z([
        Vector((1050.0, -165.0, 41.5)),
        Vector((1078.0, -95.0, 40.0)),
        Vector((1058.0, 45.0, 41.0)),
        Vector((1028.0, 195.0, 40.5)),
        Vector((1035.0, 355.0, 40.5)),
    ], volcano_trim, volcano_trim)
    caldera_inner_raw = sample_smooth_3d_curve(caldera_inner_ctrl, step_len=step_len, closed=False)
    caldera_inner_raw = smooth_spline_z(caldera_inner_raw, closed=False, passes=z_passes)
    caldera_inner_trim, cin_s_info, cin_e_info = trim_branch_for_fillet(
        caldera_inner_raw, volcano_trim, 5.4, False, volcano_trim, 5.4, False, fillet_dist=7.0
    )

    # 21. MESA CANYON CROSS-LINK (Narrow 2-Lane Central Painted Badlands Connector)
    mesa_canyon_ctrl = snap_ctrl_endpoints_z([
        Vector((-865.0, -65.0, 19.5)),
        Vector((-965.0, -82.0, 23.0)),
        Vector((-1115.0, -92.0, 28.5)),
        Vector((-1248.0, -90.0, 34.5)),
    ], west_mesa_trim, badlands_trim)
    mesa_canyon_raw = sample_smooth_3d_curve(mesa_canyon_ctrl, step_len=step_len, closed=False)
    mesa_canyon_raw = smooth_spline_z(mesa_canyon_raw, closed=False, passes=z_passes)
    mesa_canyon_trim, mcl_s_info, mcl_e_info = trim_branch_for_fillet(
        mesa_canyon_raw, west_mesa_trim, 5.4, False, badlands_trim, 5.4, False, fillet_dist=7.0
    )

    # 22. NORTH BADLANDS MESA SPUR (Narrow 2-Lane NW Sandstone Plateau Shortcut)
    north_badlands_ctrl = snap_ctrl_endpoints_z([
        Vector((-818.0, 105.0, 24.5)),
        Vector((-945.0, 138.0, 28.0)),
        Vector((-1105.0, 185.0, 31.5)),
        Vector((-1255.0, 205.0, 34.0)),
    ], west_mesa_trim, badlands_trim)
    north_badlands_raw = sample_smooth_3d_curve(north_badlands_ctrl, step_len=step_len, closed=False)
    north_badlands_raw = smooth_spline_z(north_badlands_raw, closed=False, passes=z_passes)
    north_badlands_trim, nbs_s_info, nbs_e_info = trim_branch_for_fillet(
        north_badlands_raw, west_mesa_trim, 5.4, False, badlands_trim, 5.4, False, fillet_dist=7.0
    )

    # 23. TROPICAL ISLAND HARBOR LOOP (Narrow 2-Lane Barrier Island Cove Circuit)
    island_harbor_ctrl = snap_ctrl_endpoints_z([
        Vector((535.0, -1036.0, 11.2)),
        Vector((568.0, -1095.0, 9.5)),
        Vector((710.0, -1080.0, 8.5)),
        Vector((845.0, -985.0, 10.5)),
        Vector((920.0, -875.0, 12.2)),
        Vector((932.0, -792.0, 13.5)),
        Vector((875.0, -755.0, 14.0)),
    ], island_trim, island_trim)
    island_harbor_raw = sample_smooth_3d_curve(island_harbor_ctrl, step_len=step_len, closed=False)
    island_harbor_raw = smooth_spline_z(island_harbor_raw, closed=False, passes=z_passes)
    island_harbor_trim, ihl_s_info, ihl_e_info = trim_branch_for_fillet(
        island_harbor_raw, island_trim, 7.6, False, island_trim, 7.6, False, fillet_dist=7.0
    )

    # 24. ALPINE FJORD PINE LINK (Narrow 2-Lane North-Central Snow Valley Loop)
    alpine_fjord_ctrl = snap_ctrl_endpoints_z([
        Vector((40.0, 725.0, 28.5)),
        Vector((45.0, 795.0, 31.2)),
        Vector((118.0, 872.0, 32.5)),
        Vector((235.0, 902.0, 31.8)),
        Vector((338.0, 922.0, 29.8)),
        Vector((385.0, 962.0, 28.0)),
    ], hwy_west_trim, hwy_north_trim)
    alpine_fjord_raw = sample_smooth_3d_curve(alpine_fjord_ctrl, step_len=step_len, closed=False)
    alpine_fjord_raw = smooth_spline_z(alpine_fjord_raw, closed=False, passes=z_passes)
    alpine_fjord_trim, afl_s_info, afl_e_info = trim_branch_for_fillet(
        alpine_fjord_raw, hwy_west_trim, 7.6, False, hwy_north_trim, 7.6, False, fillet_dist=7.0
    )

    # =========================================================================
    # EXPANSION PHASE 2: INTERLOCKING TOWN STREETS, 4-WAY INTERSECTIONS,
    # ROUNDABOUTS, OUTER FRONTIER HIGHWAYS, OVERPASSES & ISLAND ATOLLS (#25-#50)
    # =========================================================================

    # 25. HORIZON MIDTOWN PLAZA ROUNDABOUT (Closed 2-Lane Traffic Circle!)
    town_rb_ctrl = roundabout_ctrl_pts(-185.0, -45.0, 48.0, 1.8, count=12)
    town_rb_raw = sample_smooth_3d_curve(town_rb_ctrl, step_len=step_len, closed=True)
    town_rb_raw = smooth_spline_z(town_rb_raw, closed=True, passes=z_passes)

    # 26. TOWN EAST AVENUE (Connects Midtown Roundabout East -> 4-Way Cross @ hwy (0, 72))
    town_east_ctrl = snap_ctrl_endpoints_z([
        Vector((-137.0, -45.0, 1.8)),
        Vector((-78.0, -43.0, 1.3)),
        Vector((-61.0, -14.0, 0.9)),
        Vector((-64.0, 28.0, 0.55)),
        Vector((-48.0, 64.0, 0.15)),
        Vector((0.0, 72.0, 0.0)),
    ], town_rb_raw, hwy_raw)
    town_east_raw = sample_smooth_3d_curve(town_east_ctrl, step_len=step_len, closed=False)
    town_east_raw = smooth_spline_z(town_east_raw, closed=False, passes=z_passes)
    town_east_trim, tea_s_info, tea_e_info = trim_branch_for_fillet(
        town_east_raw, town_rb_raw, 5.4, True, hwy_raw, 7.6, True, fillet_dist=7.0, blend_max=45.0
    )

    # 27. PADDOCK EAST AVENUE (Opposite 4-Way Cross @ hwy (0, 72) -> 4-Way @ emerald_bypass (144.2, -55.4))
    paddock_east_ctrl = snap_ctrl_endpoints_z([
        Vector((0.0, 72.0, 0.0)),
        Vector((46.0, 72.0, 0.5)),
        Vector((76.0, 44.0, 2.8)),
        Vector((78.0, -6.0, 6.4)),
        Vector((104.0, -44.0, 8.9)),
        Vector((144.2, -55.4, 9.6)),
    ], hwy_raw, emerald_bypass_trim)
    paddock_east_raw = sample_smooth_3d_curve(paddock_east_ctrl, step_len=step_len, closed=False)
    paddock_east_raw = smooth_spline_z(paddock_east_raw, closed=False, passes=z_passes)
    paddock_east_trim, pea_s_info, pea_e_info = trim_branch_for_fillet(
        paddock_east_raw, hwy_raw, 7.6, True, emerald_bypass_trim, 5.4, False, fillet_dist=7.0, blend_max=68.0
    )

    # 28. RIVER GORGE LINK (Opposite 4-Way @ emerald_bypass (144.2, -55.4) -> river_run)
    river_gorge_link_ctrl = snap_ctrl_endpoints_z([
        Vector((144.2, -55.4, 9.6)),
        Vector((186.0, -63.0, 7.8)),
        Vector((206.0, -92.0, 5.8)),
        Vector((204.0, -142.0, 4.0)),
        Vector((210.0, -184.0, 3.0)),
        Vector((242.7, -218.9, 2.5)),
    ], emerald_bypass_trim, river_run_trim)
    river_gorge_link_raw = sample_smooth_3d_curve(river_gorge_link_ctrl, step_len=step_len, closed=False)
    river_gorge_link_raw = smooth_spline_z(river_gorge_link_raw, closed=False, passes=z_passes)
    river_gorge_link_trim, rgl_s_info, rgl_e_info = trim_branch_for_fillet(
        river_gorge_link_raw, emerald_bypass_trim, 5.4, False, river_run_trim, 5.4, False, fillet_dist=7.0, blend_max=58.0
    )

    # 29. TOWN NORTH STREET (Ducks UNDER overpass @ (-190, 118) -> 4-Way Cross @ hwy (0, 265))
    town_north_ctrl = snap_ctrl_endpoints_z([
        Vector((-185.0, 3.0, 1.8)),
        Vector((-188.0, 52.0, 1.0)),
        Vector((-190.0, 118.0, 0.8)),   # Passes cleanly UNDERNEATH overpass (Z=16.5 -> 15.7m gap!)
        Vector((-186.0, 185.0, 0.8)),
        Vector((-158.0, 245.0, 0.8)),
        Vector((-95.0, 265.0, 0.6)),
        Vector((-30.0, 265.0, 0.5)),
        Vector((0.0, 265.0, 0.5)),      # Opposite valley_end -> 4-Way Cross @ hwy!
    ], town_rb_raw, hwy_raw)
    town_north_raw = sample_smooth_3d_curve(town_north_ctrl, step_len=step_len, closed=False)
    town_north_raw = smooth_spline_z(
        town_north_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-225.0 <= p.x <= -155.0 and 85.0 <= p.y <= 155.0),
    )
    town_north_trim, tns_s_info, tns_e_info = trim_branch_for_fillet(
        town_north_raw, town_rb_raw, 5.4, True, hwy_raw, 7.6, True, fillet_dist=7.0, blend_max=68.0
    )

    # 30. TOWN SOUTH STREET (Midtown Roundabout SSW -> 4-Way Cross @ canyon_cut (-200.3, -170.6))
    town_south_ctrl = snap_ctrl_endpoints_z([
        Vector((-200.0, -90.6, 1.8)),
        Vector((-204.0, -132.0, 1.9)),
        Vector((-200.3, -170.6, 2.1)),
    ], town_rb_raw, canyon_cut_trim)
    town_south_raw = sample_smooth_3d_curve(town_south_ctrl, step_len=step_len, closed=False)
    town_south_raw = smooth_spline_z(town_south_raw, closed=False, passes=z_passes)
    town_south_trim, tss_s_info, tss_e_info = trim_branch_for_fillet(
        town_south_raw, town_rb_raw, 5.4, True, canyon_cut_trim, 5.4, False, fillet_dist=7.0, blend_max=68.0
    )

    # 31. SOUTH MEADOW LANE (Opposite 4-Way @ canyon_cut -> Overpass Bridge OVER hwy (-165, -285) -> 4-Way @ hwy (-137.7, -493.6))
    south_meadow_ctrl = snap_ctrl_endpoints_z([
        Vector((-200.3, -170.6, 2.1)),
        Vector((-186.0, -218.0, 8.8)),
        Vector((-165.3, -285.3, 19.0)),  # Overpass Bridge OVER hwy (Z=2.4 -> +16.6m clearance!)
        Vector((-125.0, -365.0, 13.5)),
        Vector((-108.0, -430.0, 11.8)),
        Vector((-137.7, -493.6, 11.3)),  # Opposite coastal_loop_start -> 4-Way Cross @ hwy!
    ], canyon_cut_trim, hwy_raw)
    south_meadow_raw = sample_smooth_3d_curve(south_meadow_ctrl, step_len=step_len, closed=False)
    south_meadow_raw = smooth_spline_z(
        south_meadow_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-200.0 <= p.x <= -130.0 and -325.0 <= p.y <= -245.0),
    )
    south_meadow_trim, sml_s_info, sml_e_info = trim_branch_for_fillet(
        south_meadow_raw, canyon_cut_trim, 5.4, False, hwy_raw, 7.6, True, fillet_dist=7.0, blend_max=72.0
    )

    # 32. TOWN WEST LOOP (Midtown Roundabout West -> ducks UNDER overpass @ (-325, 18) -> town_north_st)
    town_west_ctrl = snap_ctrl_endpoints_z([
        Vector((-233.0, -45.0, 1.8)),
        Vector((-278.0, -42.0, 1.6)),
        Vector((-322.0, -12.0, 1.2)),
        Vector((-325.0, 18.0, 1.0)),    # Ducks cleanly UNDERNEATH overpass (Z=16.8 -> 15.8m gap!)
        Vector((-322.0, 88.0, 1.0)),
        Vector((-305.0, 165.0, 0.9)),
        Vector((-242.0, 185.0, 0.8)),
        Vector((-186.0, 185.0, 0.8)),
    ], town_rb_raw, town_north_trim)
    town_west_raw = sample_smooth_3d_curve(town_west_ctrl, step_len=step_len, closed=False)
    town_west_raw = smooth_spline_z(
        town_west_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-355.0 <= p.x <= -295.0 and -15.0 <= p.y <= 55.0),
    )
    town_west_trim, twl_s_info, twl_e_info = trim_branch_for_fillet(
        town_west_raw, town_rb_raw, 5.4, True, town_north_trim, 4.0, False, fillet_dist=6.5, blend_max=68.0
    )

    # 33. EMERALD HARBOR ROUNDABOUT (Closed 2-Lane Coastal Marina Plaza cleanly south of coastal_loop!)
    harbor_rb_ctrl = roundabout_ctrl_pts(230.0, -900.0, 46.0, 2.5, count=12)
    harbor_rb_raw = sample_smooth_3d_curve(harbor_rb_ctrl, step_len=step_len, closed=True)
    harbor_rb_raw = smooth_spline_z(harbor_rb_raw, closed=True, passes=z_passes)

    # 34. HARBOR QUAY WEST (coastal_loop East of island_causeway -> Harbor Roundabout West)
    harbor_quay_w_ctrl = snap_ctrl_endpoints_z([
        Vector((67.7, -706.8, 2.0)),
        Vector((78.0, -795.0, 2.2)),
        Vector((118.0, -882.0, 2.4)),
        Vector((184.0, -900.0, 2.5)),
    ], coastal_trim, harbor_rb_raw)
    harbor_quay_w_raw = sample_smooth_3d_curve(harbor_quay_w_ctrl, step_len=step_len, closed=False)
    harbor_quay_w_raw = smooth_spline_z(harbor_quay_w_raw, closed=False, passes=z_passes)
    harbor_quay_w_trim, hqw_s_info, hqw_e_info = trim_branch_for_fillet(
        harbor_quay_w_raw, coastal_trim, 5.4, False, harbor_rb_raw, 5.4, True, fillet_dist=7.0, blend_max=68.0
    )

    # 35. HARBOR QUAY EAST (Harbor Roundabout East -> island_causeway Eastern Shore)
    harbor_quay_e_ctrl = snap_ctrl_endpoints_z([
        Vector((276.0, -900.0, 2.5)),
        Vector((420.0, -900.0, 4.8)),
        Vector((605.0, -895.0, 8.6)),
        Vector((735.0, -895.0, 11.8)),
        Vector((782.0, -895.0, 12.8)),
    ], harbor_rb_raw, island_trim)
    harbor_quay_e_raw = sample_smooth_3d_curve(harbor_quay_e_ctrl, step_len=step_len, closed=False)
    harbor_quay_e_raw = smooth_spline_z(harbor_quay_e_raw, closed=False, passes=z_passes)
    harbor_quay_e_trim, hqe_s_info, hqe_e_info = trim_branch_for_fillet(
        harbor_quay_e_raw, harbor_rb_raw, 5.4, True, island_trim, 7.6, False, fillet_dist=7.0, blend_max=72.0
    )

    # 36. HARBOR SKYWAY FLYOVER (Soars 19m OVER coastal_loop @ (238.8, -745.4) -> Emerald Harbor inner shore)
    harbor_fly_ctrl = snap_ctrl_endpoints_z([
        Vector((230.0, -854.0, 2.5)),
        Vector((244.0, -812.0, 9.5)),
        Vector((250.0, -772.0, 18.8)),
        Vector((238.8, -745.4, 21.0)),   # Bridge OVER coastal_loop (Z=2.0 -> +19.0m clearance!)
        Vector((218.0, -712.0, 21.0)),
        Vector((185.0, -655.0, 12.6)),
        Vector((95.0, -620.0, 7.2)),
        Vector((-45.0, -622.0, 4.8)),
        Vector((-169.6, -631.3, 4.2)),
    ], harbor_rb_raw, coastal_trim)
    harbor_fly_raw = sample_smooth_3d_curve(harbor_fly_ctrl, step_len=step_len, closed=False)
    harbor_fly_raw = smooth_spline_z(
        harbor_fly_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (208.0 <= p.x <= 265.0 and -778.0 <= p.y <= -705.0),
    )
    harbor_fly_trim, hfl_s_info, hfl_e_info = trim_branch_for_fillet(
        harbor_fly_raw, harbor_rb_raw, 5.4, True, coastal_trim, 5.4, False, fillet_dist=7.0, blend_max=72.0
    )

    # 37. EMERALD COVE SKYBRIDGE (east_ridge @ (810, -268) north of hairpin -> OVER hwy @ (673, -276) -> river_run)
    emerald_cove_ctrl = snap_ctrl_endpoints_z([
        Vector((810.0, -268.0, 35.4)),
        Vector((755.0, -235.0, 35.2)),
        Vector((673.0, -276.0, 33.4)),   # Elevated Viaduct OVER hwy (Z=16.2 -> +17.2m clearance!)
        Vector((565.0, -238.0, 21.0)),
        Vector((445.0, -205.0, 10.5)),
        Vector((345.0, -212.0, 4.5)),
        Vector((291.8, -163.0, 2.2)),
    ], east_ridge_trim, river_run_trim)
    emerald_cove_raw = sample_smooth_3d_curve(emerald_cove_ctrl, step_len=step_len, closed=False)
    emerald_cove_raw = smooth_spline_z(
        emerald_cove_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (625.0 <= p.x <= 725.0 and -315.0 <= p.y <= -235.0),
    )
    emerald_cove_trim, ecv_s_info, ecv_e_info = trim_branch_for_fillet(
        emerald_cove_raw, east_ridge_trim, 4.0, False, river_run_trim, 5.4, False, fillet_dist=7.0, blend_max=75.0
    )

    # 38. OUTER AUTUMN TIMBERLAND EXPRESSWAY (Extended NE Highway Frontier + Bridges OVER sawmill_lane & Autumn Lake)
    autumn_timber_ctrl = snap_ctrl_endpoints_z([
        Vector((440.2, 868.3, 30.0)),
        Vector((532.0, 910.0, 28.4)),
        Vector((620.0, 1035.0, 27.0)),
        Vector((810.0, 1255.0, 26.5)),
        Vector((1140.0, 1465.0, 27.5)),
        Vector((1480.0, 1390.0, 24.5)),
        Vector((1605.0, 1180.0, 21.0)),
        Vector((1535.0, 965.0, 19.5)),   # Scenic Autumn Lake Shore Sweep
        Vector((1565.0, 740.0, 25.0)),   # Elevated Highway Bridge OVER sawmill_lane (Z=8.5 -> 16.5m!)
        Vector((1490.0, 520.0, 25.0)),
        Vector((1280.0, 480.0, 34.0)),
        Vector((1145.0, 515.0, 38.0)),
        Vector((1056.0, 472.0, 40.5)),
        Vector((1036.8, 354.7, 40.5)),   # Opposite caldera_inner_rim -> 4-Way @ volcano_ridge!
    ], hwy_north_trim, volcano_trim)
    autumn_timber_raw = sample_smooth_3d_curve(autumn_timber_ctrl, step_len=step_len, closed=False)
    autumn_timber_raw = smooth_spline_z(
        autumn_timber_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (1515.0 <= p.x <= 1615.0 and 695.0 <= p.y <= 785.0),
    )
    autumn_timber_trim, ath_s_info, ath_e_info = trim_branch_for_fillet(
        autumn_timber_raw, hwy_north_trim, 7.6, False, volcano_trim, 4.0, False, fillet_dist=7.0, blend_max=96.0
    )

    # 39. SAWMILL WOODLAND LANE (Narrow winding backroad ducking UNDER autumn_timber_hwy!)
    sawmill_ctrl = snap_ctrl_endpoints_z([
        Vector((795.0, 615.0, 28.0)),
        Vector((920.0, 625.0, 23.0)),
        Vector((1085.0, 665.0, 17.5)),
        Vector((1225.0, 725.0, 13.0)),
        Vector((1420.0, 745.0, 9.2)),
        Vector((1565.0, 740.0, 8.5)),    # Ducks cleanly UNDER autumn_timber_hwy (Z=25.0 -> 16.5m!)
        Vector((1695.0, 795.0, 10.5)),
        Vector((1735.0, 995.0, 13.5)),
        Vector((1715.0, 1215.0, 17.5)),
        Vector((1648.0, 1375.0, 21.8)),
        Vector((1588.0, 1410.0, 23.2)),
        Vector((1522.7, 1351.4, 23.7)),
    ], autumn_loop_trim, autumn_timber_trim)
    sawmill_raw = sample_smooth_3d_curve(sawmill_ctrl, step_len=step_len, closed=False)
    sawmill_raw = smooth_spline_z(
        sawmill_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (1515.0 <= p.x <= 1615.0 and 695.0 <= p.y <= 785.0),
    )
    sawmill_trim, smln_s_info, smln_e_info = trim_branch_for_fillet(
        sawmill_raw, autumn_loop_trim, 4.0, False, autumn_timber_trim, 7.6, False, fillet_dist=7.0, blend_max=72.0
    )

    # 40. MAPLE CREEK NORTH & SOUTH (4-Way Forest Intersection @ sawmill_lane (1165.2, 701.7))
    maple_n_ctrl = snap_ctrl_endpoints_z([
        Vector((980.0, 1365.0, 26.8)),
        Vector((1085.0, 1210.0, 21.5)),
        Vector((1170.0, 1020.0, 17.0)),
        Vector((1155.0, 845.0, 15.8)),
        Vector((1130.0, 772.0, 15.2)),
        Vector((1165.2, 701.7, 14.8)),
    ], autumn_timber_trim, sawmill_trim)
    maple_n_raw = sample_smooth_3d_curve(maple_n_ctrl, step_len=step_len, closed=False)
    maple_n_raw = smooth_spline_z(maple_n_raw, closed=False, passes=z_passes)
    maple_n_trim, mpn_s_info, mpn_e_info = trim_branch_for_fillet(
        maple_n_raw, autumn_timber_trim, 7.6, False, sawmill_trim, 4.0, False, fillet_dist=7.0, blend_max=72.0
    )

    # 41. MAPLE CREEK SOUTH (Opposite 4-Way @ sawmill_lane (1165.2, 701.7) -> north around autumn_timber_hwy -> volcano_ridge)
    maple_s_ctrl = snap_ctrl_endpoints_z([
        Vector((1165.2, 701.7, 14.8)),
        Vector((1187.0, 657.0, 15.8)),
        Vector((1162.0, 608.0, 17.5)),
        Vector((1095.0, 575.0, 21.5)),
        Vector((1005.0, 550.0, 26.5)),
        Vector((942.0, 482.0, 30.8)),
        Vector((923.8, 393.0, 32.6)),
    ], sawmill_trim, volcano_trim)
    maple_s_raw = sample_smooth_3d_curve(maple_s_ctrl, step_len=step_len, closed=False)
    maple_s_raw = smooth_spline_z(maple_s_raw, closed=False, passes=z_passes)
    maple_s_trim, mps_s_info, mps_e_info = trim_branch_for_fillet(
        maple_s_raw, sawmill_trim, 4.0, False, volcano_trim, 4.0, False, fillet_dist=7.0, blend_max=72.0
    )

    # 42. OBSIDIAN VOLCANO COAST LOOP (Extended Far-East Basalt Peninsula -> 4-Way @ volcano_ridge (1050.2, -165.1))
    obsidian_coast_ctrl = snap_ctrl_endpoints_z([
        Vector((1283.8, 87.8, 57.2)),
        Vector((1365.0, 78.0, 48.0)),
        Vector((1520.0, 145.0, 30.0)),
        Vector((1640.0, 165.0, 22.0)),
        Vector((1720.0, -10.0, 18.0)),
        Vector((1660.0, -245.0, 16.5)),
        Vector((1430.0, -345.0, 22.0)),
        Vector((1235.0, -315.0, 31.0)),
        Vector((1085.0, -310.0, 37.5)),
        Vector((1015.0, -238.0, 40.0)),
        Vector((1050.2, -165.1, 41.5)),  # Opposite caldera_inner_rim -> 4-Way @ volcano_ridge!
    ], volcano_trim, volcano_trim)
    obsidian_coast_raw = sample_smooth_3d_curve(obsidian_coast_ctrl, step_len=step_len, closed=False)
    obsidian_coast_raw = smooth_spline_z(obsidian_coast_raw, closed=False, passes=z_passes)
    obsidian_coast_trim, ocl_s_info, ocl_e_info = trim_branch_for_fillet(
        obsidian_coast_raw, volcano_trim, 4.0, False, volcano_trim, 4.0, False, fillet_dist=7.0, blend_max=75.0
    )

    # 43. LAVA COVE CLIFF OVERPASS (Crosses OVER obsidian_coast_loop @ (1640, 165) -> Black-Sand Cove)
    lava_cove_ctrl = snap_ctrl_endpoints_z([
        Vector((1225.0, 255.0, 43.0)),
        Vector((1415.0, 330.0, 38.5)),
        Vector((1565.0, 265.0, 38.5)),
        Vector((1640.0, 165.0, 38.5)),   # Volcanic Overpass Bridge OVER obsidian_coast_loop (Z=22.0 -> 16.5m!)
        Vector((1580.0, 25.0, 22.0)),
        Vector((1495.0, -65.0, 14.0)),
        Vector((1560.0, -190.0, 14.5)),
        Vector((1655.0, -250.0, 16.5)),
    ], volcano_trim, obsidian_coast_trim)
    lava_cove_raw = sample_smooth_3d_curve(lava_cove_ctrl, step_len=step_len, closed=False)
    lava_cove_raw = smooth_spline_z(
        lava_cove_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (1595.0 <= p.x <= 1685.0 and 120.0 <= p.y <= 210.0),
    )
    lava_cove_trim, lco_s_info, lco_e_info = trim_branch_for_fillet(
        lava_cove_raw, volcano_trim, 4.0, False, obsidian_coast_trim, 5.4, False, fillet_dist=7.0, blend_max=72.0
    )

    # 44. NORTHERN GLACIER HORIZON EXPRESSWAY (Expanded Outer Arctic Rim to Y = +1560m)
    glacier_hwy_ctrl = snap_ctrl_endpoints_z([
        Vector((260.0, 1020.0, 26.5)),
        Vector((240.0, 1295.0, 34.0)),
        Vector((25.0, 1515.0, 44.0)),
        Vector((-365.0, 1555.0, 50.0)),
        Vector((-780.0, 1460.0, 52.0)),
        Vector((-1065.0, 1245.0, 44.0)),
        Vector((-1085.0, 1020.0, 36.5)),
        Vector((-975.0, 945.0, 35.0)),
        Vector((-901.3, 865.2, 34.4)),
    ], hwy_north_trim, hwy_north_trim)
    glacier_hwy_raw = sample_smooth_3d_curve(glacier_hwy_ctrl, step_len=step_len, closed=False)
    glacier_hwy_raw = smooth_spline_z(glacier_hwy_raw, closed=False, passes=z_passes)
    glacier_hwy_trim, ghwy_s_info, ghwy_e_info = trim_branch_for_fillet(
        glacier_hwy_raw, hwy_north_trim, 7.6, False, hwy_north_trim, 7.6, False, fillet_dist=7.0, blend_max=98.0
    )

    # 45. ALPINE SKI VILLAGE LOOP (High Snow Plateau Street Loop + Ducks UNDER glacier_corkscrew_bridge!)
    ski_village_ctrl = snap_ctrl_endpoints_z([
        Vector((-430.0, 1025.0, 27.5)),
        Vector((-445.0, 1155.0, 32.0)),
        Vector((-355.0, 1240.0, 35.0)),  # Ducks UNDER glacier_corkscrew_bridge (Z=51.5 -> 16.5m!)
        Vector((-225.0, 1295.0, 38.0)),
        Vector((-255.0, 1415.0, 44.0)),
        Vector((-335.0, 1475.0, 47.8)),
        Vector((-351.6, 1555.8, 49.9)),
    ], hwy_north_trim, glacier_hwy_trim)
    ski_village_raw = sample_smooth_3d_curve(ski_village_ctrl, step_len=step_len, closed=False)
    ski_village_raw = smooth_spline_z(
        ski_village_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-405.0 <= p.x <= -305.0 and 1195.0 <= p.y <= 1285.0),
    )
    ski_village_trim, svl_s_info, svl_e_info = trim_branch_for_fillet(
        ski_village_raw, hwy_north_trim, 7.6, False, glacier_hwy_trim, 7.6, False, fillet_dist=7.0, blend_max=72.0
    )

    # 46. GLACIER CORKSCREW SKYBRIDGE (Overlaps ski_village_loop on high Alpine Viaduct -> Tarn Shore!)
    glacier_cork_ctrl = snap_ctrl_endpoints_z([
        Vector((-645.0, 990.0, 29.5)),
        Vector((-685.0, 1165.0, 38.0)),
        Vector((-545.0, 1265.0, 47.0)),
        Vector((-355.0, 1240.0, 51.5)),  # Alpine Skybridge OVER ski_village_loop (Z=35.0 -> 16.5m!)
        Vector((-115.0, 1205.0, 40.0)),
        Vector((45.0, 1265.0, 35.5)),
        Vector((190.0, 1345.0, 36.0)),
    ], hwy_north_trim, glacier_hwy_trim)
    glacier_cork_raw = sample_smooth_3d_curve(glacier_cork_ctrl, step_len=step_len, closed=False)
    glacier_cork_raw = smooth_spline_z(
        glacier_cork_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-405.0 <= p.x <= -305.0 and 1195.0 <= p.y <= 1285.0),
    )
    glacier_cork_trim, gcb_s_info, gcb_e_info = trim_branch_for_fillet(
        glacier_cork_raw, hwy_north_trim, 7.6, False, glacier_hwy_trim, 7.6, False, fillet_dist=7.0, blend_max=72.0
    )

    # 47. PAINTED DESERT JUNCTION ROUNDABOUT (Closed 2-Lane Western Traffic Circle!)
    desert_rb_ctrl = roundabout_ctrl_pts(-1055.0, -245.0, 48.0, 20.5, count=12)
    desert_rb_raw = sample_smooth_3d_curve(desert_rb_ctrl, step_len=step_len, closed=True)
    desert_rb_raw = smooth_spline_z(desert_rb_raw, closed=True, passes=z_passes)

    # 48. MESA ROTARY LINK & BADLANDS ROTARY WEST (4-Way Cross @ west_mesa_rim (-845.1, -203.5)!)
    mesa_rotary_e_ctrl = snap_ctrl_endpoints_z([
        Vector((-1007.0, -245.0, 20.5)),
        Vector((-935.0, -225.0, 16.0)),
        Vector((-895.0, -206.0, 13.0)),
        Vector((-845.1, -203.5, 10.7)),  # Opposite canyon_cut_start -> 4-Way Cross @ west_mesa_rim!
    ], desert_rb_raw, west_mesa_trim)
    mesa_rotary_e_raw = sample_smooth_3d_curve(mesa_rotary_e_ctrl, step_len=step_len, closed=False)
    mesa_rotary_e_raw = smooth_spline_z(mesa_rotary_e_raw, closed=False, passes=z_passes)
    mesa_rotary_e_trim, mre_s_info, mre_e_info = trim_branch_for_fillet(
        mesa_rotary_e_raw, desert_rb_raw, 5.4, True, west_mesa_trim, 5.4, False, fillet_dist=7.0, blend_max=68.0
    )

    mesa_rotary_w_ctrl = snap_ctrl_endpoints_z([
        Vector((-1103.0, -245.0, 20.5)),
        Vector((-1165.0, -252.0, 25.0)),
        Vector((-1235.0, -260.0, 29.5)),
    ], desert_rb_raw, badlands_trim)
    mesa_rotary_w_raw = sample_smooth_3d_curve(mesa_rotary_w_ctrl, step_len=step_len, closed=False)
    mesa_rotary_w_raw = smooth_spline_z(mesa_rotary_w_raw, closed=False, passes=z_passes)
    mesa_rotary_w_trim, mrw_s_info, mrw_e_info = trim_branch_for_fillet(
        mesa_rotary_w_raw, desert_rb_raw, 5.4, True, badlands_trim, 5.4, False, fillet_dist=7.0, blend_max=68.0
    )

    # 49. OUTER PAINTED BADLANDS EXPRESSWAY (Far-West Rim Highway out to X = -1720m!)
    outer_badlands_ctrl = snap_ctrl_endpoints_z([
        Vector((-1116.8, -521.4, 26.2)),
        Vector((-1162.0, -605.0, 25.2)),
        Vector((-1300.0, -655.0, 24.5)),
        Vector((-1570.0, -645.0, 24.0)),
        Vector((-1720.0, -345.0, 27.0)),
        Vector((-1725.0, 125.0, 28.5)),
        Vector((-1645.0, 515.0, 30.0)),
        Vector((-1535.0, 720.0, 32.0)),
        Vector((-1395.0, 715.0, 31.8)),
        Vector((-1325.0, 610.0, 31.0)),
        Vector((-1295.0, 580.0, 30.5)),
        Vector((-1222.6, 555.9, 29.9)),
    ], badlands_trim, badlands_trim)
    outer_badlands_raw = sample_smooth_3d_curve(outer_badlands_ctrl, step_len=step_len, closed=False)
    outer_badlands_raw = smooth_spline_z(outer_badlands_raw, closed=False, passes=z_passes)
    outer_badlands_trim, obh_s_info, obh_e_info = trim_branch_for_fillet(
        outer_badlands_raw, badlands_trim, 5.4, False, badlands_trim, 5.4, False, fillet_dist=7.0, blend_max=98.0
    )

    # 50. DEEP SLOT CANYON GORGE & PUEBLO SKYBRIDGE (4-Way @ badlands_loop (-1247.0, -87.1) + Overlapping Gorge!)
    slot_canyon_ctrl = snap_ctrl_endpoints_z([
        Vector((-1215.0, -395.0, 27.5)),
        Vector((-1355.0, -445.0, 15.0)),
        Vector((-1475.0, -315.0, 8.5)),
        Vector((-1490.0, -85.0, 8.2)),    # Runs deep inside Sandstone Gorge UNDER pueblo_overpass!
        Vector((-1465.0, 155.0, 8.5)),
        Vector((-1395.0, 325.0, 18.0)),
        Vector((-1235.0, 365.0, 31.5)),
    ], badlands_trim, badlands_trim)
    slot_canyon_raw = sample_smooth_3d_curve(slot_canyon_ctrl, step_len=step_len, closed=False)
    slot_canyon_raw = smooth_spline_z(
        slot_canyon_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-1545.0 <= p.x <= -1425.0 and -130.0 <= p.y <= -40.0),
    )
    slot_canyon_trim, scn_s_info, scn_e_info = trim_branch_for_fillet(
        slot_canyon_raw, badlands_trim, 5.4, False, badlands_trim, 5.4, False, fillet_dist=7.0, blend_max=72.0
    )

    pueblo_bridge_ctrl = snap_ctrl_endpoints_z([
        Vector((-1247.0, -87.1, 34.5)),  # Opposite mesa_canyon_link -> 4-Way Cross @ badlands_loop!
        Vector((-1365.0, -90.0, 29.0)),
        Vector((-1490.0, -85.0, 24.8)),   # Red-Rock Skybridge OVER slot_canyon_run (Z=8.2 -> +16.6m!)
        Vector((-1605.0, -52.0, 26.5)),
        Vector((-1650.0, 10.0, 27.6)),
        Vector((-1733.6, 38.5, 28.3)),
    ], badlands_trim, outer_badlands_trim)
    pueblo_bridge_raw = sample_smooth_3d_curve(pueblo_bridge_ctrl, step_len=step_len, closed=False)
    pueblo_bridge_raw = smooth_spline_z(
        pueblo_bridge_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (-1545.0 <= p.x <= -1425.0 and -130.0 <= p.y <= -40.0),
    )
    pueblo_bridge_trim, pbr_s_info, pbr_e_info = trim_branch_for_fillet(
        pueblo_bridge_raw, badlands_trim, 5.4, False, outer_badlands_trim, 7.6, False, fillet_dist=7.0, blend_max=75.0
    )

    # 51. OUTER TROPICAL ATOLLS EXPRESSWAY (Spans Southern Archipelago cleanly from island_harbor_loop -> island_causeway!)
    outer_atoll_ctrl = snap_ctrl_endpoints_z([
        Vector((851.2, -978.6, 10.6)),
        Vector((920.0, -1045.0, 12.2)),
        Vector((960.0, -1165.0, 16.5)),
        Vector((920.0, -1310.0, 18.0)),   # Elevated East Atoll Overpass Bridge OVER atoll_village_loop! (16.5m)
        Vector((900.0, -1480.0, 13.5)),
        Vector((645.0, -1545.0, 11.0)),
        Vector((260.0, -1515.0, 11.5)),
        Vector((85.0, -1410.0, 13.5)),    # West Coral Atoll Causeway Landing
        Vector((30.0, -1290.0, 11.5)),
        Vector((115.0, -1205.0, 11.2)),
        Vector((235.0, -1178.0, 10.8)),
        Vector((263.5, -1085.4, 10.6)),
    ], island_harbor_trim, island_trim)
    outer_atoll_raw = sample_smooth_3d_curve(outer_atoll_ctrl, step_len=step_len, closed=False)
    outer_atoll_raw = smooth_spline_z(
        outer_atoll_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (875.0 <= p.x <= 965.0 and -1385.0 <= p.y <= -1225.0),
    )
    outer_atoll_trim, oat_s_info, oat_e_info = trim_branch_for_fillet(
        outer_atoll_raw, island_harbor_trim, 4.0, False, island_trim, 7.6, False, fillet_dist=7.0, blend_max=98.0
    )

    # 52. ATOLL VILLAGE LAGOON LOOP (Island Village Loop Ducking UNDER outer_atoll_express!)
    atoll_village_ctrl = snap_ctrl_endpoints_z([
        Vector((790.0, -1495.0, 6.5)),
        Vector((735.0, -1360.0, 5.0)),
        Vector((830.0, -1265.0, 4.5)),
        Vector((925.0, -1295.0, 1.5)),    # Ducks UNDER outer_atoll_express Bridge (Z=18.0 -> 16.5m gap!)
        Vector((1065.0, -1305.0, 5.8)),
        Vector((1145.0, -1405.0, 8.2)),
        Vector((1065.0, -1475.0, 10.5)),
        Vector((915.0, -1465.0, 13.8)),
    ], outer_atoll_trim, outer_atoll_trim)
    atoll_village_raw = sample_smooth_3d_curve(atoll_village_ctrl, step_len=step_len, closed=False)
    atoll_village_raw = smooth_spline_z(
        atoll_village_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (875.0 <= p.x <= 965.0 and -1345.0 <= p.y <= -1255.0),
    )
    atoll_village_trim, avl_s_info, avl_e_info = trim_branch_for_fillet(
        atoll_village_raw, outer_atoll_trim, 7.6, False, outer_atoll_trim, 7.6, False, fillet_dist=7.0, blend_max=72.0
    )

    # 53. SW CORAL SANDBAR PARKWAY (coastal_loop West -> SW Coral Atoll (-660, -1180) -> West Atoll)
    sw_atoll_ctrl = snap_ctrl_endpoints_z([
        Vector((-345.0, -725.0, 4.5)),
        Vector((-510.0, -845.0, 8.5)),
        Vector((-675.0, -1045.0, 10.5)),
        Vector((-755.0, -1205.0, 9.5)),
        Vector((-580.0, -1315.0, 9.0)),
        Vector((-255.0, -1455.0, 10.5)),
        Vector((-65.0, -1465.0, 12.2)),
        Vector((12.0, -1445.0, 13.0)),
        Vector((67.0, -1392.4, 13.4)),
    ], coastal_trim, outer_atoll_trim)
    sw_atoll_raw = sample_smooth_3d_curve(sw_atoll_ctrl, step_len=step_len, closed=False)
    sw_atoll_raw = smooth_spline_z(sw_atoll_raw, closed=False, passes=z_passes)
    sw_atoll_trim, swa_s_info, swa_e_info = trim_branch_for_fillet(
        sw_atoll_raw, coastal_trim, 5.4, False, outer_atoll_trim, 7.6, False, fillet_dist=7.0, blend_max=75.0
    )

    # 54. NW BADLANDS-GLACIER EXPRESSWAY (outer_badlands_hwy N -> glacier_horizon_hwy NW)
    nw_frontier_ctrl = snap_ctrl_endpoints_z([
        Vector((-1509.4, 729.8, 32.05)),
        Vector((-1535.0, 815.0, 34.0)),
        Vector((-1560.0, 1025.0, 37.5)),
        Vector((-1455.0, 1245.0, 41.0)),
        Vector((-1260.0, 1365.0, 44.0)),
        Vector((-1105.0, 1351.0, 45.2)),
        Vector((-1033.9, 1288.3, 45.59)),
    ], outer_badlands_trim, glacier_hwy_trim)
    nw_frontier_raw = sample_smooth_3d_curve(nw_frontier_ctrl, step_len=step_len, closed=False)
    nw_frontier_raw = smooth_spline_z(nw_frontier_raw, closed=False, passes=z_passes)
    nw_frontier_trim, nwf_s_info, nwf_e_info = trim_branch_for_fillet(
        nw_frontier_raw, outer_badlands_trim, 7.6, False, glacier_hwy_trim, 7.6, False, fillet_dist=7.0, blend_max=85.0
    )

    # 55. MESA-GLACIER VALLEY PASS (outer_badlands_hwy NE -> glacier_horizon_hwy W)
    badlands_glacier_ctrl = snap_ctrl_endpoints_z([
        Vector((-1352.9, 660.8, 31.41)),
        Vector((-1285.0, 695.0, 32.0)),
        Vector((-1235.0, 845.0, 33.8)),
        Vector((-1245.0, 1020.0, 36.5)),
        Vector((-1185.0, 1104.0, 38.5)),
        Vector((-1099.1, 1104.0, 39.17)),
    ], outer_badlands_trim, glacier_hwy_trim)
    badlands_glacier_raw = sample_smooth_3d_curve(badlands_glacier_ctrl, step_len=step_len, closed=False)
    badlands_glacier_raw = smooth_spline_z(badlands_glacier_raw, closed=False, passes=z_passes)
    badlands_glacier_trim, bgp_s_info, bgp_e_info = trim_branch_for_fillet(
        badlands_glacier_raw, outer_badlands_trim, 7.6, False, glacier_hwy_trim, 7.6, False, fillet_dist=7.0, blend_max=80.0
    )

    # 56. NORTHERN RIDGE TRANS-BIOME HWY (glacier_horizon_hwy NE -> autumn_timber_hwy NW)
    alpine_autumn_ctrl = snap_ctrl_endpoints_z([
        Vector((82.5, 1480.7, 42.15)),
        Vector((135.0, 1555.0, 41.0)),
        Vector((365.0, 1575.0, 37.5)),
        Vector((620.0, 1495.0, 32.0)),
        Vector((755.0, 1328.0, 27.5)),
        Vector((814.5, 1258.9, 26.51)),
    ], glacier_hwy_trim, autumn_timber_trim)
    alpine_autumn_raw = sample_smooth_3d_curve(alpine_autumn_ctrl, step_len=step_len, closed=False)
    alpine_autumn_raw = smooth_spline_z(alpine_autumn_raw, closed=False, passes=z_passes)
    alpine_autumn_trim, aah_s_info, aah_e_info = trim_branch_for_fillet(
        alpine_autumn_raw, glacier_hwy_trim, 7.6, False, autumn_timber_trim, 7.6, False, fillet_dist=7.0, blend_max=85.0
    )

    # 57. HIGHLAND TARN BORDER PASS (glacier_horizon_hwy E -> autumn_timber_hwy W)
    glacier_autumn_ctrl = snap_ctrl_endpoints_z([
        Vector((261.4, 1181.8, 29.85)),
        Vector((345.0, 1184.0, 29.2)),
        Vector((495.0, 1175.0, 28.0)),
        Vector((598.0, 1143.0, 27.2)),
        Vector((664.1, 1092.4, 26.71)),
    ], glacier_hwy_trim, autumn_timber_trim)
    glacier_autumn_raw = sample_smooth_3d_curve(glacier_autumn_ctrl, step_len=step_len, closed=False)
    glacier_autumn_raw = smooth_spline_z(glacier_autumn_raw, closed=False, passes=z_passes)
    glacier_autumn_trim, gap_s_info, gap_e_info = trim_branch_for_fillet(
        glacier_autumn_raw, glacier_hwy_trim, 7.6, False, autumn_timber_trim, 7.6, False, fillet_dist=7.0, blend_max=78.0
    )

    # 58. EASTERN CLIFFS COASTAL DRIVE (sawmill_lane E -> obsidian_coast_loop NE)
    east_bluff_ctrl = snap_ctrl_endpoints_z([
        Vector((1691.5, 791.0, 10.40)),
        Vector((1736.0, 750.0, 12.8)),
        Vector((1755.0, 565.0, 19.5)),
        Vector((1764.0, 325.0, 23.5)),
        Vector((1774.0, 130.0, 22.8)),
        Vector((1756.0, 96.5, 20.5)),
        Vector((1699.8, 75.8, 19.16)),
    ], sawmill_trim, obsidian_coast_trim)
    east_bluff_raw = sample_smooth_3d_curve(east_bluff_ctrl, step_len=step_len, closed=False)
    east_bluff_raw = smooth_spline_z(east_bluff_raw, closed=False, passes=z_passes)
    east_bluff_trim, ebc_s_info, ebc_e_info = trim_branch_for_fillet(
        east_bluff_raw, sawmill_trim, 4.0, False, obsidian_coast_trim, 5.4, False, fillet_dist=7.0, blend_max=78.0
    )

    # 59. OBSIDIAN-AUTUMN RIDGE LINK (autumn_timber_hwy SE -> lava_cove_overpass N)
    caldera_timber_ctrl = snap_ctrl_endpoints_z([
        Vector((1327.3, 479.5, 32.06)),
        Vector((1328.5, 425.0, 35.8)),
        Vector((1334.0, 364.0, 40.0)),
        Vector((1353.5, 316.2, 42.91)),
    ], autumn_timber_trim, lava_cove_trim)
    caldera_timber_raw = sample_smooth_3d_curve(caldera_timber_ctrl, step_len=step_len, closed=False)
    caldera_timber_raw = smooth_spline_z(caldera_timber_raw, closed=False, passes=z_passes)
    caldera_timber_trim, ctp_s_info, ctp_e_info = trim_branch_for_fillet(
        caldera_timber_raw, autumn_timber_trim, 7.6, False, lava_cove_trim, 4.0, False, fillet_dist=7.0, blend_max=68.0
    )

    # 60. VOLCANIC-TO-CORAL OCEAN CAUSEWAY (obsidian_coast_loop SE -> SE Reef Island -> atoll_village_loop E)
    se_reef_ctrl = snap_ctrl_endpoints_z([
        Vector((1507.5, -328.7, 19.68)),
        Vector((1530.0, -406.0, 17.5)),
        Vector((1515.0, -640.0, 14.5)),
        Vector((1465.0, -795.0, 12.0)),
        Vector((1345.0, -965.0, 13.0)),
        Vector((1235.0, -1120.0, 12.0)),
        Vector((1160.0, -1280.0, 9.5)),
        Vector((1105.0, -1335.6, 6.76)),
    ], obsidian_coast_trim, atoll_village_trim)
    se_reef_raw = sample_smooth_3d_curve(se_reef_ctrl, step_len=step_len, closed=False)
    se_reef_raw = smooth_spline_z(se_reef_raw, closed=False, passes=z_passes)
    se_reef_trim, sre_s_info, sre_e_info = trim_branch_for_fillet(
        se_reef_raw, obsidian_coast_trim, 5.4, False, atoll_village_trim, 4.0, False, fillet_dist=7.0, blend_max=85.0
    )

    # 61. OBSIDIAN-HARBOR CAUSEWAY (obsidian_coast_loop S -> SE Reef Island W -> island_harbor_loop E)
    obsidian_harbor_ctrl = snap_ctrl_endpoints_z([
        Vector((1262.4, -319.1, 29.71)),
        Vector((1248.0, -395.0, 23.0)),
        Vector((1255.0, -565.0, 16.0)),
        Vector((1305.0, -720.0, 13.0)),
        Vector((1185.0, -825.0, 13.5)),
        Vector((1020.0, -861.0, 13.0)),
        Vector((931.6, -839.5, 12.76)),
    ], obsidian_coast_trim, island_harbor_trim)
    obsidian_harbor_raw = sample_smooth_3d_curve(obsidian_harbor_ctrl, step_len=step_len, closed=False)
    obsidian_harbor_raw = smooth_spline_z(obsidian_harbor_raw, closed=False, passes=z_passes)
    obsidian_harbor_trim, ohl_s_info, ohl_e_info = trim_branch_for_fillet(
        obsidian_harbor_raw, obsidian_coast_trim, 5.4, False, island_harbor_trim, 4.0, False, fillet_dist=7.0, blend_max=85.0
    )

    # 62. SW SUNSET COAST OCEAN EXPRESSWAY (outer_badlands_hwy S -> SW Sunset Island -> sw_atoll_pkwy S)
    sw_desert_atoll_ctrl = snap_ctrl_endpoints_z([
        Vector((-1429.0, -670.6, 24.06)),
        Vector((-1425.0, -755.0, 20.5)),
        Vector((-1395.0, -945.0, 15.5)),
        Vector((-1270.0, -1125.0, 12.5)),
        Vector((-1075.0, -1305.0, 12.0)),
        Vector((-875.0, -1395.0, 11.2)),
        Vector((-762.5, -1366.2, 10.2)),
        Vector((-701.2, -1257.4, 9.17)),
    ], outer_badlands_trim, sw_atoll_trim)
    sw_desert_atoll_raw = sample_smooth_3d_curve(sw_desert_atoll_ctrl, step_len=step_len, closed=False)
    sw_desert_atoll_raw = smooth_spline_z(sw_desert_atoll_raw, closed=False, passes=z_passes)
    sw_desert_atoll_trim, sda_s_info, sda_e_info = trim_branch_for_fillet(
        sw_desert_atoll_raw, outer_badlands_trim, 7.6, False, sw_atoll_trim, 5.4, False, fillet_dist=7.0, blend_max=92.0
    )

    # 63. SANDSTONE-TO-LAGOON PARKWAY (badlands_loop S -> SW West Cove Bridge -> sw_atoll_pkwy W)
    badlands_cove_ctrl = snap_ctrl_endpoints_z([
        Vector((-972.1, -574.2, 23.74)),
        Vector((-983.0, -645.0, 20.0)),
        Vector((-985.0, -825.0, 15.0)),
        Vector((-915.0, -985.0, 12.0)),
        Vector((-804.0, -1055.0, 10.6)),
        Vector((-721.2, -1111.0, 10.24)),
    ], badlands_trim, sw_atoll_trim)
    badlands_cove_raw = sample_smooth_3d_curve(badlands_cove_ctrl, step_len=step_len, closed=False)
    badlands_cove_raw = smooth_spline_z(badlands_cove_raw, closed=False, passes=z_passes)
    badlands_cove_trim, bcd_s_info, bcd_e_info = trim_branch_for_fillet(
        badlands_cove_raw, badlands_trim, 5.4, False, sw_atoll_trim, 5.4, False, fillet_dist=7.0, blend_max=82.0
    )

    routes_spec = [
        {
            "id": "hwy",
            "name": "Horizon Grand Expressway",
            "type": "highway",
            "closed": True,
            "raw": hwy_raw,
            "trimmed": hwy_raw,
            "bridge_ranges": [
                (170.0, 415.0, -585.0, -515.0),  # Southern Ocean Inlet Suspension Bridge
            ],
            "tunnel_range": None,
        },
        {
            "id": "hwy_west",
            "name": "Western Mesa Expressway",
            "type": "highway",
            "closed": False,
            "raw": hwy_west_raw,
            "trimmed": hwy_west_trim,
            "start_parent": ("hwy", True, hw_s_info),
            "end_parent": ("hwy", True, hw_e_info),
            "bridge_ranges": [
                (-778.0, -685.0, -255.0, -130.0),  # Red-Rock Canyon Viaduct Bridge OVER canyon_cut
            ],
            "tunnel_range": None,
        },
        {
            "id": "touge",
            "name": "Alpine Summit Touge",
            "type": "secondary",
            "closed": False,
            "raw": touge_raw,
            "trimmed": touge_trim,
            "start_parent": ("hwy_west", False, touge_s_info),
            "end_parent": ("hwy", True, touge_e_info),
            "bridge_ranges": [],
            "tunnel_range": (-275.0, -25.0, 485.0, 575.0),
        },
        {
            "id": "overpass",
            "name": "Crosstown Skyway Twin-Viaduct",
            "type": "secondary",
            "closed": False,
            "raw": overpass_raw,
            "trimmed": overpass_trim,
            "start_parent": ("touge", False, over_s_info),
            "end_parent": ("hwy", True, over_e_info),
            "bridge_ranges": [
                (-355.0, -145.0, -15.0, 145.0),  # West Town Viaduct OVER town_west_ave & town_north_st
                (-72.0, 72.0, 120.0, 180.0),     # Bridge 1 OVER Main Highway
                (290.0, 520.0, -145.0, -20.0),   # Bridge 2 OVER River Gorge, Emerald Lake Outlet & River Run
            ],
            "tunnel_range": None,
        },
        {
            "id": "river_run",
            "name": "Emerald River Gorge Run",
            "type": "secondary",
            "closed": False,
            "raw": river_run_raw,
            "trimmed": river_run_trim,
            "start_parent": ("hwy", True, riv_s_info),
            "end_parent": ("hwy", True, riv_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "coastal_loop",
            "name": "Golden Bay Coastal Drive",
            "type": "secondary",
            "closed": False,
            "raw": coastal_raw,
            "trimmed": coastal_trim,
            "start_parent": ("hwy", True, coast_s_info),
            "end_parent": ("hwy", True, coast_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "east_ridge",
            "name": "East Cliffside Skybridge",
            "type": "narrow",
            "closed": False,
            "raw": east_ridge_raw,
            "trimmed": east_ridge_trim,
            "start_parent": ("hwy", True, er_s_info),
            "end_parent": ("hwy", True, er_e_info),
            "bridge_ranges": [
                (800.0, 885.0, -240.0, -155.0),   # Elevated Eastern Cliffside Gorge Viaduct
            ],
            "tunnel_range": None,
        },
        {
            "id": "valley",
            "name": "Festival Interchange Ramp",
            "type": "secondary",
            "closed": False,
            "raw": valley_raw,
            "trimmed": valley_trim,
            "start_parent": ("overpass", False, val_s_info),
            "end_parent": ("hwy", True, val_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "canyon_cut",
            "name": "Red-Rock Canyon Gorge",
            "type": "narrow",
            "closed": False,
            "raw": canyon_cut_raw,
            "trimmed": canyon_cut_trim,
            "start_parent": ("west_mesa_rim", False, cc_s_info),
            "end_parent": ("hwy", True, cc_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "west_mesa_rim",
            "name": "Western Desert Mesa Loop",
            "type": "secondary",
            "closed": False,
            "raw": west_mesa_raw,
            "trimmed": west_mesa_trim,
            "start_parent": ("hwy_west", False, wm_s_info),
            "end_parent": ("hwy_west", False, wm_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "autumn_loop",
            "name": "Autumn Highland Skybridge",
            "type": "narrow",
            "closed": False,
            "raw": autumn_loop_raw,
            "trimmed": autumn_loop_trim,
            "start_parent": ("hwy", True, aut_s_info),
            "end_parent": ("river_run", False, aut_e_info),
            "bridge_ranges": [
                (615.0, 685.0, 405.0, 465.0),    # Autumn Ridge Overpass OVER hwy
            ],
            "tunnel_range": None,
        },
        {
            "id": "hwy_north",
            "name": "Northern Trans-Alpine Expressway",
            "type": "highway",
            "closed": False,
            "raw": hwy_north_raw,
            "trimmed": hwy_north_trim,
            "start_parent": ("hwy", True, hn_s_info),
            "end_parent": ("west_mesa_rim", False, hn_e_info),
            "bridge_ranges": [
                (-225.0, 225.0, 975.0, 1105.0),  # Northern Glacial Fjord Viaduct Bridge
            ],
            "tunnel_range": None,
        },
        {
            "id": "volcano_ridge",
            "name": "Caldera Volcanic Pass",
            "type": "narrow",
            "closed": False,
            "raw": volcano_raw,
            "trimmed": volcano_trim,
            "start_parent": ("hwy", True, vol_s_info),
            "end_parent": ("hwy", True, vol_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "badlands_loop",
            "name": "Painted Badlands Scenic Run",
            "type": "secondary",
            "closed": False,
            "raw": badlands_raw,
            "trimmed": badlands_trim,
            "start_parent": ("west_mesa_rim", False, bad_s_info),
            "end_parent": ("hwy_north", False, bad_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "island_causeway",
            "name": "Tropical Archipelago Causeway",
            "type": "highway",
            "closed": False,
            "raw": island_raw,
            "trimmed": island_trim,
            "start_parent": ("coastal_loop", False, isl_s_info),
            "end_parent": ("hwy", True, isl_e_info),
            "bridge_ranges": [
                (-65.0, 465.0, -1140.0, -930.0),  # Southern Tropical Ocean Causeway Bridge
            ],
            "tunnel_range": None,
        },
        {
            "id": "fjord_switchbacks",
            "name": "Glacial Fjord Hairpins",
            "type": "narrow",
            "closed": False,
            "raw": fjord_raw,
            "trimmed": fjord_trim,
            "start_parent": ("hwy_west", False, fjd_s_info),
            "end_parent": ("hwy_north", False, fjd_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "meadow_cross",
            "name": "Meadow Creek Backroad",
            "type": "narrow",
            "closed": False,
            "raw": meadow_raw,
            "trimmed": meadow_trim,
            "start_parent": ("canyon_cut", False, mdw_s_info),
            "end_parent": ("hwy_west", False, mdw_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "emerald_bypass",
            "name": "Emerald Valley Connector",
            "type": "secondary",
            "closed": False,
            "raw": emerald_bypass_raw,
            "trimmed": emerald_bypass_trim,
            "start_parent": ("overpass", False, emb_s_info),
            "end_parent": ("river_run", False, emb_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "autumn_crest_loop",
            "name": "Autumn Crest Ridge Loop",
            "type": "narrow",
            "closed": False,
            "raw": autumn_crest_raw,
            "trimmed": autumn_crest_trim,
            "start_parent": ("autumn_loop", False, acr_s_info),
            "end_parent": ("hwy_north", False, acr_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "caldera_inner_rim",
            "name": "Geothermal Crater Inner Rim",
            "type": "narrow",
            "closed": False,
            "raw": caldera_inner_raw,
            "trimmed": caldera_inner_trim,
            "start_parent": ("volcano_ridge", False, cin_s_info),
            "end_parent": ("volcano_ridge", False, cin_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "mesa_canyon_link",
            "name": "Red-Rock Mesa Crossroad",
            "type": "narrow",
            "closed": False,
            "raw": mesa_canyon_raw,
            "trimmed": mesa_canyon_trim,
            "start_parent": ("west_mesa_rim", False, mcl_s_info),
            "end_parent": ("badlands_loop", False, mcl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "north_badlands_spur",
            "name": "Painted Plateau Spur",
            "type": "narrow",
            "closed": False,
            "raw": north_badlands_raw,
            "trimmed": north_badlands_trim,
            "start_parent": ("west_mesa_rim", False, nbs_s_info),
            "end_parent": ("badlands_loop", False, nbs_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "island_harbor_loop",
            "name": "Barrier Island Cove Loop",
            "type": "narrow",
            "closed": False,
            "raw": island_harbor_raw,
            "trimmed": island_harbor_trim,
            "start_parent": ("island_causeway", False, ihl_s_info),
            "end_parent": ("island_causeway", False, ihl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "alpine_fjord_link",
            "name": "Snow Pine Valley Link",
            "type": "narrow",
            "closed": False,
            "raw": alpine_fjord_raw,
            "trimmed": alpine_fjord_trim,
            "start_parent": ("hwy_west", False, afl_s_info),
            "end_parent": ("hwy_north", False, afl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "town_roundabout",
            "name": "Midtown Plaza Roundabout",
            "type": "secondary",
            "closed": True,
            "raw": town_rb_raw,
            "trimmed": town_rb_raw,
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "town_east_ave",
            "name": "Festival Boulevard West",
            "type": "narrow",
            "closed": False,
            "raw": town_east_raw,
            "trimmed": town_east_trim,
            "start_parent": ("town_roundabout", True, tea_s_info),
            "end_parent": ("hwy", True, tea_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "paddock_east_ave",
            "name": "Festival Paddock Avenue",
            "type": "narrow",
            "closed": False,
            "raw": paddock_east_raw,
            "trimmed": paddock_east_trim,
            "start_parent": ("hwy", True, pea_s_info),
            "end_parent": ("emerald_bypass", False, pea_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "river_gorge_link",
            "name": "Emerald Gorge Crosstown",
            "type": "narrow",
            "closed": False,
            "raw": river_gorge_link_raw,
            "trimmed": river_gorge_link_trim,
            "start_parent": ("emerald_bypass", False, rgl_s_info),
            "end_parent": ("river_run", False, rgl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "town_north_st",
            "name": "North Midtown Underpass St",
            "type": "narrow",
            "closed": False,
            "raw": town_north_raw,
            "trimmed": town_north_trim,
            "start_parent": ("town_roundabout", True, tns_s_info),
            "end_parent": ("hwy", True, tns_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "town_south_st",
            "name": "South Midtown Street",
            "type": "narrow",
            "closed": False,
            "raw": town_south_raw,
            "trimmed": town_south_trim,
            "start_parent": ("town_roundabout", True, tss_s_info),
            "end_parent": ("canyon_cut", False, tss_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "south_meadow_lane",
            "name": "South Meadow Backstreet",
            "type": "narrow",
            "closed": False,
            "raw": south_meadow_raw,
            "trimmed": south_meadow_trim,
            "start_parent": ("canyon_cut", False, sml_s_info),
            "end_parent": ("hwy", True, sml_e_info),
            "bridge_ranges": [
                (-205.0, -125.0, -330.0, -240.0),  # South Meadow Overpass Bridge OVER hwy
            ],
            "tunnel_range": None,
        },
        {
            "id": "town_west_ave",
            "name": "Midtown West Underpass Loop",
            "type": "narrow",
            "closed": False,
            "raw": town_west_raw,
            "trimmed": town_west_trim,
            "start_parent": ("town_roundabout", True, twl_s_info),
            "end_parent": ("town_north_st", False, twl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "harbor_roundabout",
            "name": "Emerald Harbor Marina Rotary",
            "type": "secondary",
            "closed": True,
            "raw": harbor_rb_raw,
            "trimmed": harbor_rb_raw,
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "harbor_quay_w",
            "name": "West Marina Boardwalk",
            "type": "narrow",
            "closed": False,
            "raw": harbor_quay_w_raw,
            "trimmed": harbor_quay_w_trim,
            "start_parent": ("coastal_loop", False, hqw_s_info),
            "end_parent": ("harbor_roundabout", True, hqw_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "harbor_quay_e",
            "name": "East Marina Boardwalk",
            "type": "narrow",
            "closed": False,
            "raw": harbor_quay_e_raw,
            "trimmed": harbor_quay_e_trim,
            "start_parent": ("harbor_roundabout", True, hqe_s_info),
            "end_parent": ("island_causeway", False, hqe_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "harbor_sky_flyover",
            "name": "Harbor Interchange Flyover",
            "type": "secondary",
            "closed": False,
            "raw": harbor_fly_raw,
            "trimmed": harbor_fly_trim,
            "start_parent": ("harbor_roundabout", True, hfl_s_info),
            "end_parent": ("coastal_loop", False, hfl_e_info),
            "bridge_ranges": [
                (195.0, 275.0, -785.0, -705.0),  # Flyover Bridge OVER Coastal Loop
            ],
            "tunnel_range": None,
        },
        {
            "id": "emerald_cove_overpass",
            "name": "East Valley Overpass Viaduct",
            "type": "narrow",
            "closed": False,
            "raw": emerald_cove_raw,
            "trimmed": emerald_cove_trim,
            "start_parent": ("east_ridge", False, ecv_s_info),
            "end_parent": ("river_run", False, ecv_e_info),
            "bridge_ranges": [
                (620.0, 725.0, -320.0, -230.0),  # Viaduct Bridge OVER Eastern Highway
                (380.0, 470.0, -245.0, -175.0),  # River Gorge Bridge OVER Emerald River
            ],
            "tunnel_range": None,
        },
        {
            "id": "autumn_timber_hwy",
            "name": "Outer Autumn Timberland Expressway",
            "type": "highway",
            "closed": False,
            "raw": autumn_timber_raw,
            "trimmed": autumn_timber_trim,
            "start_parent": ("hwy_north", False, ath_s_info),
            "end_parent": ("volcano_ridge", False, ath_e_info),
            "bridge_ranges": [
                (1450.0, 1595.0, 885.0, 975.0),   # Autumn Tarn Lake Cove Bridge
                (1515.0, 1615.0, 695.0, 795.0),   # Sawmill Viaduct OVER sawmill_lane
            ],
            "tunnel_range": None,
        },
        {
            "id": "sawmill_lane",
            "name": "Sawmill Hollow Woodland Lane",
            "type": "narrow",
            "closed": False,
            "raw": sawmill_raw,
            "trimmed": sawmill_trim,
            "start_parent": ("autumn_loop", False, smln_s_info),
            "end_parent": ("autumn_timber_hwy", False, smln_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "maple_creek_north",
            "name": "Maple Creek North Lane",
            "type": "narrow",
            "closed": False,
            "raw": maple_n_raw,
            "trimmed": maple_n_trim,
            "start_parent": ("autumn_timber_hwy", False, mpn_s_info),
            "end_parent": ("sawmill_lane", False, mpn_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "maple_creek_south",
            "name": "Maple Creek South Backroad",
            "type": "narrow",
            "closed": False,
            "raw": maple_s_raw,
            "trimmed": maple_s_trim,
            "start_parent": ("sawmill_lane", False, mps_s_info),
            "end_parent": ("volcano_ridge", False, mps_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "obsidian_coast_loop",
            "name": "Obsidian Basalt Sea-Cliff Loop",
            "type": "secondary",
            "closed": False,
            "raw": obsidian_coast_raw,
            "trimmed": obsidian_coast_trim,
            "start_parent": ("volcano_ridge", False, ocl_s_info),
            "end_parent": ("volcano_ridge", False, ocl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "lava_cove_overpass",
            "name": "Lava Cove Cliff Skybridge",
            "type": "narrow",
            "closed": False,
            "raw": lava_cove_raw,
            "trimmed": lava_cove_trim,
            "start_parent": ("volcano_ridge", False, lco_s_info),
            "end_parent": ("obsidian_coast_loop", False, lco_e_info),
            "bridge_ranges": [
                (1595.0, 1690.0, 115.0, 215.0),  # Lava Overpass OVER obsidian_coast_loop
            ],
            "tunnel_range": None,
        },
        {
            "id": "glacier_horizon_hwy",
            "name": "Glacier Horizon Outer Expressway",
            "type": "highway",
            "closed": False,
            "raw": glacier_hwy_raw,
            "trimmed": glacier_hwy_trim,
            "start_parent": ("hwy_north", False, ghwy_s_info),
            "end_parent": ("hwy_north", False, ghwy_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "ski_village_loop",
            "name": "Alpine Ski Chalet Streets",
            "type": "narrow",
            "closed": False,
            "raw": ski_village_raw,
            "trimmed": ski_village_trim,
            "start_parent": ("hwy_north", False, svl_s_info),
            "end_parent": ("glacier_horizon_hwy", False, svl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "glacier_corkscrew_bridge",
            "name": "Glacier Tarn Overpass Skyway",
            "type": "narrow",
            "closed": False,
            "raw": glacier_cork_raw,
            "trimmed": glacier_cork_trim,
            "start_parent": ("hwy_north", False, gcb_s_info),
            "end_parent": ("glacier_horizon_hwy", False, gcb_e_info),
            "bridge_ranges": [
                (-410.0, -300.0, 1190.0, 1290.0),  # Skyway Viaduct OVER ski_village_loop
            ],
            "tunnel_range": None,
        },
        {
            "id": "desert_roundabout",
            "name": "Red-Rock Mesa Junction Rotary",
            "type": "secondary",
            "closed": True,
            "raw": desert_rb_raw,
            "trimmed": desert_rb_raw,
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "mesa_rotary_link",
            "name": "East Mesa Crossroads",
            "type": "narrow",
            "closed": False,
            "raw": mesa_rotary_e_raw,
            "trimmed": mesa_rotary_e_trim,
            "start_parent": ("desert_roundabout", True, mre_s_info),
            "end_parent": ("west_mesa_rim", False, mre_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "badlands_rotary_west",
            "name": "West Badlands Rotary Connector",
            "type": "narrow",
            "closed": False,
            "raw": mesa_rotary_w_raw,
            "trimmed": mesa_rotary_w_trim,
            "start_parent": ("desert_roundabout", True, mrw_s_info),
            "end_parent": ("badlands_loop", False, mrw_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "outer_badlands_hwy",
            "name": "Painted Frontier Rim Expressway",
            "type": "highway",
            "closed": False,
            "raw": outer_badlands_raw,
            "trimmed": outer_badlands_trim,
            "start_parent": ("badlands_loop", False, obh_s_info),
            "end_parent": ("badlands_loop", False, obh_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "slot_canyon_run",
            "name": "Sandstone Slot Canyon Gorge",
            "type": "narrow",
            "closed": False,
            "raw": slot_canyon_raw,
            "trimmed": slot_canyon_trim,
            "start_parent": ("badlands_loop", False, scn_s_info),
            "end_parent": ("badlands_loop", False, scn_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "pueblo_overpass_link",
            "name": "Pueblo Rim Slot-Canyon Skybridge",
            "type": "narrow",
            "closed": False,
            "raw": pueblo_bridge_raw,
            "trimmed": pueblo_bridge_trim,
            "start_parent": ("badlands_loop", False, pbr_s_info),
            "end_parent": ("outer_badlands_hwy", False, pbr_e_info),
            "bridge_ranges": [
                (-1545.0, -1425.0, -135.0, -35.0),  # Red-Rock Skybridge OVER slot_canyon_run
            ],
            "tunnel_range": None,
        },
        {
            "id": "outer_atoll_express",
            "name": "Southern Coral Atolls Expressway",
            "type": "highway",
            "closed": False,
            "raw": outer_atoll_raw,
            "trimmed": outer_atoll_trim,
            "start_parent": ("island_harbor_loop", False, oat_s_info),
            "end_parent": ("island_causeway", False, oat_e_info),
            "bridge_ranges": [
                (900.0, 1020.0, -1370.0, -1040.0),  # East Atoll Overpass Viaduct + OVER atoll_village_loop
                (200.0, 720.0, -1575.0, -1450.0),   # Turquoise Sound Causeway Bridge
                (20.0, 320.0, -1380.0, -1120.0),    # West Atoll Ocean Causeway
            ],
            "tunnel_range": None,
        },
        {
            "id": "atoll_village_loop",
            "name": "Atoll Palms Village Loop",
            "type": "narrow",
            "closed": False,
            "raw": atoll_village_raw,
            "trimmed": atoll_village_trim,
            "start_parent": ("outer_atoll_express", False, avl_s_info),
            "end_parent": ("outer_atoll_express", False, avl_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "sw_atoll_pkwy",
            "name": "SW Sandbar Keys Parkway",
            "type": "secondary",
            "closed": False,
            "raw": sw_atoll_raw,
            "trimmed": sw_atoll_trim,
            "start_parent": ("coastal_loop", False, swa_s_info),
            "end_parent": ("outer_atoll_express", False, swa_e_info),
            "bridge_ranges": [
                (-640.0, -370.0, -985.0, -760.0),   # SW Sandbar Causeway Bridge
                (-520.0, -90.0, -1495.0, -1300.0),  # SW Coral Strait Causeway
            ],
            "tunnel_range": None,
        },
        {
            "id": "nw_frontier_hwy",
            "name": "NW Frontier Trans-Biome Hwy",
            "type": "highway",
            "closed": False,
            "raw": nw_frontier_raw,
            "trimmed": nw_frontier_trim,
            "start_parent": ("outer_badlands_hwy", False, nwf_s_info),
            "end_parent": ("glacier_horizon_hwy", False, nwf_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "badlands_glacier_pass",
            "name": "Mesa-Glacier Valley Pass",
            "type": "secondary",
            "closed": False,
            "raw": badlands_glacier_raw,
            "trimmed": badlands_glacier_trim,
            "start_parent": ("outer_badlands_hwy", False, bgp_s_info),
            "end_parent": ("glacier_horizon_hwy", False, bgp_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "alpine_autumn_hwy",
            "name": "Northern Alpine-Autumn Hwy",
            "type": "highway",
            "closed": False,
            "raw": alpine_autumn_raw,
            "trimmed": alpine_autumn_trim,
            "start_parent": ("glacier_horizon_hwy", False, aah_s_info),
            "end_parent": ("autumn_timber_hwy", False, aah_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "glacier_autumn_pass",
            "name": "Highland Tarn Border Pass",
            "type": "secondary",
            "closed": False,
            "raw": glacier_autumn_raw,
            "trimmed": glacier_autumn_trim,
            "start_parent": ("glacier_horizon_hwy", False, gap_s_info),
            "end_parent": ("autumn_timber_hwy", False, gap_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "east_bluff_coast",
            "name": "Eastern Cliffs Coastal Drive",
            "type": "secondary",
            "closed": False,
            "raw": east_bluff_raw,
            "trimmed": east_bluff_trim,
            "start_parent": ("sawmill_lane", False, ebc_s_info),
            "end_parent": ("obsidian_coast_loop", False, ebc_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "caldera_timber_pass",
            "name": "Obsidian-Autumn Ridge Link",
            "type": "narrow",
            "closed": False,
            "raw": caldera_timber_raw,
            "trimmed": caldera_timber_trim,
            "start_parent": ("autumn_timber_hwy", False, ctp_s_info),
            "end_parent": ("lava_cove_overpass", False, ctp_e_info),
            "bridge_ranges": [],
            "tunnel_range": None,
        },
        {
            "id": "se_reef_express",
            "name": "Volcanic-Coral Ocean Parkway",
            "type": "secondary",
            "closed": False,
            "raw": se_reef_raw,
            "trimmed": se_reef_trim,
            "start_parent": ("obsidian_coast_loop", False, sre_s_info),
            "end_parent": ("atoll_village_loop", False, sre_e_info),
            "bridge_ranges": [
                (1475.0, 1570.0, -685.0, -455.0),
                (1280.0, 1435.0, -1050.0, -855.0),
                (1120.0, 1212.0, -1322.0, -1190.0),
            ],
            "tunnel_range": None,
        },
        {
            "id": "obsidian_harbor_link",
            "name": "Obsidian-Harbor Causeway",
            "type": "secondary",
            "closed": False,
            "raw": obsidian_harbor_raw,
            "trimmed": obsidian_harbor_trim,
            "start_parent": ("obsidian_coast_loop", False, ohl_s_info),
            "end_parent": ("island_harbor_loop", False, ohl_e_info),
            "bridge_ranges": [
                (1220.0, 1315.0, -685.0, -480.0),
                (985.0, 1245.0, -880.0, -785.0),
            ],
            "tunnel_range": None,
        },
        {
            "id": "sw_desert_atoll_hwy",
            "name": "Sunset Coast Ocean Expressway",
            "type": "highway",
            "closed": False,
            "raw": sw_desert_atoll_raw,
            "trimmed": sw_desert_atoll_trim,
            "start_parent": ("outer_badlands_hwy", False, sda_s_info),
            "end_parent": ("sw_atoll_pkwy", False, sda_e_info),
            "bridge_ranges": [
                (-1450.0, -1370.0, -980.0, -710.0),
                (-1055.0, -720.0, -1415.0, -1295.0),
            ],
            "tunnel_range": None,
        },
        {
            "id": "badlands_cove_drive",
            "name": "Sandstone-Lagoon Parkway",
            "type": "secondary",
            "closed": False,
            "raw": badlands_cove_raw,
            "trimmed": badlands_cove_trim,
            "start_parent": ("badlands_loop", False, bcd_s_info),
            "end_parent": ("sw_atoll_pkwy", False, bcd_e_info),
            "bridge_ranges": [
                (-1010.0, -750.0, -1100.0, -650.0),
            ],
            "tunnel_range": None,
        },
    ]

    # Pre-compute open_ranges per parent route so T-junction curbs open cleanly!
    open_ranges_by_id = {r["id"]: [] for r in routes_spec}
    for r in routes_spec:
        if "start_parent" in r:
            pid, _, (k_s, side_s) = r["start_parent"]
            open_ranges_by_id[pid].append((k_s, half_open_steps, side_s))
        if "end_parent" in r:
            pid, _, (k_e, side_e) = r["end_parent"]
            open_ranges_by_id[pid].append((k_e, half_open_steps, side_e))

    landmarks = [
        {
            "id": "festival",
            "name": "HORIZON FESTIVAL HUB",
            "type": "festival",
            "x": -48.0,
            "z": 0.0,
            "desc": "Central festival paddock & 4-lane expressway straightaway",
        },
        {
            "id": "alpine_tunnel",
            "name": "ALPINE SUMMIT TUNNEL",
            "type": "mountain",
            "x": -145.0,
            "z": -565.0,
            "desc": "High-altitude snowy peak rock bore (+54m elevation)",
        },
        {
            "id": "caldera_touge",
            "name": "STELVIO ALPINE TOUGE",
            "type": "mountain",
            "x": -510.0,
            "z": -305.0,
            "desc": "6-hairpin mountain climb reaching +71.5m snowy crest",
        },
        {
            "id": "red_rock_viaduct",
            "name": "RED-ROCK CANYON VIADUCT",
            "type": "overpass",
            "x": -782.0,
            "z": 195.0,
            "desc": "Twin-level desert expressway bridge above Canyon Gorge",
        },
        {
            "id": "emerald_lake",
            "name": "EMERALD RESERVOIR LAKE",
            "type": "scenic",
            "x": 545.0,
            "z": -125.0,
            "desc": "Vast highland reservoir cove & wooded island overlook",
        },
        {
            "id": "river_viaduct",
            "name": "RIVER GORGE SKYWAY VIADUCT",
            "type": "overpass",
            "x": 365.0,
            "z": 108.0,
            "desc": "Twin-level canyon bridge crossing above Emerald River Run",
        },
        {
            "id": "autumn_skybridge",
            "name": "AUTUMN HIGHLAND SKYBRIDGE",
            "type": "canyon",
            "x": 655.0,
            "z": -485.0,
            "desc": "Birch ridge overpass soaring above the Grand Expressway",
        },
        {
            "id": "suspension_bridge",
            "name": "OCEAN INLET SUSPENSION BRIDGE",
            "type": "bridge",
            "x": 285.0,
            "z": 580.0,
            "desc": "Twin-tower suspension span high over the southern inlet",
        },
        {
            "id": "golden_beach",
            "name": "GOLDEN BAY COASTAL DRIVE",
            "type": "speedway",
            "x": 165.0,
            "z": 745.0,
            "desc": "Palm-lined golden sandy peninsula & turquoise surf",
        },
        {
            "id": "east_viaduct",
            "name": "EAST CLIFFSIDE SKYBRIDGE",
            "type": "canyon",
            "x": 868.0,
            "z": 25.0,
            "desc": "Sheer +49m eastern escarpment piers & technical ridge road",
        },
        {
            "id": "northern_fjord",
            "name": "GLACIAL FJORD EXPRESS BRIDGE",
            "type": "bridge",
            "x": -10.0,
            "z": -1040.0,
            "desc": "Northern 4-lane expressway viaduct spanning the glacial fjord",
        },
        {
            "id": "obsidian_caldera",
            "name": "OBSIDIAN VOLCANIC CALDERA",
            "type": "mountain",
            "x": 1240.0,
            "z": -140.0,
            "desc": "Basalt volcanic crater rim (+58m) & geothermal crater lake",
        },
        {
            "id": "painted_badlands",
            "name": "PAINTED BADLANDS BUTTES",
            "type": "canyon",
            "x": -1255.0,
            "z": 120.0,
            "desc": "Towering terraced sandstone mesas & outer desert hairpins",
        },
        {
            "id": "tropical_islands",
            "name": "TROPICAL ARCHIPELAGO",
            "type": "speedway",
            "x": 580.0,
            "z": 1015.0,
            "desc": "Palm-fringed barrier islands & sweeping southern ocean causeway",
        },
        {
            "id": "fjord_hairpins",
            "name": "GLACIAL FJORD HAIRPINS",
            "type": "mountain",
            "x": -345.0,
            "z": -825.0,
            "desc": "Tight narrow alpine switchbacks plunging to the northern fjord",
        },
        {
            "id": "midtown_roundabout",
            "name": "MIDTOWN PLAZA ROTARY",
            "type": "festival",
            "x": -185.0,
            "z": 45.0,
            "desc": "Festival downtown traffic circle with 4-way boulevard & underpass streets",
        },
        {
            "id": "harbor_marina",
            "name": "EMERALD HARBOR MARINA",
            "type": "speedway",
            "x": 230.0,
            "z": 900.0,
            "desc": "Waterfront marina roundabout & coastal skyway flyover interchange",
        },
        {
            "id": "desert_rotary",
            "name": "DESERT MESA ROTARY",
            "type": "canyon",
            "x": -1055.0,
            "z": 245.0,
            "desc": "Sandstone traffic circle linking Mesa 4-way crossroads & Slot Canyon",
        },
        {
            "id": "slot_canyon_bridge",
            "name": "SLOT CANYON SKYBRIDGE",
            "type": "overpass",
            "x": -1490.0,
            "z": 85.0,
            "desc": "High red-rock viaduct crossing above the sunken Slot Canyon gorge",
        },
        {
            "id": "sawmill_hamlet",
            "name": "AUTUMN SAWMILL HAMLET",
            "type": "scenic",
            "x": 1160.0,
            "z": -700.0,
            "desc": "Golden maple 4-way forest crossroads & highland autumn lake overpass",
        },
        {
            "id": "alpine_ski_village",
            "name": "GLACIER SKI VILLAGE",
            "type": "mountain",
            "x": -355.0,
            "z": -1240.0,
            "desc": "Snowy alpine chalet lanes beneath the Glacier Tarn overpass viaduct",
        },
        {
            "id": "coral_atolls",
            "name": "OUTER CORAL ATOLLS",
            "type": "speedway",
            "x": 920.0,
            "z": 1310.0,
            "desc": "Southern barrier island expressway bridges, lagoon village & lighthouse",
        },
    ]

    return routes_spec, open_ranges_by_id, landmarks


# 72-sector (5 deg) mainland road perimeter radii around (0.0, 140.0), smoothed into a true island coastline
_RAW_MAINLAND_R = (
    1782.0, 1792.4, 1819.9, 1846.4, 1915.6, 2000.3, 2056.3, 2063.7, 1945.8, 1869.6, 1725.0, 1441.5,
    1495.1, 1503.5, 1502.5, 1490.7, 1468.3, 1416.8, 1426.3, 1448.7, 1471.2, 1495.9, 1519.5, 1539.1,
    1551.2, 1556.3, 1746.4, 1818.3, 1836.1, 1834.9, 1805.4, 1712.0, 1688.1, 1703.5, 1716.6, 1731.0,
    1750.2, 1774.2, 1793.4, 1797.9, 1797.9, 1782.5, 1623.6, 1236.9, 1115.4, 844.9, 709.1, 681.9,
    646.6, 623.8, 905.4, 927.2, 912.0, 897.8, 905.8, 866.8, 921.1, 949.6, 958.8, 969.4,
    975.8, 972.8, 824.3, 815.3, 962.0, 974.9, 919.0, 1346.2, 1664.4, 1734.4, 1738.6, 1780.8,
)


def _init_coast_radii():
    n = len(_RAW_MAINLAND_R)
    min_safe = [r + (74.0 if 44 <= i <= 66 else 92.0) for i, r in enumerate(_RAW_MAINLAND_R)]
    sm = min_safe[:]
    for _ in range(4):
        nxt = sm[:]
        for i in range(n):
            nxt[i] = 0.25 * sm[(i - 1) % n] + 0.50 * sm[i] + 0.25 * sm[(i + 1) % n]
            if nxt[i] < min_safe[i]:
                nxt[i] = min_safe[i]
        sm = nxt
    return tuple(sm)


_MAINLAND_COAST_RADII = _init_coast_radii()


def _eval_coast_radius(wx, wy):
    ang = math.atan2(wy - 140.0, wx)
    if ang < 0.0:
        ang += math.tau
    f = (ang / math.tau) * 72.0
    i0 = int(f) % 72
    i1 = (i0 + 1) % 72
    t = f - int(f)
    base_r = _MAINLAND_COAST_RADII[i0] * (1.0 - t) + _MAINLAND_COAST_RADII[i1] * t
    cove = 22.0 * math.sin(6.0 * ang + 0.4) + 14.0 * math.cos(11.0 * ang - 0.7) + 8.0 * math.sin(17.0 * ang)
    return base_r + max(-18.0, cove)


def natural_terrain_z(wx, wy):
    """
    Sculpted multi-biome true-island elevation function for the expanded 4.2km x 4.0km island world:
      1. NW Snowy Alpine Massif & Caldera Touge Peak (+74m to +78m)
      2. NE Golden Autumn Highlands & Ridge (+46m)
      3. Far-East Coastal Escarpment & Skybridge Cliffs (+52m)
      4. SW Monument Red-Rock Canyon & Desert Mesa (+28m bluffs + sunken canyon floor)
      5. Smooth Emerald Reservoir Lake (-12.5m) feeding Winding Emerald River Gorge to South Inlet
      6. Continuous Organic Island Coastline (~75-115m past outer roads) dropping into Ocean Sea (-10.8m)
      7. Southern Tropical Archipelago Barrier Islands & Outer Coral Atolls rising out of the sea
    """
    # 1. NW Snowy Alpine Massif & Touge Switchback Mountain (+74m peak, broad snow dome above +30m!)
    w_mtn = 66.0 * math.exp(-(((wx + 505.0) / 215.0) ** 2 + ((wy - 275.0) / 255.0) ** 2))
    nw_summit = 74.0 * math.exp(-(((wx + 195.0) / 210.0) ** 2 + ((wy - 565.0) / 145.0) ** 2))

    # 2. NE Golden Autumn Highlands & Broad Plateau (+22m..+44m cohesive highland region)
    ne_plateau_raw = 36.0 * math.exp(-(((wx - 535.0) / 270.0) ** 2 + ((wy - 585.0) / 195.0) ** 2))
    ne_highlands = min(43.0, ne_plateau_raw + 24.0 * math.exp(-(((wx - 635.0) / 170.0) ** 2 + ((wy - 645.0) / 135.0) ** 2)))
    ne_foothills = 21.0 * math.exp(-(((wx - 340.0) / 165.0) ** 2 + ((wy - 480.0) / 125.0) ** 2))

    # 3. Far-East Cliffside Escarpment (+48m)
    e_ridge = 47.0 * math.exp(-(((wx - 845.0) / 105.0) ** 2 + ((wy - 15.0) / 295.0) ** 2))

    # 4. SW Monument Red-Rock Desert Terraced Mesa Plateaus (cohesive across [-900..-220] x [-560..140])
    sw_mesa_s = min(25.0, 32.0 * math.exp(-(((wx + 695.0) / 185.0) ** 2 + ((wy + 405.0) / 140.0) ** 2)))
    sw_mesa_n = min(26.0, 34.0 * math.exp(-(((wx + 835.0) / 150.0) ** 2 + ((wy - 95.0) / 150.0) ** 2)))
    sw_butte = min(21.0, 26.0 * math.exp(-(((wx + 425.0) / 155.0) ** 2 + ((wy + 255.0) / 125.0) ** 2)))
    # Carve terraced step effect gently for red-rock canyon stratification
    sw_terrace_mask = smoothstep(-220.0, -450.0, wx) * smoothstep(140.0, -80.0, wy) * smoothstep(-620.0, -420.0, wy)
    sw_raw_total = sw_mesa_s + sw_mesa_n + sw_butte
    if sw_terrace_mask > 0.01 and sw_raw_total > 8.0:
        sw_stepped = 8.0 + 4.2 * math.floor((sw_raw_total - 8.0) / 4.2 + 0.5) * 0.35 + (sw_raw_total - 8.0) * 0.65
        sw_mesa_scale = sw_stepped / max(1e-4, sw_raw_total)
        sw_mesa_s *= sw_mesa_scale
        sw_mesa_n *= sw_mesa_scale
        sw_butte *= sw_mesa_scale

    # 5. Smooth, Decently Sized Emerald Reservoir Lake (Central-East X~562, Y~72)
    lake_cx = 562.0 + 10.0 * math.sin(wy / 90.0)
    lake_rx = 100.0 + 5.0 * math.cos(wy / 75.0)
    lake_d = ((wx - lake_cx) / lake_rx) ** 2 + ((wy - 72.0) / 152.0) ** 2
    lake_basin = -12.5 * math.exp(-lake_d * 1.28)

    # 6. Smooth Winding Emerald River Gorge (snakes seamlessly from Lake South End to Southern Ocean Inlet)
    t_riv = max(0.0, min(1.0, (wy - (-565.0)) / (72.0 - (-565.0))))
    riv_cx = 285.0 + 277.0 * (t_riv ** 1.08) + 12.0 * math.sin(wy / 82.0)
    riv_w = 38.0 + 4.0 * math.cos(wy / 68.0)
    riv_mask = smoothstep(-585.0, -525.0, wy) * (1.0 - smoothstep(15.0, 95.0, wy))
    riv_gorge = -11.5 * math.exp(-(((wx - riv_cx) / riv_w) ** 2)) * riv_mask

    # 7. Southern Ocean Inlet & Turquoise Coastal Lagoon (no isolated pond circle!)
    inlet = -12.0 * math.exp(-(((wx - 285.0) / 78.0) ** 2 + ((wy + 565.0) / 68.0) ** 2))
    lag_cy = -635.0 + 8.0 * math.sin(wx / 65.0)
    lag_ry = 44.0 + 5.5 * math.cos(wx / 72.0)
    lagoon = -10.0 * math.exp(-(((wx - 155.0) / 215.0) ** 2 + ((wy - lag_cy) / lag_ry) ** 2))

    # 8. Outer Expansion Biomes:
    #    a) Far-North Glacial Fjord Channel (-12m cohesive lake west of East junction) & Flanking Alpine Ridges
    fjord_cy = 1045.0 + 48.0 * math.sin(wx / 170.0)
    fjord_mask = smoothstep(-760.0, -520.0, wx) * (1.0 - smoothstep(95.0, 195.0, wx))
    fjord_channel = -12.0 * math.exp(-(((wy - fjord_cy) / 88.0) ** 2)) * fjord_mask
    fjord_ridge_n = 46.0 * math.exp(-(((wx + 120.0) / 480.0) ** 2 + ((wy - 1245.0) / 115.0) ** 2))
    fjord_ridge_nw = 52.0 * math.exp(-(((wx + 760.0) / 260.0) ** 2 + ((wy - 1010.0) / 220.0) ** 2))

    #    b) Far-East Obsidian Volcanic Caldera (+58m rim & dry basalt crater floor at +26m, no tiny water hole)
    caldera_r = math.hypot((wx - 1145.0) / 1.05, (wy - 115.0) / 1.25)
    volcano_cone = 56.0 * math.exp(-((caldera_r / 245.0) ** 2))
    caldera_bowl = -30.0 * math.exp(-((caldera_r / 92.0) ** 2.2))

    #    c) Far-West Painted Badlands Mesas (+34m..+38m) & Outer Slot Canyon Gorge
    badlands_s = min(30.0, 36.0 * math.exp(-(((wx + 1180.0) / 210.0) ** 2 + ((wy + 260.0) / 215.0) ** 2)))
    badlands_n = min(32.0, 38.0 * math.exp(-(((wx + 1190.0) / 195.0) ** 2 + ((wy - 255.0) / 215.0) ** 2)))
    badlands_outer_w = min(29.0, 34.0 * math.exp(-(((wx + 1630.0) / 210.0) ** 2 + ((wy - 45.0) / 520.0) ** 2)))
    slot_cx = -1480.0 + 25.0 * math.sin(wy / 120.0)
    slot_mask = smoothstep(-520.0, -340.0, wy) * (1.0 - smoothstep(260.0, 420.0, wy))
    slot_gorge = -18.0 * math.exp(-(((wx - slot_cx) / 48.0) ** 2)) * slot_mask

    #    d) Outer North Glacier Wall, Alpine Tarn, NE Autumn Highlands & Obsidian Peninsula
    glacier_wall = 48.0 * math.exp(-(((wx + 420.0) / 560.0) ** 2 + ((wy - 1495.0) / 175.0) ** 2))
    nw_ridge_saddle = 24.0 * math.exp(-(((wx + 1370.0) / 260.0) ** 2 + ((wy - 1030.0) / 220.0) ** 2))
    ne_alpine_ridge = 22.0 * math.exp(-(((wx - 470.0) / 235.0) ** 2 + ((wy - 1465.0) / 175.0) ** 2))
    east_cliff_ridge = 15.0 * math.exp(-(((wx - 1745.0) / 145.0) ** 2 + ((wy - 365.0) / 205.0) ** 2))
    alpine_tarn = -14.0 * math.exp(-(((wx - 115.0) / 95.0) ** 2 + ((wy - 1330.0) / 72.0) ** 2))
    autumn_outer = 34.0 * math.exp(-(((wx - 1295.0) / 420.0) ** 2 + ((wy - 1180.0) / 360.0) ** 2))
    autumn_lake = -18.0 * math.exp(-(((wx - 1375.0) / 125.0) ** 2 + ((wy - 980.0) / 105.0) ** 2))
    obsidian_pen = 30.0 * math.exp(-(((wx - 1575.0) / 220.0) ** 2 + ((wy - 25.0) / 290.0) ** 2))
    harbor_peninsula = 9.5 * math.exp(-(((wx - 150.0) / 115.0) ** 2 + ((wy + 715.0) / 85.0) ** 2))

    hills = 2.8 + 2.2 * math.sin(wx / 82.0) * math.cos(wy / 82.0) + 1.1 * math.sin((wx + wy) / 56.0)

    mainland_z = (
        w_mtn
        + nw_summit
        + ne_highlands
        + ne_foothills
        + e_ridge
        + sw_mesa_s
        + sw_mesa_n
        + sw_butte
        + lake_basin
        + riv_gorge
        + inlet
        + lagoon
        + fjord_channel
        + fjord_ridge_n
        + fjord_ridge_nw
        + volcano_cone
        + caldera_bowl
        + badlands_s
        + badlands_n
        + badlands_outer_w
        + slot_gorge
        + glacier_wall
        + nw_ridge_saddle
        + ne_alpine_ridge
        + east_cliff_ridge
        + alpine_tarn
        + autumn_outer
        + autumn_lake
        + obsidian_pen
        + harbor_peninsula
        + hills
    )

    # 9. Smooth Island Coastline Transition: water surrounds the entire island cleanly on ALL 4 sides
    r_sea = math.hypot(wx, wy - 140.0)
    r_coast = _eval_coast_radius(wx, wy)
    t_sea = smoothstep(-10.0, 125.0, r_sea - r_coast)
    ocean_floor = -10.8 + 0.5 * math.sin(wx / 110.0) * math.cos(wy / 110.0)
    base_z = mainland_z * (1.0 - t_sea) + ocean_floor * t_sea

    # 10. Southern Tropical Archipelago Barrier Islands, Marina Cay & Outer Coral Atolls rising above sea floor
    harbor_marina_cay = 15.2 * math.exp(-(((wx - 228.0) / 135.0) ** 2 + ((wy + 895.0) / 96.0) ** 2))
    isl_1 = 19.0 * math.exp(-(((wx - 555.0) / 195.0) ** 2 + ((wy + 1045.0) / 135.0) ** 2))
    isl_cove = 17.0 * math.exp(-(((wx - 745.0) / 170.0) ** 2 + ((wy + 985.0) / 145.0) ** 2))
    isl_2 = 20.0 * math.exp(-(((wx - 865.0) / 175.0) ** 2 + ((wy + 785.0) / 165.0) ** 2))
    se_reef_island = 20.0 * math.exp(-(((wx - 1395.0) / 205.0) ** 2 + ((wy + 755.0) / 145.0) ** 2))
    se_south_cay = 17.5 * math.exp(-(((wx - 1225.0) / 150.0) ** 2 + ((wy + 1095.0) / 115.0) ** 2))
    sw_atoll = 21.0 * math.exp(-(((wx + 660.0) / 225.0) ** 2 + ((wy + 1185.0) / 155.0) ** 2))
    sw_sunset_island = 20.0 * math.exp(-(((wx + 1235.0) / 215.0) ** 2 + ((wy + 1055.0) / 145.0) ** 2))
    sw_cay = 17.0 * math.exp(-(((wx + 975.0) / 145.0) ** 2 + ((wy + 1275.0) / 105.0) ** 2))
    south_atoll_w = 21.5 * math.exp(-(((wx - 95.0) / 245.0) ** 2 + ((wy + 1415.0) / 150.0) ** 2))
    south_atoll_e = 22.0 * math.exp(-(((wx - 935.0) / 275.0) ** 2 + ((wy + 1375.0) / 175.0) ** 2))

    islands_z = (
        harbor_marina_cay
        + isl_1
        + isl_cove
        + isl_2
        + se_reef_island
        + se_south_cay
        + sw_atoll
        + sw_sunset_island
        + sw_cay
        + south_atoll_w
        + south_atoll_e
    )

    return base_z + islands_z
