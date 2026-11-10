#!/usr/bin/env python3
import sys
import os
import time
import json
import socket
import base64
import urllib.request
import subprocess

def test_world_map():
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    port = 9227
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
        host_port, path = ws_url.replace("ws://", "").split("/", 1)
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
            time.sleep(0.8)
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
                        if b'"data":"' in raw_data and raw_data.endswith(b'"}'):
                            break
                except socket.timeout:
                    break

            try:
                raw_str = raw_data.decode('utf-8', errors='ignore')
                idx = raw_str.find('"data":"')
                if idx != -1:
                    end_idx = raw_str.rfind('"}')
                    b64 = raw_str[idx + 8:end_idx]
                    img_bytes = base64.b64decode(b64)
                    artifact_path = os.path.join(
                        "/Users/ashrit/.gemini/antigravity/brain/3b1d01af-931f-4e11-a2ea-117bc45b2fbd",
                        filename
                    )
                    with open(artifact_path, "wb") as f:
                        f.write(img_bytes)
                    print(f"Saved screenshot: {artifact_path} ({len(img_bytes)} bytes)")
            except Exception as ex:
                print("Screenshot decode error:", ex)

        # 1. Open Fullscreen World Map with default overview
        js_open_map = """
        (function() {
            const wm = window.__worldMap;
            if (wm) {
                wm.setOpen(true);
                return {
                    isOpen: wm.isOpen,
                    roadsGroupElCount: wm.roadsGroupEl ? wm.roadsGroupEl.children.length : 0,
                    controlsCard: !!document.getElementById('map-controls-card'),
                    topHudLeft: !!document.querySelector('.map-brand-badge')
                };
            }
            return { error: 'wm not found' };
        })()
        """
        eval_js(1, js_open_map)
        time.sleep(1.2)
        take_screenshot(2, "verified_world_map_new_ui.png")

        # 2. Zoom right into the overpass bridge intersection (world coordinates: X = 0, Z = -25)
        js_zoom_overpass = """
        (function() {
            const wm = window.__worldMap;
            if (wm) {
                wm.centerOnWorld(0, -25, 2.4);
                return {
                    panX: wm.panX,
                    panY: wm.panY,
                    scale: wm.scale
                };
            }
            return null;
        })()
        """
        eval_js(3, js_zoom_overpass)
        time.sleep(1.2)
        take_screenshot(4, "verified_overpass_bridge_clean.png")

        # 3. Click the bottom-left controls toggle button to test collapse feature
        js_toggle_controls = """
        (function() {
            const btn = document.getElementById('map-controls-toggle-btn');
            const card = document.getElementById('map-controls-card');
            if (btn && card) {
                btn.click();
                return {
                    isCollapsed: card.classList.contains('collapsed')
                };
            }
            return null;
        })()
        """
        eval_js(5, js_toggle_controls)
        time.sleep(0.8)
        take_screenshot(6, "verified_world_map_controls_collapsed.png")

        # 4. Open the pause menu to verify that the pause menu mini-map tile also looks flawless
        js_open_pause = """
        (function() {
            const wm = window.__worldMap;
            const pm = window.__pauseMenu;
            wm.setOpen(false);
            pm.setOpen(true);
            pm.updateFocusedTile(1); // focus world map tile
            return {
                isPauseOpen: pm.isOpen
            };
        })()
        """
        eval_js(7, js_open_pause)
        time.sleep(1.0)
        take_screenshot(8, "verified_pause_menu_with_clean_overpass.png")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    test_world_map()
