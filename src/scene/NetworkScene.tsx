import { Component, useEffect, useMemo, useRef, useState } from "react";
import type {
  ErrorInfo,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Lightformer,
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import * as THREE from "three";
import { catalog } from "../domain/catalog";
import { snapPlacement } from "../domain/placement";
import type {
  ComponentEntity,
  ComponentType,
  Connection,
  CustomAsset,
  Vec3,
} from "../domain/types";
import type { SimulatedLeak } from "../services/api";
import { useStore } from "../state/stores";
import type { Axis } from "../state/stores";
import { PartModel } from "./models";

const eulerOf = (c: ComponentEntity) =>
  new THREE.Euler(...(c.rotation3 ?? [0, c.rotation, 0]));
const worldPort = (c: ComponentEntity, portId: string) => {
  const port = c.ports.find((p) => p.id === portId);
  return port
    ? new THREE.Vector3(...port.position).applyEuler(eulerOf(c)).add(
      new THREE.Vector3(...c.position),
    )
    : null;
};

/** +1 when water enters through the inlet port, -1 when it enters through the outlet. */
function flowDirection(
  c: ComponentEntity,
  byId: Map<string, ComponentEntity>,
  connections: Connection[],
): 1 | -1 {
  const neighbourPressure = (portId: string) => {
    for (const edge of connections) {
      if (edge.fromComponent === c.id && edge.fromPort === portId) {
        return byId.get(edge.toComponent)?.pressure;
      }
      if (edge.toComponent === c.id && edge.toPort === portId) {
        return byId.get(edge.fromComponent)?.pressure;
      }
    }
  };
  const inlet = neighbourPressure("inlet");
  const outlet = neighbourPressure("outlet");
  return outlet !== undefined && (inlet === undefined || outlet > inlet) ? -1 : 1;
}

// Height of each model's top above its origin, for placing the selection chip.
const modelTop: Record<ComponentType, number> = {
  tank: 1.4,
  pipe: .17,
  "curved-pipe": .17,
  valve: .4,
  tap: .32,
  custom: .25,
};

function ghostOf(
  type: ComponentType,
  rotation3: Vec3,
  custom: CustomAsset | null,
): ComponentEntity {
  const def = catalog.find((d) => d.type === type)!;
  return {
    id: "ghost",
    type,
    name: custom?.name ?? def.name,
    position: [0, 0, 0],
    rotation: rotation3[1],
    rotation3,
    material: custom?.material ?? String(def.properties.material),
    diameter: .25,
    length: 1,
    maxPressure: 100,
    pressureLoss: 0,
    flowResistance: 1,
    open: true,
    opening: 1,
    ports: def.ports,
    status: "normal",
    pressure: 0,
    flow: 0,
    customAssetId: custom?.id,
  };
}

/**
 * Water escaping a port. Droplets leave along `direction` and fall under
 * gravity; a burst sprays wider, an open tap pours a narrow stream.
 */
function Spray(
  { leak, direction }: { leak: SimulatedLeak; direction: THREE.Vector3 },
) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const kind = leak.kind ?? "leak";
  const count = kind === "break" ? 48 : 32;
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, () => [
        Math.random(),
        Math.random() - .5,
        Math.random() - .5,
        Math.random() - .5,
      ]),
    [count],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    // An open tap's droplets continue below the solid stream.
    const speed = kind === "outlet" ? 2.2 : 1.1 + Math.min(leak.pressure, 150) / 50;
    const spread = kind === "break" ? 1.1 : kind === "outlet" ? .05 : .3;
    const life = kind === "outlet" ? .7 : .55;
    seeds.forEach(([phase, jx, jy, jz], i) => {
      const t = ((clock.elapsedTime / life + phase) % 1) * life;
      const vx = (direction.x + jx * spread) * speed;
      const vy = (direction.y + jy * spread) * speed;
      const vz = (direction.z + jz * spread) * speed;
      const y = vy * t - 4.9 * t * t;
      dummy.position.set(vx * t, y, vz * t);
      // Droplets vanish at the floor instead of falling through it.
      const above = leak.position[1] + y > 0;
      dummy.scale.setScalar(above ? 1 - t / life * .6 : 0);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  const stream = kind === "outlet" ? Math.min(.9, leak.position[1]) : 0;
  return (
    <group position={leak.position}>
      {stream > 0 && (
        <mesh position={[0, -stream / 2, 0]}>
          <cylinderGeometry args={[.018, .03, stream, 16, 1, true]} />
          <meshStandardMaterial color="#58bdea" roughness={.05} transparent opacity={.75} depthWrite={false} />
        </mesh>
      )}
      <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
        <sphereGeometry args={[kind === "outlet" ? .03 : .026, 8, 8]} />
        <meshStandardMaterial
          color="#4fb8e8"
          roughness={.1}
          transparent
          opacity={.85}
        />
      </instancedMesh>
      {kind !== "outlet" && (
        <Html center position={[0, .32, 0]} style={{ pointerEvents: "none" }}>
          <span className={`scene-chip ${kind === "break" ? "danger" : "water"}`}>
            {kind === "break" ? "Burst" : "Leak"} · {Math.round(leak.pressure)} psi
          </span>
        </Html>
      )}
    </group>
  );
}

function SceneContents() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const running = useStore((s) => s.running);
  const leaks = useStore((s) => s.leaks);
  const placing = useStore((s) => s.placing);
  const selected = useStore((s) => s.selected);
  const connectionMode = useStore((s) => s.connectionMode);
  const customAssets = useStore((s) => s.customAssets);
  const activeCustom = useStore((s) => s.activeCustom);
  const rotation3 = useStore((s) => s.placementRotation3);
  const projectId = useStore((s) => s.projectId);
  const {
    connect,
    disconnect,
    place,
    setSelected,
    move,
    moveLocal,
    commitMove,
    remove,
    setRotation3,
    setPlacementRotation3,
  } = useStore.getState();
  const [ghostPosition, setGhostPosition] = useState<Vec3>([0, 0, 0]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<
    {
      id: string;
      plane: THREE.Plane;
      offset: THREE.Vector3;
      start: Vec3;
      moved: boolean;
    } | null
  >(null);
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;
  const byId = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );

  useEffect(() => {
    gl.domElement.style.cursor = dragging
      ? "grabbing"
      : placing
      ? "copy"
      : hovered
      ? connectionMode ? "crosshair" : "grab"
      : "auto";
  }, [gl, dragging, placing, hovered, connectionMode]);

  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
      ) return;
      const key = e.key.toLowerCase();
      if (key === "q" || key === "e" || key === "r") {
        const axis = useStore.getState().rotateAxis;
        const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const turn = (key === "q" ? -1 : 1) * Math.PI / 2;
        if (placing) {
          const r: Vec3 = [...useStore.getState().placementRotation3];
          r[i] += turn;
          setPlacementRotation3(r);
        } else if (selected) {
          const c = byId.get(selected);
          if (c) {
            const r: Vec3 = c.rotation3 ? [...c.rotation3] : [0, c.rotation, 0];
            r[i] += turn;
            setRotation3(selected, r);
          }
        }
      }
      if (e.key === "Escape") {
        useStore.getState().setPlacing(null);
        useStore.getState().setConnectionMode(false);
        if (drag.current) moveLocal(drag.current.id, drag.current.start);
        drag.current = null;
        setDragging(false);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove(selected);
      }
      const nudges = ["arrowleft", "arrowright", "arrowup", "arrowdown", "w", "s"];
      const c = selected ? byId.get(selected) : undefined;
      if (c && nudges.includes(key)) {
        e.preventDefault();
        const axis = useStore.getState().moveAxis;
        const p: Vec3 = [...c.position];
        const step = .5;
        const back = key === "arrowleft" || key === "arrowdown" || key === "s";
        if (axis !== "free") p[{ x: 0, y: 1, z: 2 }[axis]] += back ? -step : step;
        else if (key === "arrowleft") p[0] -= step;
        else if (key === "arrowright") p[0] += step;
        else if (key === "arrowup") p[2] -= step;
        else if (key === "arrowdown") p[2] += step;
        else p[1] += key === "w" ? step : -step;
        move(c.id, p);
      }
      if (key === "x" || key === "y" || key === "z") {
        useStore.getState().setMoveAxis(key as Axis);
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [placing, selected, byId, move, moveLocal, remove, setRotation3, setPlacementRotation3]);

  useEffect(() => {
    const frame = () => {
      const { components } = useStore.getState();
      if (!components.length || !controls) return;
      const bounds = new THREE.Box3();
      components.forEach((c) =>
        bounds.expandByPoint(new THREE.Vector3(...c.position))
      );
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      // Keep the default viewing angle; back off until the network fits the
      // narrower of the two fields of view (portrait phones are width-bound).
      const lens = camera as THREE.PerspectiveCamera;
      const vertical = THREE.MathUtils.degToRad(lens.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * lens.aspect);
      // Positions are part centres, so pad the radius for the parts' own size.
      const radius = Math.max(sphere.radius, 1.5) + 1;
      const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2);
      const direction = new THREE.Vector3(8, 7, 9).normalize();
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      controls.target.copy(sphere.center);
      controls.update();
    };
    window.addEventListener("pipelab:frame-scene", frame);
    return () => window.removeEventListener("pipelab:frame-scene", frame);
  }, [camera, controls]);
  // Frame the network once the controls exist and again when the project loads.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pipelab:frame-scene"));
  }, [controls, projectId]);

  useEffect(() => {
    if (!dragging) return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const onMove = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(active.plane, hit)) return;
      const target = hit.clone().sub(active.offset);
      const p: Vec3 = [...active.start];
      const axis = useStore.getState().moveAxis;
      if (axis === "x") p[0] = target.x;
      else if (axis === "y") p[1] = target.y;
      else if (axis === "z") p[2] = target.z;
      else {
        p[0] = target.x;
        p[2] = target.z;
      }
      active.moved = true;
      moveLocal(active.id, p);
    };
    // Listen on the window so releasing the pointer anywhere ends the drag.
    const onUp = () => {
      const active = drag.current;
      drag.current = null;
      setDragging(false);
      if (active?.moved) commitMove(active.id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, camera, gl, moveLocal, commitMove]);

  const startDrag = (e: ThreeEvent<PointerEvent>, component: ComponentEntity) => {
    const origin = new THREE.Vector3(...component.position);
    // Free, X and Z drags slide on a horizontal plane; Y drags on a
    // vertical plane facing the camera.
    const normal = useStore.getState().moveAxis === "y"
      ? camera.getWorldDirection(new THREE.Vector3()).setY(0)
      : new THREE.Vector3(0, 1, 0);
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      origin,
    );
    const grab = e.ray.intersectPlane(plane, new THREE.Vector3()) ??
      origin.clone();
    drag.current = {
      id: component.id,
      plane,
      offset: grab.sub(origin),
      start: component.position,
      moved: false,
    };
    setDragging(true);
  };
  const placedOnPointerDown = useRef(false);
  const placeAt = (type: ComponentType, position: Vec3) => {
    placedOnPointerDown.current = true;
    place(type, position, rotation3[1], rotation3);
  };
  const getPos = (e: ThreeEvent<PointerEvent>): Vec3 => [
    Math.round(e.point.x * 2) / 2,
    Math.round(e.point.y * 2) / 2,
    Math.round(e.point.z * 2) / 2,
  ];

  const chosen = selected ? byId.get(selected) : undefined;
  const chipHeight = chosen
    ? Math.max(
      chosen.position[1] + modelTop[chosen.type],
      ...chosen.ports.map((p) => worldPort(chosen, p.id)?.y ?? 0),
    ) + .35
    : 0;
  const ghost = placing ? ghostOf(placing, rotation3, activeCustom) : null;
  const ghostSnap = placing
    ? snapPlacement(placing, ghostPosition, rotation3, components, connections)
    : null;

  return (
    <>
      <ambientLight intensity={.25} />
      <directionalLight position={[6, 10, 7]} intensity={1.3} />
      <Environment resolution={256} frames={1}>
        {/* A bright studio backdrop; metals reflect it instead of black. */}
        <color attach="background" args={["#d7e0dc"]} />
        <Lightformer form="rect" intensity={2.2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[-8, 3, 4]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1.1} position={[8, 3, -4]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={.7} color="#e8f0ec" position={[0, 2, -9]} scale={[16, 5, 1]} />
      </Environment>
      <ContactShadows
        position={[0, .003, 0]}
        scale={40}
        resolution={1024}
        far={5}
        blur={2.2}
        opacity={.4}
        color="#1d2e28"
      />
      <Grid
        args={[40, 40]}
        position={[0, -.002, 0]}
        cellSize={.5}
        cellThickness={.6}
        cellColor="#cfdad4"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#a9bcb3"
        fadeDistance={34}
        fadeStrength={1.4}
        infiniteGrid
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          if (placing) setGhostPosition(getPos(e));
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          placedOnPointerDown.current = false;
          if (placing) placeAt(placing, getPos(e));
        }}
        onClick={(e) => {
          // A placement click ends here too; keep the new part selected.
          if (placedOnPointerDown.current) placedOnPointerDown.current = false;
          else if (e.delta < 4) setSelected(null);
        }}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* A joint whose ports no longer meet is drawn as a dotted gap; double-click it to disconnect. */}
      {connections.map((edge) => {
        const a = byId.get(edge.fromComponent);
        const b = byId.get(edge.toComponent);
        const from = a && worldPort(a, edge.fromPort);
        const to = b && worldPort(b, edge.toPort);
        if (!from || !to) return null;
        const length = from.distanceTo(to);
        if (length <= .2) return null;
        const dots = Math.max(2, Math.ceil(length / .14));
        return (
          <group
            key={edge.id}
            onDoubleClick={(e) => {
              e.stopPropagation();
              disconnect(edge.fromComponent, edge.toComponent);
            }}
          >
            {Array.from({ length: dots }, (_, i) => (
              <mesh key={i} position={from.clone().lerp(to, (i + .5) / dots)}>
                <sphereGeometry args={[.03, 10, 8]} />
                <meshBasicMaterial color="#d98a3d" />
              </mesh>
            ))}
          </group>
        );
      })}

      {running && leaks.map((leak) => {
        const owner = byId.get(leak.component_id);
        const origin = new THREE.Vector3(...leak.position);
        const direction = leak.kind === "outlet"
          ? new THREE.Vector3(0, -1, 0)
          : owner
          ? origin.clone().sub(new THREE.Vector3(...owner.position)).normalize()
          : new THREE.Vector3(0, 1, 0);
        if (leak.kind === "break") direction.set(0, 1, 0);
        return (
          <Spray
            key={`${leak.component_id}-${leak.port_id}`}
            leak={leak}
            direction={direction}
          />
        );
      })}

      {components.map((c) => (
        <group
          key={c.id}
          position={c.position}
          rotation={eulerOf(c)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            if (connectionMode) {
              const first = useStore.getState().selected;
              if (first && first !== c.id) connect(first, c.id);
              else setSelected(c.id);
              return;
            }
            if (placing) {
              placeAt(placing, ghostPosition);
              return;
            }
            setSelected(c.id);
            startDrag(e, c);
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(c.id);
          }}
          onPointerOut={() => setHovered((h) => (h === c.id ? null : h))}
        >
          <PartModel
            c={c}
            asset={customAssets.find((asset) => asset.id === c.customAssetId)}
            selected={selected === c.id}
            flowing={running && c.flow > 0}
            flowDirection={flowDirection(c, byId, connections)}
            showPorts={selected === c.id || connectionMode || Boolean(placing)}
          />
        </group>
      ))}

      {chosen && !dragging && (
        <Html
          center
          position={[chosen.position[0], chipHeight, chosen.position[2]]}
          style={{ pointerEvents: "none" }}
          zIndexRange={[20, 0]}
        >
          <div className={`part-chip ${chosen.status}`}>
            <b>{chosen.name}</b>
            <span>
              {running ? `${chosen.pressure.toFixed(0)} psi · ` : ""}
              health {Math.round(chosen.health ?? 100)}%
              {(chosen.type === "valve" || chosen.type === "tap") &&
                ` · ${chosen.open ? "open" : "closed"}`}
            </span>
          </div>
        </Html>
      )}

      {ghost && ghostSnap && (
        <group
          position={ghostSnap.position}
          rotation={rotation3}
          onPointerDown={(e) => {
            e.stopPropagation();
            placeAt(placing!, ghostPosition);
          }}
        >
          <PartModel
            c={ghost}
            asset={placing === "custom" ? activeCustom ?? undefined : undefined}
            ghost
          />
        </group>
      )}

      <OrbitControls
        enabled={!dragging}
        makeDefault
        minDistance={3}
        maxDistance={60}
        maxPolarAngle={Math.PI / 2.05}
        enableDamping
        dampingFactor={.09}
        zoomSpeed={.8}
        rotateSpeed={.65}
        panSpeed={.8}
        screenSpacePanning
      />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport
          axisColors={["#d9534f", "#3f9f5f", "#3b82c4"]}
          labelColor="#ffffff"
          axisHeadScale={.9}
        />
      </GizmoHelper>
    </>
  );
}

function StaticNetwork() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const selected = useStore((s) => s.selected);
  const setSelected = useStore((s) => s.setSelected);
  const placing = useStore((s) => s.placing);
  const place = useStore((s) => s.place);
  const [rotation, setRotation] = useState(0);
  const scale = 74;
  const xs = components.map((c) => c.position[0]);
  const zs = components.map((c) => c.position[2]);
  const minX = Math.min(-5, ...xs) - 1, maxX = Math.max(5, ...xs) + 1;
  const minZ = Math.min(-3, ...zs) - 1, maxZ = Math.max(3, ...zs) + 1;
  const width = (maxX - minX) * scale, height = (maxZ - minZ) * scale;
  const point = (x: number, z: number) => ({
    x: (x - minX) * scale,
    y: (z - minZ) * scale,
  });
  const glyph: Record<ComponentEntity["type"], string> = {
    tank: "TANK",
    pipe: "PIPE",
    "curved-pipe": "ELBOW",
    valve: "VALVE",
    tap: "TAP",
    custom: "CUSTOM",
  };
  const colors: Record<ComponentEntity["type"], string> = {
    tank: "#5f7a73",
    pipe: "#7d8f89",
    "curved-pipe": "#7d8f89",
    valve: "#b8862f",
    tap: "#2f8fa6",
    custom: "#7a62b0",
  };
  const centerX = point(0, 0).x, centerY = point(0, 0).y;
  const doPlace = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!placing) {
      setSelected(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(
      (event.clientX - rect.left) / rect.width * width / scale + minX,
    );
    const z = Math.round(
      (event.clientY - rect.top) / rect.height * height / scale + minZ,
    );
    place(placing, [x, .2, z], rotation);
  };
  return (
    <div
      className="fallback-scene"
      aria-label="2D plumbing network editor"
      onClick={(event) => {
        if (event.target === event.currentTarget) setSelected(null);
      }}
    >
      <div className="fallback-scene-note">
        <span className="fallback-badge">2D EDITOR</span>{" "}
        WebGL is unavailable. Network editing remains active.
      </div>
      <div className="fallback-controls">
        <button onClick={() => setRotation((r) => r + Math.PI / 2)}>
          ↻ Rotate
        </button>
        <span>Click a component to inspect · click empty space to place</span>
      </div>
      <div className="fallback-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          onClick={doPlace}
          role="img"
          aria-label="Plumbing network components and connections"
        >
          <defs>
            <pattern
              id="fallback-grid"
              width={scale / 2}
              height={scale / 2}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${scale / 2} 0 L 0 0 0 ${scale / 2}`}
                fill="none"
                stroke="#d6e0db"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width={width} height={height} fill="url(#fallback-grid)" />
          <line
            x1={centerX}
            y1="0"
            x2={centerX}
            y2={height}
            stroke="#d9534f40"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={centerY}
            x2={width}
            y2={centerY}
            stroke="#3b82c440"
            strokeWidth="1"
          />
          {connections.map((c) => {
            const a = components.find((v) => v.id === c.fromComponent),
              b = components.find((v) => v.id === c.toComponent);
            if (!a || !b) return null;
            const p1 = point(a.position[0], a.position[2]),
              p2 = point(b.position[0], b.position[2]);
            return (
              <g key={c.id}>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#9fb1a9"
                  strokeWidth="19"
                  strokeLinecap="round"
                />
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#dfe7e3"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {components.map((c) => {
            const p = point(c.position[0], c.position[2]);
            const color = c.status === "failed"
              ? "#e5484d"
              : c.status === "warning"
              ? "#e0951b"
              : colors[c.type];
            const isSelected = selected === c.id;
            return (
              <g
                key={c.id}
                transform={`translate(${p.x} ${p.y}) rotate(${
                  c.rotation * 180 / Math.PI
                })`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(c.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  r={isSelected ? 27 : 23}
                  fill={isSelected ? "#1f8a701a" : "#ffffff"}
                  stroke={isSelected ? "#1f8a70" : color}
                  strokeWidth={isSelected ? 3 : 2}
                />
                <circle r="15" fill={color} opacity=".2" stroke={color} />
                <text
                  y="4"
                  textAnchor="middle"
                  fill={color}
                  fontSize="9"
                  fontFamily="DM Mono"
                  fontWeight="bold"
                >
                  {glyph[c.type]}
                </text>
                {c.status === "failed" && (
                  <circle cx="18" cy="-18" r="6" fill="#e5484d" />
                )}
                <text
                  y="38"
                  textAnchor="middle"
                  fill="#2b3f39"
                  fontSize="10"
                  fontFamily="DM Sans"
                >
                  {c.name}
                </text>
                <text
                  y="51"
                  textAnchor="middle"
                  fill="#62756d"
                  fontSize="8"
                  fontFamily="DM Mono"
                >
                  {c.pressure.toFixed(0)} PSI
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

class CanvasErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function NetworkScene() {
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const extension = gl.getExtension("WEBGL_lose_context");
        extension?.loseContext();
      }
      setWebglAvailable(Boolean(gl));
    } catch {
      setWebglAvailable(false);
    }
  }, []);
  if (webglAvailable === null) {
    return <div className="scene-loading">Preparing network view…</div>;
  }
  if (!webglAvailable) return <StaticNetwork />;
  return (
    <CanvasErrorBoundary onError={() => setWebglAvailable(false)}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        fallback={<StaticNetwork />}
      >
        <PerspectiveCamera makeDefault position={[9, 8, 11]} fov={38} />
        <SceneContents />
      </Canvas>
    </CanvasErrorBoundary>
  );
}
