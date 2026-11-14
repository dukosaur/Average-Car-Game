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
    "span_x": 1800.0,
    "span_z": 1687.5,
    "min_x": -900.0,
    "max_x": 900.0,
    "min_z": -843.75,
    "max_z": 843.75,
}

TERRAIN_MIN_X = -980.0
TERRAIN_MAX_X = 980.0
TERRAIN_MIN_Y = -920.0
TERRAIN_MAX_Y = 920.0
TERRAIN_GRID_STEP = 8.0


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
    blend_dist = min(32.0, 0.35 * total_len)

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


def snap_ctrl_endpoints_z(ctrl_pts, start_poly=None, end_poly=None):
    """Align first/last control point Z to final smoothed parent splines before Z smoothing."""
    if start_poly is not None:
        _, zs = dist_to_polyline_2d(ctrl_pts[0].x, ctrl_pts[0].y, start_poly)
        ctrl_pts[0] = Vector((ctrl_pts[0].x, ctrl_pts[0].y, zs))
    if end_poly is not None:
        _, ze = dist_to_polyline_2d(ctrl_pts[-1].x, ctrl_pts[-1].y, end_poly)
        ctrl_pts[-1] = Vector((ctrl_pts[-1].x, ctrl_pts[-1].y, ze))
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
        Vector((475.0, 575.0, 22.5)),    # Junc: autumn_loop_start
        Vector((625.0, 470.0, 16.0)),    # Passed OVER by autumn_loop Overpass (+31.2m)
        Vector((690.0, 330.0, 11.5)),    # Junc: east_ridge_end
        Vector((752.0, 185.0, 11.5)),    # East Valley Fast S-Chicane
        Vector((688.0, 45.0, 10.5)),
        Vector((755.0, -85.0, 12.2)),
        Vector((715.0, -195.0, 13.8)),   # Junc: overpass_end
        Vector((625.0, -355.0, 18.5)),   # Junc: east_ridge_start
        Vector((515.0, -495.0, 22.8)),   # Junc: coastal_loop_end
        Vector((380.0, -552.0, 25.5)),   # Grand Ocean Suspension Bridge East Tower
        Vector((190.0, -550.0, 25.0)),   # Grand Ocean Suspension Bridge West Tower
        Vector((55.0, -530.0, 18.8)),    # Junc: river_run_start
        Vector((-135.0, -495.0, 11.5)),  # Junc: coastal_loop_start
        Vector((-220.0, -385.0, 5.2)),   # Junc: hwy_west_start
        Vector((-155.0, -305.0, 2.8)),   # Southwest Return Chicane
        Vector((-70.0, -270.0, 0.8)),
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
        Vector((-220.0, -385.0, 5.2)),
        Vector((-365.0, -415.0, 9.2)),
        Vector((-535.0, -368.0, 12.2)),  # Junc: west_mesa_rim_start
        Vector((-675.0, -295.0, 16.8)),
        Vector((-740.0, -195.0, 21.5)),  # Red-Rock Canyon Viaduct Bridge OVER canyon_cut (+6.0m -> 15.5m!)
        Vector((-775.0, -90.0, 17.5)),
        Vector((-768.0, -15.0, 15.0)),   # Junc: touge_start
        Vector((-738.0, 145.0, 17.5)),
        Vector((-778.0, 295.0, 21.0)),   # Junc: west_mesa_rim_end
        Vector((-695.0, 485.0, 26.5)),
        Vector((-545.0, 650.0, 29.0)),
        Vector((-365.0, 745.0, 31.5)),   # Northern Alpine Pass Sweeper
        Vector((-175.0, 675.0, 27.0)),
        Vector((25.0, 730.0, 28.5)),
        Vector((175.0, 655.0, 24.5)),
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
            Vector((-534.0, 24.0, 20.6)),
            Vector((-558.0, 50.0, 21.6)),
            Vector((-588.0, 52.0, 22.4)),
        ]
        + arc_ctrl_pts(-595.0, 82.0, 30.0, 270.0, 90.0, 22.8, 28.5, count=7)
        + [Vector((-525.0, 113.0, 29.8)), Vector((-485.0, 116.0, 30.8))]
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
            Vector((-40.0, 525.0, 42.5)),    # Alpine Tunnel East Portal
        ]
        + arc_ctrl_pts(18.0, 515.0, 37.0, 90.0, -90.0, 36.0, 29.0, count=7)
        + [Vector((-15.0, 480.0, 26.2))]
        + arc_ctrl_pts(-48.0, 448.0, 33.0, 90.0, 270.0, 23.0, 17.0, count=7)
        + [
            Vector((-2.0, 422.0, 14.2)),
            Vector((38.0, 444.0, 12.2)),
            Vector((68.0, 434.0, 10.8)),
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
        Vector((-512.0, -28.0, 18.5)),
        Vector((-435.0, 22.0, 17.5)),
        Vector((-325.0, 18.0, 16.0)),
        Vector((-195.0, 118.0, 15.2)),
        Vector((-85.0, 148.0, 15.4)),
        Vector((0.0, 150.0, 15.6)),       # Overpass Bridge 1 OVER Main Highway (Z=0.0 -> 15.6m clearance!)
        Vector((135.0, 130.0, 14.0)),    # Junc: valley_start
        Vector((210.0, 55.0, 15.5)),
        Vector((255.0, -35.0, 18.5)),
        Vector((365.0, -80.0, 21.0)),    # Overpass Bridge 2 OVER River Gorge & River Run (Z=2.5m -> 18.5m!)
        Vector((485.0, -108.0, 16.5)),
        Vector((565.0, -215.0, 14.5)),
        Vector((662.0, -168.0, 14.0)),
        Vector((715.0, -195.0, 13.8)),
    ], touge_trim, hwy_raw)
    overpass_raw = sample_smooth_3d_curve(overpass_ctrl, step_len=step_len, closed=False)
    overpass_raw = smooth_spline_z(
        overpass_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (
            (-15.0 <= p.x <= 15.0 and 138.0 <= p.y <= 162.0)
            or (345.0 <= p.x <= 385.0 and -95.0 <= p.y <= -65.0)
        ),
    )
    overpass_trim, over_s_info, over_e_info = trim_branch_for_fillet(
        overpass_raw, touge_trim, 5.4, False, hwy_raw, 7.6, True, fillet_dist=7.0
    )

    # 5. EMERALD RIVER CANYON & LAKEFRONT RUN (2-Lane Secondary)
    river_run_ctrl = snap_ctrl_endpoints_z([
        Vector((55.0, -530.0, 18.8)),
        Vector((88.0, -478.0, 15.2)),
        Vector((122.0, -432.0, 11.4)),
        Vector((142.0, -390.0, 7.8)),    # Smooth River Bend S-Curve
        Vector((200.0, -345.0, 4.5)),
        Vector((248.0, -210.0, 2.4)),
        Vector((365.0, -80.0, 2.5)),     # Drives UNDER Overpass Bridge 2 (+21.0m vs +2.5m!)
        Vector((352.0, 62.0, 3.4)),      # Lakeside Drift S-Chicane
        Vector((438.0, 165.0, 4.6)),
        Vector((442.0, 275.0, 5.8)),     # Junc: autumn_loop_end
        Vector((392.0, 415.0, 12.8)),
        Vector((415.0, 488.0, 18.2)),
        Vector((368.0, 536.0, 21.4)),
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
            Vector((-188.0, -552.0, 7.5)),   # Western Cove Bluff Descent
            Vector((-168.0, -608.0, 4.8)),
            Vector((-140.0, -652.0, 3.3)),
            Vector((-162.0, -694.0, 2.5)),
        ]
        + arc_ctrl_pts(-198.0, -732.0, 30.0, 70.0, 270.0, 2.2, 2.0, count=5)
        + [
            Vector((-135.0, -762.0, 2.0)),
            Vector((-75.0, -752.0, 2.0)),    # Golden Beachfront Drive
            Vector((115.0, -702.0, 2.0)),    # Harbor Lagoon Chicane
            Vector((275.0, -752.0, 2.2)),
            Vector((455.0, -705.0, 5.4)),
            Vector((545.0, -662.0, 10.4)),   # Smooth Palm Peninsula Hairpin Climb
            Vector((578.0, -612.0, 14.6)),
            Vector((555.0, -562.0, 18.2)),
            Vector((544.0, -532.0, 21.0)),
            Vector((515.0, -495.0, 22.8)),
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
            Vector((625.0, -355.0, 18.5)),
            Vector((695.0, -408.0, 21.0)),
            Vector((758.0, -422.0, 22.6)),
        ]
        + arc_ctrl_pts(780.0, -392.0, 30.0, -90.0, 90.0, 23.2, 27.0, count=7)
        + [Vector((750.0, -360.0, 28.0))]
        + arc_ctrl_pts(735.0, -330.0, 30.0, 270.0, 90.0, 28.6, 32.2, count=7)
        + [
            Vector((810.0, -288.0, 35.4)),
            Vector((855.0, -175.0, 46.5)),   # Elevated Cliffside Viaduct South Overlook
            Vector((838.0, -25.0, 51.0)),    # Highest Eastern Cliff Escarpment (+51.0m!)
            Vector((852.0, 125.0, 47.5)),    # Overlooking the Giant Emerald Reservoir Lake
            Vector((822.0, 255.0, 31.5)),
            Vector((785.0, 295.0, 26.2)),    # Smooth Northern Cliff Descent S-Curve
            Vector((768.0, 332.0, 18.5)),
            Vector((734.0, 346.0, 13.0)),
            Vector((690.0, 330.0, 11.5)),
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
        Vector((-325.0, -118.0, 3.8)),
        Vector((-208.0, -172.0, 2.2)),
        Vector((-102.0, -104.0, 0.6)),
        Vector((0.0, -100.0, 0.0)),
    ]

    # 10. WESTERN DESERT MESA & BLUFF RIM (2-Lane Secondary)
    west_mesa_ctrl = snap_ctrl_endpoints_z([
        Vector((-535.0, -368.0, 12.2)),
        Vector((-595.0, -455.0, 14.5)),
        Vector((-702.0, -434.0, 16.5)),  # Smooth Desert Bluff Hairpin Chicane!
        Vector((-762.0, -485.0, 15.4)),
        Vector((-822.0, -468.0, 14.4)),
        Vector((-855.0, -365.0, 13.5)),
        Vector((-845.0, -205.0, 10.5)),  # Junc: canyon_cut_start
        Vector((-868.0, -45.0, 19.5)),
        Vector((-812.0, 95.0, 24.5)),
        Vector((-865.0, 222.0, 25.2)),   # High Desert Mesa Overlook (+25.2m)
        Vector((-832.0, 310.0, 22.8)),
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
        Vector((475.0, 575.0, 22.5)),
        Vector((494.0, 610.0, 23.2)),
        Vector((535.0, 678.0, 32.5)),
        Vector((615.0, 742.0, 41.5)),    # Autumn Highland Ridge Crest + Smooth Sweeper!
        Vector((705.0, 732.0, 42.5)),
        Vector((746.0, 672.0, 40.5)),
        Vector((704.0, 616.0, 38.0)),
        Vector((690.0, 562.0, 35.6)),
        Vector((706.0, 516.0, 33.8)),
        Vector((672.0, 484.0, 32.4)),
        Vector((625.0, 470.0, 31.2)),    # Elevated Autumn Overpass Bridge OVER hwy (+16.0m -> 15.2m gap!)
        Vector((555.0, 375.0, 19.5)),
        Vector((572.0, 332.0, 15.2)),    # Smooth Downhill Birch Forest S-Turn
        Vector((596.0, 288.0, 12.2)),
        Vector((568.0, 248.0, 9.6)),
        Vector((514.0, 258.0, 7.6)),
        Vector((442.0, 275.0, 5.8)),
    ], hwy_raw, river_run_trim)
    autumn_loop_raw = sample_smooth_3d_curve(autumn_loop_ctrl, step_len=step_len, closed=False)
    autumn_loop_raw = smooth_spline_z(
        autumn_loop_raw,
        closed=False,
        passes=z_passes,
        pin_fn=lambda p: (595.0 <= p.x <= 650.0 and 448.0 <= p.y <= 492.0),
    )
    autumn_loop_trim, aut_s_info, aut_e_info = trim_branch_for_fillet(
        autumn_loop_raw, hwy_raw, 7.6, True, river_run_trim, 5.4, False, fillet_dist=7.0
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
                (-72.0, 72.0, 120.0, 180.0),     # Bridge 1 OVER Main Highway
                (290.0, 475.0, -135.0, -20.0),   # Bridge 2 OVER River Gorge & River Run
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
                (800.0, 885.0, -240.0, 165.0),   # Elevated Eastern Cliffside Viaduct
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
                (595.0, 650.0, 448.0, 492.0),    # Autumn Ridge Overpass OVER hwy
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
    ]

    return routes_spec, open_ranges_by_id, landmarks


def natural_terrain_z(wx, wy):
    """
    Sculpted multi-biome natural terrain elevation function for the expanded 1800x1687m world:
      1. NW Snowy Alpine Massif & Caldera Touge Peak (+74m to +78m)
      2. NE Golden Autumn Highlands & Ridge (+46m)
      3. Far-East Coastal Escarpment & Skybridge Cliffs (+52m)
      4. SW Monument Red-Rock Canyon & Desert Mesa (+28m bluffs + sunken canyon floor)
      5. Huge Winding Emerald Reservoir Lake Basin (-11m) + Mid-Lake Island (+6m)
      6. Serpentine Emerald River Gorge (-10.5m) feeding the Southern Ocean Inlet
      7. Southern Golden Beaches, Turquoise Lagoon, Western Cove & Open Ocean Bay (-11m)
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

    # 5. Vast Emerald Reservoir Lake Basin (organic sinuous lake in Central-East X~555, Y~115) + Forested Island!
    lake_cx = 555.0 + 16.0 * math.sin(wy / 42.0) - 9.0 * math.cos(wy / 25.0)
    lake_rx = 74.0 + 10.0 * math.cos(wy / 36.0)
    lake_d = ((wx - lake_cx) / lake_rx) ** 2 + ((wy - 115.0) / 155.0) ** 2
    lake_basin = -12.0 * math.exp(-lake_d * 1.32)
    lake_island = 14.5 * math.exp(-(((wx - 552.0) / 24.0) ** 2 + ((wy - 125.0) / 36.0) ** 2))

    # 6. Winding Emerald River Gorge (snakes from Lake South End down to Southern Ocean Inlet)
    t_riv = max(0.0, min(1.0, (wy - (-565.0)) / (115.0 - (-565.0))))
    riv_cx = 285.0 + 270.0 * (t_riv ** 1.12) + 22.0 * math.sin(wy / 62.0)
    riv_w = 34.0 + 4.5 * math.cos(wy / 48.0)
    riv_mask = smoothstep(-585.0, -525.0, wy) * (1.0 - smoothstep(60.0, 130.0, wy))
    riv_gorge = -11.5 * math.exp(-(((wx - riv_cx) / riv_w) ** 2)) * riv_mask

    # 7. Southern Ocean Inlet, Turquoise Coastal Lagoon, Western Cove & Open Ocean Bay
    inlet = -12.0 * math.exp(-(((wx - 285.0) / 78.0) ** 2 + ((wy + 565.0) / 68.0) ** 2))
    lag_cy = -635.0 + 8.0 * math.sin(wx / 65.0)
    lag_ry = 44.0 + 5.5 * math.cos(wx / 72.0)
    lagoon = -10.0 * math.exp(-(((wx - 155.0) / 215.0) ** 2 + ((wy - lag_cy) / lag_ry) ** 2))
    west_cove = -8.5 * math.exp(-(((wx + 425.0) / 135.0) ** 2 + ((wy + 695.0) / 48.0) ** 2))
    ocean_south = -10.8 * smoothstep(-748.0, -805.0, wy + 12.0 * math.sin(wx / 88.0))

    # 8. Gentle rolling countryside hills (+2.6m baseline prevents unintended sub-sea meadow puddles) & outer rim
    hills = 2.6 + 2.4 * math.sin(wx / 82.0) * math.cos(wy / 82.0) + 1.2 * math.sin((wx + wy) / 56.0)
    rim = max(
        0.0,
        (-865.0 - wx) / 115.0,
        (wx - 880.0) / 115.0,
        (wy - 765.0) / 115.0,
    )
    h_rim = 32.0 * (rim ** 1.4) if rim > 0.0 else 0.0

    return (
        w_mtn
        + nw_summit
        + ne_highlands
        + ne_foothills
        + e_ridge
        + sw_mesa_s
        + sw_mesa_n
        + sw_butte
        + lake_basin
        + lake_island
        + riv_gorge
        + inlet
        + lagoon
        + west_cove
        + ocean_south
        + hills
        + h_rim
    )
