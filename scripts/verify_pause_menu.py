#!/usr/bin/env python3
import sys
import os
import time
import json
import socket
import base64
import urllib.request
import subprocess

def test_pause_menu():
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    port = 9226
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

        # Pass 0: Active Gameplay HUD (Clean Minimalism - verify only [ESC] Pause and speed telemetry)
        js_step0 = """
        (function() {
            const hudPrompt = document.getElementById('hud-pause-prompt');
            const oldHud = document.getElementById('hud');
            const oldGarage = document.getElementById('garage-backdrop');
            return {
                hasHudPrompt: !!hudPrompt,
                oldHudRemoved: !oldHud,
                oldGarageRemoved: !oldGarage,
                hudPromptVisible: hudPrompt && getComputedStyle(hudPrompt).display !== 'none'
            };
        })()
        """
        eval_js(0, js_step0)
        time.sleep(1.0)
        take_screenshot(1, "verified_hud_clean_minimalism.png")

        # Pass 1: Open Pause Menu (Default focused on Tile 1: World Map)
        js_step1 = """
        (function() {
            const pm = window.__pauseMenu;
            pm.setOpen(true);
            return {
                isOpen: pm.isOpen,
                currentView: pm.currentView,
                focusedTile: pm.focusedTileIndex,
                overlayVisible: !document.getElementById('pause-menu-overlay').classList.contains('hidden')
            };
        })()
        """
        eval_js(2, js_step1)
        time.sleep(1.0)
        take_screenshot(3, "verified_pause_menu_main.png")

        # Pass 2: Navigate focus to CARS & GARAGE tile (Tile 0)
        js_step2 = """
        (function() {
            const pm = window.__pauseMenu;
            pm.updateFocusedTile(0);
            return {
                focusedTile: pm.focusedTileIndex
            };
        })()
        """
        eval_js(4, js_step2)
        time.sleep(1.0)
        take_screenshot(5, "verified_pause_menu_garage_tile_focused.png")

        # Pass 3: Open Cars Showroom Subview
        js_step3 = """
        (function() {
            const pm = window.__pauseMenu;
            pm.showView('cars');
            return {
                currentView: pm.currentView,
                cardCount: document.querySelectorAll('.pause-car-card').length
            };
        })()
        """
        eval_js(6, js_step3)
        time.sleep(1.0)
        take_screenshot(7, "verified_pause_menu_cars_showroom.png")

        # Pass 4: Select Lamborghini Veneno (Index 1) and verify live car swap
        js_step4 = """
        (async function() {
            const pm = window.__pauseMenu;
            await pm.selectCar(1);
            return {
                newActiveIndex: pm.activeCarIndex,
                activeCarName: pm.carRoster[pm.activeCarIndex].name
            };
        })()
        """
        eval_js(8, js_step4)
        time.sleep(2.0)

        # Pass 5: Re-open Pause Menu to verify that active car updated to Lamborghini Veneno in Garage Tile!
        js_step5 = """
        (function() {
            const pm = window.__pauseMenu;
            pm.setOpen(true);
            pm.updateFocusedTile(1);
            return {
                garageTileCar: document.getElementById('pause-garage-current-name').textContent,
                tileImgSrc: document.getElementById('pause-garage-current-img').getAttribute('src')
            };
        })()
        """
        eval_js(9, js_step5)
        time.sleep(1.0)
        take_screenshot(10, "verified_pause_menu_veneno_active.png")

        # Pass 6: Open Settings & Performance Subview
        js_step6 = """
        (function() {
            const pm = window.__pauseMenu;
            pm.showView('settings');
            return {
                currentView: pm.currentView,
                grassDensity: window.__grassDensity
            };
        })()
        """
        eval_js(11, js_step6)
        time.sleep(1.0)
        take_screenshot(12, "verified_pause_menu_settings.png")

        # Pass 7: Expand Fullscreen World Map from pause menu
        js_step7 = """
        (function() {
            const pm = window.__pauseMenu;
            const wm = window.__worldMap;
            pm.setOpen(false);
            wm.setOpen(true);
            return {
                isMapOpen: wm.isOpen,
                playerMarkerVisible: !document.getElementById('map-player-marker').classList.contains('hidden')
            };
        })()
        """
        eval_js(13, js_step7)
        time.sleep(1.5)
        take_screenshot(14, "verified_world_map_expanded.png")

        # Pass 8: Move vehicle to western hairpin perimeter (min_wx = -250m) and open pause menu
        js_step8 = """
        (function() {
            const v = window.__vehicle;
            const pm = window.__pauseMenu;
            const wm = window.__worldMap;
            wm.setOpen(false);
            if (v && v.rootGroup) {
                v.rootGroup.position.set(-250, 0, 0);
            }
            pm.setOpen(true);
            pm.updateFocusedTile(1);
            return {
                carX: v.rootGroup.position.x,
                carZ: v.rootGroup.position.z,
                planeTransform: document.getElementById('pause-mini-map-plane').style.transform
            };
        })()
        """
        eval_js(15, js_step8)
        time.sleep(1.2)
        take_screenshot(16, "verified_pause_menu_hairpin_edge_clamped.png")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    test_pause_menu()
