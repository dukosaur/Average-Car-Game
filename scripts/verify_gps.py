#!/usr/bin/env python3
import sys
import os
import time
import json
import socket
import base64
import urllib.request
import subprocess

def run_chrome_session():
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    port = 9223
    proc = subprocess.Popen([
        chrome_bin,
        "--headless=new",
        "--use-gl=angle",
        f"--remote-debugging-port={port}",
        "--window-size=1280,720",
        "http://localhost:5173/"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        targets = None
        start_t = time.time()
        while time.time() - start_t < 12.0:
            try:
                req = urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2)
                targets = json.loads(req.read().decode())
                if targets:
                    break
            except Exception:
                time.sleep(0.4)

        if not targets:
            print("Could not connect to Chrome DevTools")
            return

        time.sleep(4.0)

        page = next((t for t in targets if "localhost:5173" in t.get("url", "")), None)
        if not page:
            print("Target localhost:5173 page not found")
            return

        ws_url = page["webSocketDebuggerUrl"]
        host_port_path = ws_url.replace("ws://", "")
        host_port, path = host_port_path.split("/", 1)
        path = "/" + path
        h_host, h_port = host_port.split(":")

        sock = socket.create_connection((h_host, int(h_port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host_port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(handshake.encode())
        resp = sock.recv(4096)
        if b"101" not in resp:
            print("Handshake failed:", resp)
            return

        def eval_js(msg_id, code):
            payload = json.dumps({"id": msg_id, "method": "Runtime.evaluate", "params": {"expression": code, "returnByValue": True, "awaitPromise": True}}).encode()
            mask = os.urandom(4)
            masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            length = len(payload)
            if length < 126:
                header = bytes([0x81, 0x80 | length]) + mask
            else:
                header = bytes([0x81, 0x80 | 126, (length >> 8) & 0xff, length & 0xff]) + mask
            sock.sendall(header + masked)
            time.sleep(1.0)
            try:
                res = sock.recv(16384)
                print(f"Eval {msg_id} response:", res.decode('utf-8', errors='ignore')[:300])
            except Exception as e:
                pass

        def take_screenshot(msg_id, filename):
            payload = json.dumps({"id": msg_id, "method": "Page.captureScreenshot"}).encode()
            mask = os.urandom(4)
            masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            length = len(payload)
            if length < 126:
                header = bytes([0x81, 0x80 | length]) + mask
            else:
                header = bytes([0x81, 0x80 | 126, (length >> 8) & 0xff, length & 0xff]) + mask
            sock.sendall(header + masked)
            
            raw_data = bytearray()
            sock.settimeout(10.0)
            start_recv = time.time()
            while time.time() - start_recv < 8.0:
                try:
                    chunk = sock.recv(65536)
                    if chunk:
                        raw_data.extend(chunk)
                        if b'"data":"' in raw_data and raw_data.endswith(b'}'):
                            break
                except socket.timeout:
                    break

            try:
                idx = raw_data.find(b'"data":"')
                if idx != -1:
                    b64_start = idx + 8
                    b64_end = raw_data.find(b'"', b64_start)
                    b64_str = raw_data[b64_start:b64_end].decode()
                    img_bytes = base64.b64decode(b64_str)
                    with open(filename, "wb") as f:
                        f.write(img_bytes)
                    print(f"Successfully saved {filename} ({len(img_bytes)} bytes)")
            except Exception as e:
                print(f"Error parsing screenshot: {e}")

        # Step 1: Open map and set waypoint to Caldera Touge
        js_map = """
        (function() {
            window.__worldMap.setOpen(true);
            window.__worldMap.setGpsWaypoint(-252, -118, 'LA GRAN CALDERA TOUGE', 'mountain');
            window.__worldMap.centerOnWorld(-120, -20, 0.95);
            return {
                open: window.__worldMap.isOpen,
                waypoint: window.__gpsNav.activeWaypoint,
                pathLength: window.__gpsNav.activePath.length,
                remainingDist: window.__gpsNav.remainingDistance
            };
        })()
        """
        eval_js(10, js_map)
        time.sleep(1.5)
        take_screenshot(11, "verified_forza_gps_map_route.png")

        # Step 2: Close map and verify 3D in-game chevrons
        js_game = """
        (function() {
            window.__worldMap.setOpen(false);
            return {
                open: window.__worldMap.isOpen,
                chevronCount: window.__gpsNav.chevronsMesh.count,
                waypoint: window.__gpsNav.activeWaypoint.name,
                carPos: [window.__vehicle.rootGroup.position.x, window.__vehicle.rootGroup.position.y, window.__vehicle.rootGroup.position.z]
            };
        })()
        """
        eval_js(20, js_game)
        time.sleep(1.5)
        take_screenshot(21, "verified_forza_gps_3d_chevrons.png")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    run_chrome_session()
