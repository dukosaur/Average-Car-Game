import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchCarMaterialForPixelTheme } from './pixelTheme.js';
import { applyPaintToCarRoot } from './carPaintSystem.js';

/**
 * Lightweight 3D Turntable Showroom for the Pause Menu -> CUSTOMIZE tab.
 * Matches the real game's PixelRenderPipeline look: 1.5x pixel snap + crisp depth/silhouette ink outlines.
 */
export class CustomizeShowroom {
  constructor(canvasEl, carNameEl = null) {
    this.canvasEl = canvasEl;
    this.carNameEl = carNameEl;

    this.initialized = false;
    this.running = false;
    this.rafId = 0;
    this.lastFrameMs = 0;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.turntableGroup = null;
    this.carAnchor = null;

    // Offscreen render target + depth-outline blit pass (matches real game)
    this.rt = null;
    this.quadScene = null;
    this.quadCamera = null;
    this.blitMat = null;

    this.loader = new GLTFLoader();
    this.modelCache = new Map(); // url -> prepared THREE.Group
    this.currentCarUrl = null;
    this.loadToken = 0;

    // Smooth auto-spin + optional click-and-drag rotation
    this.isDragging = false;
    this.lastPointerX = 0;
    this.spinSpeed = 0.42; // rad/s
    this.dragVelocity = 0;
  }

  _initScene() {
    if (this.initialized || !this.canvasEl) return;
    this.initialized = true;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasEl,
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.25, 45);
    this.camera.position.set(0, 2.35, 6.9);
    this.camera.lookAt(0, 0.72, 0);

    // Clean motorsport studio lighting matching the game
    const hemi = new THREE.HemisphereLight(0xeef4ff, 0x161b26, 1.35);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff8e7, 2.1);
    keyLight.position.set(5.5, 8.5, 6.0);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x9ec5ff, 1.05);
    rimLight.position.set(-6.0, 4.5, -5.5);
    this.scene.add(rimLight);

    const warmRim = new THREE.DirectionalLight(0xffd54f, 0.4);
    warmRim.position.set(4.0, 2.5, -6.0);
    this.scene.add(warmRim);

    // Spinning Turntable Group (simple circle + car rotate together)
    this.turntableGroup = new THREE.Group();
    this.turntableGroup.rotation.y = Math.PI * 0.22;
    this.scene.add(this.turntableGroup);

    // Simple, clean spinning circle platform
    const discGeo = new THREE.CylinderGeometry(2.85, 2.95, 0.16, 28);
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x161c28,
      roughness: 0.78,
      metalness: 0.12,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.position.y = -0.08;
    this.turntableGroup.add(discMesh);
    this.discMesh = discMesh;

    // Subtle single edge ring
    const rimGeo = new THREE.RingGeometry(2.74, 2.84, 28);
    rimGeo.rotateX(-Math.PI * 0.5);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = 0.005;
    this.turntableGroup.add(rimMesh);
    this.rimMesh = rimMesh;

    // Car mount point on top of the spinning circle
    this.carAnchor = new THREE.Group();
    this.carAnchor.position.y = 0.01;
    this.turntableGroup.add(this.carAnchor);

    // Fullscreen ink-outline & pixel blit pass (matching PixelRenderPipeline)
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blitMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / 512, 1 / 288) },
        uCameraNear: { value: this.camera.near },
        uCameraFar: { value: this.camera.far },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #include <packing>

        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uTexelSize;
        uniform float uCameraNear;
        uniform float uCameraFar;

        varying vec2 vUv;

        float getLinearDepth(vec2 uv) {
          float fragCoordZ = texture2D(tDepth, uv).x;
          float viewZ = perspectiveDepthToViewZ(fragCoordZ, uCameraNear, uCameraFar);
          return -viewZ;
        }

        void main() {
          vec2 uv = (floor(vUv / uTexelSize) + 0.5) * uTexelSize;
          vec4 sampleC = texture2D(tDiffuse, uv);
          float aC = sampleC.a;

          vec2 offL = uv + vec2(-uTexelSize.x, 0.0);
          vec2 offR = uv + vec2( uTexelSize.x, 0.0);
          vec2 offU = uv + vec2(0.0,  uTexelSize.y);
          vec2 offD = uv + vec2(0.0, -uTexelSize.y);

          float aL = texture2D(tDiffuse, offL).a;
          float aR = texture2D(tDiffuse, offR).a;
          float aU = texture2D(tDiffuse, offU).a;
          float aD = texture2D(tDiffuse, offD).a;
          float maxNeighborA = max(max(aL, aR), max(aU, aD));

          // Outside transparent pixels adjacent to geometry -> crisp 1px outer silhouette ink border
          if (aC < 0.05) {
            if (maxNeighborA > 0.35) {
              gl_FragColor = vec4(0.015, 0.020, 0.032, 0.94);
              return;
            }
            discard;
          }

          vec3 col = sampleC.rgb;
          float zC = getLinearDepth(uv);
          float zL = getLinearDepth(offL);
          float zR = getLinearDepth(offR);
          float zU = getLinearDepth(offU);
          float zD = getLinearDepth(offD);

          // Depth Laplacian + foreground jump ink edges (matches real game PixelRenderPipeline)
          float lapH = abs((zR - zC) - (zC - zL));
          float lapV = abs((zU - zC) - (zC - zD));
          float maxLap = max(lapH, lapV) / max(zC, 0.5);
          float fgJump = max(max(zL - zC, zR - zC), max(zU - zC, zD - zC)) / max(zC, 0.5);

          float outline = smoothstep(0.032, 0.095, maxLap) * smoothstep(0.022, 0.072, fgJump);

          // Subtle interior panel-seam color edge ink (windows, stripes, grilles, arches)
          vec3 cL = texture2D(tDiffuse, offL).rgb;
          vec3 cR = texture2D(tDiffuse, offR).rgb;
          vec3 cU = texture2D(tDiffuse, offU).rgb;
          vec3 cD = texture2D(tDiffuse, offD).rgb;
          float cEdge = max(length(cR - cL), length(cU - cD));
          float zFlat = step(maxLap, 0.025);
          outline = max(outline, smoothstep(0.45, 0.88, cEdge) * zFlat * 0.52);

          vec3 inkColor = mix(vec3(0.012, 0.016, 0.028), col * 0.16, 0.24);
          col = mix(col, inkColor, outline * 0.92);

          gl_FragColor = vec4(col, aC);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat);
    this.quadScene.add(quadMesh);

    // Optional drag-to-rotate interaction on the showroom canvas
    this.canvasEl.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.dragVelocity = 0;
      try {
        this.canvasEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    });
    this.canvasEl.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      const dRot = dx * 0.01;
      if (this.turntableGroup) this.turntableGroup.rotation.y += dRot;
      this.dragVelocity = dRot * 20;
    });
    const endDrag = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      try {
        this.canvasEl.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };
    this.canvasEl.addEventListener('pointerup', endDrag);
    this.canvasEl.addEventListener('pointercancel', endDrag);

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.canvasEl.parentElement || this.canvasEl);
    }
  }

  _resize() {
    if (!this.renderer || !this.camera || !this.canvasEl) return;
    const parent = this.canvasEl.parentElement || this.canvasEl;
    const w = Math.max(200, parent.clientWidth || 800);
    const h = Math.max(200, parent.clientHeight || 420);

    // Match the real game's crisp 1.5x car pixel scale (much finer than 2.6x!)
    const pixelScale = 1.5;
    const pw = Math.max(160, Math.round(w / pixelScale));
    const ph = Math.max(100, Math.round(h / pixelScale));

    this.renderer.setSize(pw, ph, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.rt) {
      this.rt.dispose();
      this.rt = null;
    }
    const depthTexture = new THREE.DepthTexture(pw, ph);
    depthTexture.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(pw, ph, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthTexture,
    });

    if (this.blitMat) {
      this.blitMat.uniforms.tDiffuse.value = this.rt.texture;
      this.blitMat.uniforms.tDepth.value = depthTexture;
      this.blitMat.uniforms.uTexelSize.value.set(1 / pw, 1 / ph);
    }
  }

  async _loadPreparedCar(carSpec) {
    let prepared = this.modelCache.get(carSpec.url);
    if (prepared) return prepared;
    try {
      const gltf = await this.loader.loadAsync(carSpec.url);
      const root = gltf.scene;
      root.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            patchCarMaterialForPixelTheme(m);
          }
        }
      });
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      // Normalize car length to ~4.45 units so every vehicle fits the turntable cleanly
      const maxHorizontal = Math.max(size.x, size.z, 0.001);
      const targetLen = 4.45;
      const scale = targetLen / maxHorizontal;

      const wrapper = new THREE.Group();
      root.scale.setScalar(scale);
      root.position.set(
        -center.x * scale,
        -box.min.y * scale,
        -center.z * scale
      );
      wrapper.add(root);
      prepared = wrapper;
      this.modelCache.set(carSpec.url, prepared);
      return prepared;
    } catch (err) {
      console.warn('CustomizeShowroom failed to load car GLB:', carSpec.url, err);
      return null;
    }
  }

  async setCar(carSpec) {
    if (!carSpec || !carSpec.url) return;
    if (this.carNameEl) {
      this.carNameEl.textContent = (carSpec.name || 'CURRENT VEHICLE').toUpperCase();
    }
    this._initScene();
    this.currentCarId = carSpec.id;
    if (this.currentCarUrl === carSpec.url && this.carAnchor && this.carAnchor.children.length > 0) {
      applyPaintToCarRoot(this.carAnchor, carSpec.id);
      return;
    }
    this.currentCarUrl = carSpec.url;
    const token = ++this.loadToken;

    const prepared = await this._loadPreparedCar(carSpec);
    if (!prepared || token !== this.loadToken || !this.carAnchor) return;
    while (this.carAnchor.children.length > 0) {
      this.carAnchor.remove(this.carAnchor.children[0]);
    }
    this.carAnchor.add(prepared);
    applyPaintToCarRoot(this.carAnchor, carSpec.id);
  }

  /**
   * Renders a crisp pixelated + ink-outlined 3/4 studio thumbnail DataURL of any car
   * with its current custom paint colors (reusing the showroom WebGLRenderer).
   */
  async renderPixelThumbnail(carSpec, paintMap = null) {
    if (!carSpec || !carSpec.url) return null;
    this._initScene();
    const prepared = await this._loadPreparedCar(carSpec);
    if (!prepared || !this.renderer || !this.scene || !this.camera || !this.carAnchor) return null;

    // Save current showroom state
    const prevChildren = [...this.carAnchor.children];
    const prevRotY = this.turntableGroup.rotation.y;
    const prevCamPos = this.camera.position.clone();
    const prevDiscVis = this.discMesh ? this.discMesh.visible : true;
    const prevRimVis = this.rimMesh ? this.rimMesh.visible : true;

    // Swap in target car with custom paint & clean transparent 3/4 thumbnail framing
    while (this.carAnchor.children.length > 0) {
      this.carAnchor.remove(this.carAnchor.children[0]);
    }
    this.carAnchor.add(prepared);
    applyPaintToCarRoot(prepared, carSpec.id, paintMap);

    if (this.discMesh) this.discMesh.visible = false;
    if (this.rimMesh) this.rimMesh.visible = false;
    this.turntableGroup.rotation.y = -Math.PI * 0.24;
    this.camera.position.set(0, 2.05, 5.15);
    this.camera.lookAt(0, 0.52, 0);

    // Render crisp pixelated thumbnail (168x104) through the exact ink-outline pass
    const tw = 168;
    const th = 104;
    this.renderer.setSize(tw, th, false);
    this.camera.aspect = tw / th;
    this.camera.updateProjectionMatrix();

    const thumbDepth = new THREE.DepthTexture(tw, th);
    thumbDepth.type = THREE.UnsignedIntType;
    const thumbRt = new THREE.WebGLRenderTarget(tw, th, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthTexture: thumbDepth,
    });

    const prevDiffuse = this.blitMat.uniforms.tDiffuse.value;
    const prevDepth = this.blitMat.uniforms.tDepth.value;
    const prevTexel = this.blitMat.uniforms.uTexelSize.value.clone();

    this.blitMat.uniforms.tDiffuse.value = thumbRt.texture;
    this.blitMat.uniforms.tDepth.value = thumbDepth;
    this.blitMat.uniforms.uTexelSize.value.set(1 / tw, 1 / th);

    this.renderer.setRenderTarget(thumbRt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCamera);

    const dataUrl = this.canvasEl.toDataURL('image/png');

    thumbRt.dispose();
    thumbDepth.dispose();

    // Restore showroom state
    this.blitMat.uniforms.tDiffuse.value = prevDiffuse;
    this.blitMat.uniforms.tDepth.value = prevDepth;
    this.blitMat.uniforms.uTexelSize.value.copy(prevTexel);

    while (this.carAnchor.children.length > 0) {
      this.carAnchor.remove(this.carAnchor.children[0]);
    }
    for (const ch of prevChildren) {
      this.carAnchor.add(ch);
    }
    this.turntableGroup.rotation.y = prevRotY;
    this.camera.position.copy(prevCamPos);
    this.camera.lookAt(0, 0.72, 0);
    if (this.discMesh) this.discMesh.visible = prevDiscVis;
    if (this.rimMesh) this.rimMesh.visible = prevRimVis;
    this._resize();

    return dataUrl;
  }

  updatePaint(carId, paintMap) {
    if (!this.carAnchor || !carId) return;
    applyPaintToCarRoot(this.carAnchor, carId, paintMap);
  }

  start(carSpec) {
    this._initScene();
    this._resize();
    if (carSpec) {
      this.setCar(carSpec);
    }
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = performance.now();

    const loop = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;

      if (this.turntableGroup && !this.isDragging) {
        if (Math.abs(this.dragVelocity) > 0.05) {
          this.turntableGroup.rotation.y += this.dragVelocity * dt;
          this.dragVelocity *= Math.exp(-5.0 * dt);
        } else {
          this.turntableGroup.rotation.y += this.spinSpeed * dt;
        }
      }

      if (this.renderer && this.scene && this.camera && this.rt) {
        // 1. Render scene to low-res pixel target with depth texture
        this.renderer.setRenderTarget(this.rt);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);

        // 2. Blit with crisp 1px depth + silhouette + panel-seam ink outlines
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
        this.renderer.render(this.quadScene, this.quadCamera);
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}
