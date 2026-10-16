"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

interface Packed {
  pos: number[];
  idx: number[];
  counts: number[];
}
interface CityData {
  size: [number, number];
  buildings: Packed;
  roads: Packed;
  terrain: Packed;
  /** x, y, z, height (m) */
  trees: [number, number, number, number][];
}

// Plaster, limestone and sand tones seen across Mogadishu.
const WALLS = ["#f4efe6", "#ece3d3", "#f7f4ee", "#e6d9c2", "#efe6d8", "#e9ddc8", "#f1e9dc", "#ddcdb4"];
const FOLIAGE = ["#4f7a3a", "#5f8a43", "#456b33", "#6b9150"];

/**
 * The surveyed neighbourhood from the topographic export, rendered in 3D:
 * terrain, roads, buildings and trees under a warm sun, slowly orbiting.
 * Static for reduced motion; paused while off screen.
 */
export function CityScene({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let frame = 0;
    let visible = true;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const haze = new THREE.Color("#c3d6ee");
    scene.background = haze;
    scene.fog = new THREE.Fog(haze, 480, 1150);

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);

    // Light: open sky + a low warm sun casting soft shadows.
    scene.add(new THREE.HemisphereLight("#d6e6ff", "#c2a479", 0.95));
    const sun = new THREE.DirectionalLight("#ffe6bf", 3.4);
    sun.position.set(-240, 210, 140);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -260;
    sc.right = 260;
    sc.top = 260;
    sc.bottom = -260;
    sc.near = 10;
    sc.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);

    const disposables: { dispose: () => void }[] = [];
    let center = new THREE.Vector3();
    let radius = 320;

    /** DXF is metres, x east / y north / z up → three is x east / y up / z south. */
    function geometry(p: Packed, z0: number, cx: number, cy: number, colours?: string[]) {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(p.pos.length);
      for (let i = 0; i < p.pos.length; i += 3) {
        pos[i] = p.pos[i]! - cx;
        pos[i + 1] = p.pos[i + 2]! - z0;
        pos[i + 2] = -(p.pos[i + 1]! - cy);
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      if (colours) {
        // One tone per building, slightly varied.
        const col = new Float32Array(pos.length);
        const c = new THREE.Color();
        let v = 0;
        p.counts.forEach((n, b) => {
          c.set(colours[(b * 7 + (b % 3)) % colours.length]!).offsetHSL(0, 0, ((b * 37) % 11) / 220 - 0.02);
          for (let k = 0; k < n; k++, v++) c.toArray(col, v * 3);
        });
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      }
      g.setIndex(p.idx);
      // Flat shading for crisp walls and roofs.
      const flat = g.toNonIndexed();
      g.dispose();
      flat.computeVertexNormals();
      disposables.push(flat);
      return flat;
    }

    function build(d: CityData) {
      const zs = d.terrain.pos.filter((_, i) => i % 3 === 2);
      const z0 = Math.min(...zs);
      const [w, h] = d.size;
      const cx = w / 2;
      const cy = h / 2;
      center = new THREE.Vector3(0, 0, 0);
      radius = Math.max(w, h) * 0.82;

      const sand = new THREE.MeshStandardMaterial({ color: "#d9c39a", roughness: 1 });
      const asphalt = new THREE.MeshStandardMaterial({ color: "#4a4b4f", roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const walls = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
      disposables.push(sand, asphalt, walls);

      // Ground beyond the survey so the edges fade into haze.
      const groundGeo = new THREE.PlaneGeometry(4000, 4000);
      const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: "#cdb893", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.3;
      ground.receiveShadow = true;
      disposables.push(groundGeo, ground.material as THREE.Material);
      scene.add(ground);

      const terrain = new THREE.Mesh(geometry(d.terrain, z0, cx, cy), sand);
      terrain.receiveShadow = true;
      scene.add(terrain);

      const roads = new THREE.Mesh(geometry(d.roads, z0 - 0.05, cx, cy), asphalt);
      roads.receiveShadow = true;
      scene.add(roads);

      const buildings = new THREE.Mesh(geometry(d.buildings, z0, cx, cy, WALLS), walls);
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      scene.add(buildings);

      // Trees: trunk + two-lobed crown, instanced.
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6);
      trunkGeo.translate(0, 0.5, 0);
      const crownGeo = new THREE.IcosahedronGeometry(1, 1);
      const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b5137", roughness: 1 });
      const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
      disposables.push(trunkGeo, crownGeo, trunkMat, crownMat);
      const n = d.trees.length;
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, n * 2);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const c = new THREE.Color();
      d.trees.forEach(([x, y, z, ht], i) => {
        const tall = Math.max(4, Math.min(ht, 16));
        const base = new THREE.Vector3(x - cx, z - z0, -(y - cy));
        m.compose(base, q, s.set(1, tall * 0.45, 1));
        trunks.setMatrixAt(i, m);
        const r = tall * 0.28;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 1.7) % Math.PI);
        m.compose(p.copy(base).add(new THREE.Vector3(0, tall * 0.62, 0)), q, s.set(r, r * 0.85, r));
        crowns.setMatrixAt(i * 2, m);
        m.compose(p.copy(base).add(new THREE.Vector3(r * 0.45, tall * 0.5, r * 0.3)), q, s.set(r * 0.7, r * 0.6, r * 0.7));
        crowns.setMatrixAt(i * 2 + 1, m);
        c.set(FOLIAGE[i % FOLIAGE.length]!).offsetHSL(0, 0, ((i * 13) % 7) / 100 - 0.03);
        crowns.setColorAt(i * 2, c);
        crowns.setColorAt(i * 2 + 1, c);
        q.identity();
      });
      trunks.castShadow = crowns.castShadow = true;
      scene.add(trunks, crowns);
    }

    const resize = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    };

    let angle = 0.9;
    const place = () => {
      camera.position.set(center.x + Math.cos(angle) * radius, radius * 0.5, center.z + Math.sin(angle) * radius);
      camera.lookAt(center.x, 4, center.z);
    };
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      angle += dt * 0.00004; // one turn in ~2.6 minutes
      place();
      renderer.render(scene, camera);
      if (!disposed && visible && !reduced && !document.hidden) frame = requestAnimationFrame(loop);
      else frame = 0;
    };
    const start = () => {
      if (frame || disposed) return;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(() => {
      resize();
      place();
      renderer.render(scene, camera);
    });
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
    });
    io.observe(el);
    const onVis = () => !document.hidden && start();
    document.addEventListener("visibilitychange", onVis);

    fetch("/login/city.json")
      .then((r) => r.json() as Promise<CityData>)
      .then((d) => {
        if (disposed) return;
        build(d);
        resize();
        place();
        renderer.render(scene, camera);
        setReady(true);
        start();
      })
      .catch(() => {
        /* the panel keeps its gradient if the model can't load */
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} aria-hidden className={`${className ?? ""} transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`} />;
}
