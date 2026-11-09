#!/usr/bin/env python3
import sys
import os
import time
import json
import socket
import base64
import urllib.request
import subprocess

def capture(out_path="verified_meadow_view.png", wait_sec=4.0, js_eval=None, sleep_after_eval=2.5):
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not os.path.exists(chrome_bin):
        print(f"Error: Chrome binary not found at {chrome_bin}")
        return False

    port = 9222
    proc = subprocess.Popen([
        chrome_bin,
        "--headless=new",
        "--use-gl=angle",
        f"--remote-debugging-port={port}",
        "--window-size=1280,720",
        "http://localhost:5173/"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        time.sleep(wait_sec)
        # Fetch webSocketDebuggerUrl
        try:
            req = urllib.request.urlopen(f"http://127.0.0.1:{port}/json")
            targets = json.loads(req.read().decode())
        except Exception as e:
            print(f"Error connecting to Chrome DevTools port {port}: {e}")
            return False

        page = next((t for t in targets if "localhost:5173" in t.get("url", "")), None)
        if not page:
            print("Target localhost:5173 page not found in Chrome!")
            return False

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
            print("WebSocket handshake failed:", resp)
            return False

        if js_eval:
            eval_payload = json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js_eval, "returnByValue": True}}).encode()
            mask = os.urandom(4)
            masked = bytes(b ^ mask[i % 4] for i, b in enumerate(eval_payload))
            length = len(eval_payload)
            if length < 126:
                header = bytes([0x81, 0x80 | length]) + mask
            else:
                header = bytes([0x81, 0x80 | 126, (length >> 8) & 0xff, length & 0xff]) + mask
            sock.sendall(header + masked)
            time.sleep(sleep_after_eval)
            # Read eval response
            try:
                eval_res = sock.recv(16384)
                print("JS Eval Response:", eval_res.decode('utf-8', errors='ignore'))
            except Exception as e:
                pass

        # Send Page.captureScreenshot command
        payload = json.dumps({"id": 2, "method": "Page.captureScreenshot"}).encode()
        mask = os.urandom(4)
        masked_payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        length = len(payload)
        if length < 126:
            header = bytes([0x81, 0x80 | length]) + mask
        else:
            header = bytes([0x81, 0x80 | 126, (length >> 8) & 0xff, length & 0xff]) + mask
        sock.sendall(header + masked_payload)

        # Receive screenshot frames
        raw_chunks = bytearray()
        sock.settimeout(12.0)
        while True:
            try:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                raw_chunks.extend(chunk)
                if b'"data"' in raw_chunks and (raw_chunks.endswith(b'"}') or raw_chunks.endswith(b'"}}')):
                    break
            except socket.timeout:
                break

        sock.close()

        # Extract base64 image data from raw frames
        marker = b'"data":"'
        idx = raw_chunks.find(marker)
        if idx == -1:
            print("Failed to find 'data' in response frames. Total bytes:", len(raw_chunks))
            return False
        
        start = idx + len(marker)
        # Find closing quote
        end = raw_chunks.find(b'"', start)
        if end == -1:
            end = len(raw_chunks) - 2
        
        b64_str = raw_chunks[start:end].decode("ascii", errors="ignore")
        img_bytes = base64.b64decode(b64_str)
        with open(out_path, "wb") as f:
            f.write(img_bytes)
        print(f"Successfully captured {out_path} ({len(img_bytes)} bytes)")
        return True

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "verified_meadow_view.png"
    sec = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
    js = sys.argv[3] if len(sys.argv) > 3 else None
    capture(out, sec, js)
