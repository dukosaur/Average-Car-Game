#!/usr/bin/env python3
"""
Extracts all 11 drivable spline routes, overpass bridges, viaducts, Alpine tunnel, and POIs
from the shared `world_layout.py` single source of truth into `public/assets/map_routes.json`
for the interactive World Map, GPS A* Navigation, and Radar Mini-Map.
"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from world_layout import (
    WORLD_BOUNDS,
    closest_sample_index,
    compute_road_network,
)


def to_three(v):
    """Blender (x, y, z_up) -> Three.js (x, y_up, z_south = -y)."""
    return [round(float(v.x), 3), round(float(v.z), 3), round(float(-v.y), 3)]


def connect_to_parents(trimmed_samples, start_parent, start_info, end_parent, end_info):
    """Build exact 2D centerline from trimmed branch samples + exact parent junction anchor points."""
    ks, _ = start_info
    ke, _ = end_info
    p_start = start_parent[ks][0]
    p_end = end_parent[ke][0]
    pts = [p_start] + [s[0] for s in trimmed_samples] + [p_end]
    return [to_three(p) for p in pts]


def extract_and_save():
    routes_spec, _open_ranges, landmarks = compute_road_network(step_len=2.5)
    samples_by_id = {
        r["id"]: (r["raw"] if r["closed"] else r["trimmed"])
        for r in routes_spec
    }

    out_routes = []
    bridge_counter = 1

    for r in routes_spec:
        rid = r["id"]
        if r.get("start_parent") and r.get("end_parent"):
            sp_id, _sp_closed, sp_info = r["start_parent"]
            ep_id, _ep_closed, ep_info = r["end_parent"]
            pts = connect_to_parents(
                r["trimmed"],
                samples_by_id[sp_id],
                sp_info,
                samples_by_id[ep_id],
                ep_info,
            )
        else:
            pts = [to_three(s[0]) for s in r["raw"]]

        out_routes.append({
            "id": rid,
            "name": r["name"],
            "type": r["type"],
            "closed": bool(r["closed"]),
            "layer": "ground",
            "points": pts,
        })

    # Emit elevated bridge spans for crisp drop-shadow overpass rendering on the 2D vector map
    for r in routes_spec:
        br_samples = r["raw"] if r["closed"] else r["trimmed"]
        for xmin, xmax, ymin, ymax in r.get("bridge_ranges", []):
            span_pts = [
                to_three(s[0])
                for s in br_samples
                if xmin <= s[0].x <= xmax and ymin <= s[0].y <= ymax
            ]
            if len(span_pts) >= 2:
                out_routes.append({
                    "id": f"overpass_bridge_{bridge_counter}",
                    "name": f"{r['name']} Bridge {bridge_counter}",
                    "type": "bridge_elevated",
                    "road_type": r["type"],
                    "closed": False,
                    "layer": "elevated",
                    "points": span_pts,
                })
                bridge_counter += 1

        if r.get("tunnel_range"):
            txmin, txmax, tymin, tymax = r["tunnel_range"]
            tunnel_pts = [
                to_three(s[0])
                for s in r["raw"]
                if txmin <= s[0].x <= txmax and tymin <= s[0].y <= tymax
            ]
            if len(tunnel_pts) >= 2:
                out_routes.append({
                    "id": "alpine_tunnel",
                    "name": "Alpine Summit Mountain Tunnel",
                    "type": "tunnel",
                    "closed": False,
                    "layer": "tunnel",
                    "points": tunnel_pts,
                })

    out_data = {
        "world_bounds": dict(WORLD_BOUNDS),
        "image": {
            "width": 2048,
            "height": 1920,
            "url": "/assets/satellite_world_map.png",
        },
        "routes": out_routes,
        "landmarks": landmarks,
    }

    out_path = os.path.abspath("public/assets/map_routes.json")
    serialized = json.dumps(out_data, indent=2)
    with open(out_path, "w") as f:
        f.write(serialized)
    print(f"Exported {len(routes_spec)} routes + {bridge_counter - 1} bridges + tunnel + {len(landmarks)} POIs -> {out_path} ({len(serialized)} bytes)")


if __name__ == "__main__":
    extract_and_save()
