import { Component, useEffect, useMemo, useState } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type {
  ErrorInfo,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import {
  Grid,
  Html,
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { useStore } from "../state/stores";
import type { Axis } from "../state/stores";
import type {
  ComponentEntity,
  ComponentType,
  CustomAsset,
} from "../domain/types";
import { snapPlacement } from "../domain/placement";

function CenteredModel({ object }: { object: THREE.Object3D }) {
  const model = useMemo(() => {
    const copy = object.clone(true);
    const bounds = new THREE.Box3().setFromObject(copy);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 1.45 / Math.max(size.x, size.y, size.z, 0.001);
    copy.scale.multiplyScalar(scale);
    copy.position.addScaledVector(center, -scale);
    copy.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return copy;
  }, [object]);
  return <primitive object={model} />;
}

function ImportedModel({ asset }: { asset: CustomAsset }) {
  if (!asset.dataUrl || !asset.format) return null;
  if (asset.format === "glb") return <GlbModel url={asset.dataUrl} />;
  if (asset.format === "obj") return <ObjModel url={asset.dataUrl} />;
  return <FbxModel url={asset.dataUrl} />;
}
function GlbModel({ url }: { url: string }) {
  const result = useLoader(GLTFLoader, url);
  return <CenteredModel object={result.scene} />;
}
function ObjModel({ url }: { url: string }) {
  const object = useLoader(OBJLoader, url);
  return <CenteredModel object={object} />;
}
function FbxModel({ url }: { url: string }) {
  const object = useLoader(FBXLoader, url);
  return <CenteredModel object={object} />;
}

function ComponentMesh(
  { component: c, ghost = false }: {
    component: ComponentEntity;
    ghost?: boolean;
  },
) {
  const selected = useStore((s) => s.selected === c.id);
  const setSelected = useStore((s) => s.setSelected);
  const remove = useStore((s) => s.remove);
  const move = useStore((s) => s.move);
  const placing = useStore((s) => s.placing);
  const connectionMode = useStore((s) => s.connectionMode);
  const connect = useStore((s) => s.connect);
  const place = useStore((s) => s.place);
  const rotate = useStore((s) => s.rotate);
  const color = ghost
    ? "#a7ed70"
    : c.status === "failed"
    ? "#ff5262"
    : c.status === "warning"
    ? "#ffbd4a"
    : c.type === "pipe"
    ? "#97a9a9"
    : c.type === "valve"
    ? "#dcae61"
    : c.type === "tank"
    ? "#8fa5a5"
    : "#65c9d4";
  const uploadedAsset = useStore((s) =>
    s.customAssets.find((asset) => asset.id === c.customAssetId)
  );
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (ghost) return;
    if (connectionMode) {
      e.stopPropagation();
      const first = useStore.getState().selected;
      if (first) connect(first, c.id);
      else setSelected(c.id);
      return;
    }
    if (placing) {
      e.stopPropagation();
      setSelected(c.id);
    }
    // Otherwise let the event bubble to SceneContents, which selects and starts dragging.
  };
  return (
    <group
      position={c.position}
      rotation={c.rotation3 ?? [0, c.rotation, 0]}
      onPointerDown={down}
    >
      {(c.type === "pipe" || c.type === "curved-pipe") && c.type === "pipe" && (
        <>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[.15, .15, 1.9, 24, 1, true]} />
            <meshStandardMaterial
              color={color}
              metalness={.65}
              roughness={.3}
              side={THREE.DoubleSide}
              transparent
              opacity={ghost ? .48 : 1}
            />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[.115, .115, 1.86, 20, 1, true]} />
            <meshStandardMaterial color="#161f20" side={THREE.DoubleSide} />
          </mesh>
          {[-.95, .95].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[.15, .035, 8, 24]} />
              <meshStandardMaterial color="#c1cecc" metalness={.8} />
            </mesh>
          ))}
        </>
      )}
      {c.type === "curved-pipe" && (
        <group rotation={[0, Math.PI / 2, 0]}>
          <mesh castShadow rotation={[0, 0, 0]}>
            <torusGeometry args={[.62, .15, 18, 32, Math.PI / 2]} />
            <meshStandardMaterial
              color={color}
              metalness={.55}
              roughness={.32}
              side={THREE.DoubleSide}
              transparent
              opacity={ghost ? .5 : 1}
            />
          </mesh>
          <mesh rotation={[0, 0, 0]}>
            <torusGeometry args={[.62, .115, 14, 32, Math.PI / 2]} />
            <meshStandardMaterial color="#161f20" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[.62, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[.15, .03, 8, 20]} />
            <meshStandardMaterial color="#c1cecc" metalness={.8} />
          </mesh>
          <mesh position={[0, 0, -.62]}>
            <torusGeometry args={[.15, .03, 8, 20]} />
            <meshStandardMaterial color="#c1cecc" metalness={.8} />
          </mesh>
        </group>
      )}
      {c.type === "valve" && (
        <>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[.15, .15, .78, 16]} />
            <meshStandardMaterial
              color={color}
              metalness={.8}
              roughness={.22}
              transparent={ghost}
              opacity={ghost ? .5 : 1}
            />
          </mesh>
          <mesh position={[0, .3, 0]} castShadow>
            <boxGeometry args={[.08, .55, .08]} />
            <meshStandardMaterial color="#e8ba6b" metalness={.65} />
          </mesh>
          <mesh position={[0, .59, 0]} castShadow>
            <torusGeometry args={[.19, .035, 8, 24]} />
            <meshStandardMaterial color="#d4aa60" metalness={.7} />
          </mesh>
        </>
      )}
      {c.type === "tank" && (
        <>
          <mesh position={[0, .25, 0]} castShadow>
            <cylinderGeometry args={[.48, .48, 1.35, 32]} />
            <meshStandardMaterial
              color={color}
              metalness={.75}
              roughness={.27}
            />
          </mesh>
          <mesh position={[0, .94, 0]}>
            <cylinderGeometry args={[.48, .48, .08, 32]} />
            <meshStandardMaterial color="#bcc7c4" metalness={.8} />
          </mesh>
          <mesh position={[0, -.46, 0]}>
            <cylinderGeometry args={[.48, .48, .08, 32]} />
            <meshStandardMaterial color="#546969" metalness={.7} />
          </mesh>
          <mesh position={[.5, .25, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[.13, .13, .18, 16]} />
            <meshStandardMaterial color="#94aaa6" metalness={.75} />
          </mesh>
        </>
      )}
      {c.type === "tap" && (
        <group>
          <mesh position={[0, .04, 0]} castShadow>
            <cylinderGeometry args={[.09, .09, .56, 12]} />
            <meshStandardMaterial color={color} metalness={.85} />
          </mesh>
          <mesh
            position={[.13, .27, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[.07, .07, .35, 12]} />
            <meshStandardMaterial color="#d5e4e1" metalness={.9} />
          </mesh>
          <mesh position={[.13, .08, 0]}>
            <torusGeometry args={[.1, .018, 8, 20]} />
            <meshStandardMaterial color="#b5ceca" metalness={.9} />
          </mesh>
          <mesh position={[.13, .27, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[.085, .016, 8, 20]} />
            <meshStandardMaterial
              color={c.open ? "#b5ceca" : "#c97870"}
              metalness={.8}
            />
          </mesh>
          <mesh position={[.13, .27, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[.035, .18, .035]} />
            <meshStandardMaterial
              color={c.open ? "#a6e97a" : "#ef7872"}
              metalness={.4}
            />
          </mesh>
        </group>
      )}
      {!ghost && selected && (
        <Html
          center
          position={[0, 1.03, 0]}
          distanceFactor={11}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`health-marker ${
              c.health !== undefined && c.health < 35
                ? "low"
                : c.health !== undefined && c.health < 65
                ? "mid"
                : ""
            }`}
          >
            <span>HEALTH {Math.round(c.health ?? 100)}%</span>
            <div className="health-track">
              <i
                style={{
                  width: `${Math.max(0, Math.min(100, c.health ?? 100))}%`,
                }}
              />
            </div>
          </div>
        </Html>
      )}
      {c.type === "custom" && uploadedAsset?.dataUrl
        ? <ImportedModel asset={uploadedAsset} />
        : c.type === "custom" && (
          <>
            <mesh castShadow>
              <boxGeometry args={[.8, .45, .45]} />
              <meshStandardMaterial
                color={color}
                metalness={.45}
                roughness={.35}
              />
            </mesh>
            <mesh position={[-.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[.13, .13, .2, 16]} />
              <meshStandardMaterial color="#b9c9c3" metalness={.7} />
            </mesh>
            <mesh position={[.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[.13, .13, .2, 16]} />
              <meshStandardMaterial color="#b9c9c3" metalness={.7} />
            </mesh>
          </>
        )}
      {selected && !ghost && (
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[.08, 12, 12]} />
          <meshBasicMaterial color="#b3ef77" />
        </mesh>
      )}
      {!ghost && c.status === "failed" && (
        <mesh position={[0, .5, .05]}>
          <sphereGeometry args={[.13, 12, 12]} />
          <meshBasicMaterial color="#ff5365" />
        </mesh>
      )}
      {!ghost && c.ports.map((p) => (
        <mesh key={p.id} position={p.position}>
          <sphereGeometry args={[.06, 10, 10]} />
          <meshBasicMaterial color="#70d8bd" />
        </mesh>
      ))}
      {ghost && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[2.2, .08, .08]} />
          <meshBasicMaterial color="#a7ed70" transparent opacity={.2} />
        </mesh>
      )}
      <group onPointerDown={down} />
    </group>
  );
}
function WaterFlow({ length }: { length: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = (clock.elapsedTime * 1.8) % Math.max(.1, length);
      ref.current.position.y = -length / 2 + t;
    }
  });
  return (
    <group ref={ref}>
      {[-.07, 0, .07].map((x, i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <sphereGeometry args={[.085, 12, 12]} />
          <meshBasicMaterial
            color={i === 1 ? "#a8edff" : "#50c5f6"}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
function Leak({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = position[1] - .12 -
        Math.abs(Math.sin(clock.elapsedTime * 3)) * .55;
    }
  });
  return (
    <group ref={ref} position={position}>
      <mesh>
        <sphereGeometry args={[.075, 10, 10]} />
        <meshBasicMaterial color="#75d9ff" transparent opacity={.9} />
      </mesh>
      <mesh position={[0, -.14, 0]}>
        <cylinderGeometry args={[.035, .012, .28, 8]} />
        <meshBasicMaterial color="#75d9ff" transparent opacity={.45} />
      </mesh>
    </group>
  );
}
function WaterJet(
  { position, outlet = false, broken = false, pressure = 0 }: {
    position: [number, number, number];
    outlet?: boolean;
    broken?: boolean;
    pressure?: number;
  },
) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.scale.y = .8 + Math.abs(Math.sin(clock.elapsedTime * 5)) * .6;
      ref.current.rotation.z = broken
        ? Math.sin(clock.elapsedTime * 7) * .12
        : 0;
    }
  });
  return (
    <group
      ref={ref}
      position={position}
      rotation={outlet ? [0, 0, -Math.PI / 2] : [0, 0, 0]}
    >
      {Array.from(
        { length: 3 },
        (_, i) => (
          <mesh
            key={i}
            position={[
              broken ? (i - 1) * .08 : 0,
              outlet ? .12 : -.18 - i * .11,
              0,
            ]}
          >
            <cylinderGeometry
              args={[
                outlet ? .055 : .045,
                outlet ? .025 : .012,
                outlet ? .45 : .34,
                10,
              ]}
            />
            <meshBasicMaterial
              color={i === 1 ? "#a8edff" : "#50c5f6"}
              toneMapped={false}
            />
          </mesh>
        ),
      )}
      <Html center position={[0, outlet ? .64 : .05, 0]}>
        <span className={`water-tag ${broken ? "break" : ""}`}>
          {broken
            ? `BREAK · ${Math.round(pressure)} PSI`
            : outlet
            ? "OUTLET OPEN"
            : "LEAK"}
        </span>
      </Html>
    </group>
  );
}
function HandCursor({ position }: { position: THREE.Vector3 }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.z = Math.sin(clock.elapsedTime * 4) * .08;
    }
  });
  return (
    <group ref={ref} position={position}>
      <mesh position={[0, .18, 0]} rotation={[0, 0, -.15]} castShadow>
        <capsuleGeometry args={[.075, .24, 5, 10]} />
        <meshStandardMaterial color="#ecc6a1" roughness={.72} />
      </mesh>
      <mesh position={[0, .34, 0]} castShadow>
        <sphereGeometry args={[.095, 12, 12]} />
        <meshStandardMaterial color="#ecc6a1" roughness={.7} />
      </mesh>
      <mesh position={[.055, .02, .01]} rotation={[0, 0, -.8]} castShadow>
        <capsuleGeometry args={[.04, .12, 4, 8]} />
        <meshStandardMaterial color="#d9ad8b" />
      </mesh>
    </group>
  );
}
function SceneContents() {
  const components = useStore((s) => s.components);
  const running = useStore((s) => s.running);
  const pressure = useStore((s) => s.pressure);
  const leaks = useStore((s) => s.leaks);
  const placing = useStore((s) => s.placing);
  const selected = useStore((s) => s.selected);
  const connections = useStore((s) => s.connections);
  const connectionMode = useStore((s) => s.connectionMode);
  const disconnect = useStore((s) => s.disconnect);
  const [ghostPosition, setGhostPosition] = useState<[number, number, number]>([
    0,
    .2,
    0,
  ]);
  const rotation3 = useStore((s) => s.placementRotation3);
  const setPlacementRotation3 = useStore((s) => s.setPlacementRotation3);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<
    {
      id: string;
      plane: THREE.Plane;
      offset: THREE.Vector3;
      start: [number, number, number];
      moved: boolean;
    } | null
  >(null);
  const [handPosition, setHandPosition] = useState(new THREE.Vector3(0, 0, 0));
  const place = useStore((s) => s.place);
  const setSelected = useStore((s) => s.setSelected);
  const move = useStore((s) => s.move);
  const moveLocal = useStore((s) => s.moveLocal);
  const commitMove = useStore((s) => s.commitMove);
  const remove = useStore((s) => s.remove);
  const rotate = useStore((s) => s.rotate);
  const setRotation3 = useStore((s) => s.setRotation3);
  const projectId = useStore((s) => s.projectId);
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;
  const activeCustom = useStore((s) => s.activeCustom);
  const preview = placing === "custom"
    ? {
      id: "ghost",
      type: "custom" as const,
      name: activeCustom?.name ?? "Custom preview",
      customAssetId: activeCustom?.id,
      position: ghostPosition,
      rotation: rotation3[1],
      rotation3,
      material: activeCustom?.material ?? "Steel",
      diameter: .25,
      length: 1,
      maxPressure: activeCustom?.maxPressure ?? 100,
      pressureLoss: 0,
      flowResistance: 1,
      open: true,
      opening: 1,
      ports: [],
      status: "normal" as const,
      pressure: 0,
      flow: 0,
    }
    : placing
    ? components.find((c) => c.type === placing) ?? {
      id: "ghost",
      type: placing,
      name: "Preview",
      position: ghostPosition,
      rotation: rotation3[1],
      rotation3,
      material: "PVC",
      diameter: .25,
      length: 2,
      maxPressure: 70,
      pressureLoss: 0,
      flowResistance: 1,
      open: true,
      opening: 1,
      ports: [],
      status: "normal" as const,
      pressure: 0,
      flow: 0,
    }
    : null;
  const base = preview;
  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
      ) return;
      if (
        e.key.toLowerCase() === "q" || e.key.toLowerCase() === "e" ||
        e.key.toLowerCase() === "r"
      ) {
        const axis = useStore.getState().rotateAxis;
        const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const turn = (e.key.toLowerCase() === "q" ? -1 : 1) * Math.PI / 2;
        if (placing) {
          const r: [number, number, number] = [
            ...useStore.getState().placementRotation3,
          ];
          r[i] += turn;
          setPlacementRotation3(r);
        } else if (selected) {
          const c = components.find((x) => x.id === selected);
          if (c) {
            const r: [number, number, number] = c.rotation3
              ? [...c.rotation3]
              : [0, c.rotation, 0];
            r[i] += turn;
            setRotation3(selected, r);
          }
        }
      }
      if (e.key === "Escape") {
        useStore.getState().setPlacing(null);
        if (drag.current) moveLocal(drag.current.id, drag.current.start);
        drag.current = null;
        setDragging(false);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove(selected);
      }
      if (
        selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "w", "W", "s", "S"]
          .includes(e.key)
      ) {
        const c = components.find((x) => x.id === selected);
        if (c) {
          e.preventDefault();
          const axis = useStore.getState().moveAxis;
          const p: [number, number, number] = [...c.position];
          const step = .5;
          const key = e.key;
          if (axis === "x") {
            p[0] += key === "ArrowLeft" || key === "ArrowDown" || key === "s" ||
                key === "S"
              ? -step
              : step;
          } else if (axis === "y") {
            p[1] += key === "ArrowLeft" || key === "ArrowDown" || key === "s" ||
                key === "S"
              ? -step
              : step;
          } else if (axis === "z") {
            p[2] += key === "ArrowLeft" || key === "ArrowDown" || key === "s" ||
                key === "S"
              ? -step
              : step;
          } else if (key === "ArrowLeft") p[0] -= step;
          else if (key === "ArrowRight") p[0] += step;
          else if (key === "ArrowUp") p[2] -= step;
          else if (key === "ArrowDown") p[2] += step;
          else if (key === "w" || key === "W") p[1] += step;
          else if (key === "s" || key === "S") p[1] -= step;
          move(selected, p);
        }
      }
      if (
        e.key.toLowerCase() === "x" || e.key.toLowerCase() === "y" ||
        e.key.toLowerCase() === "z"
      ) useStore.getState().setMoveAxis(e.key.toLowerCase() as Axis);
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [
    placing,
    selected,
    components,
    move,
    moveLocal,
    remove,
    rotate,
    setRotation3,
    setPlacementRotation3,
  ]);
  useEffect(() => {
    const frame = () => {
      const { components } = useStore.getState();
      if (!components.length || !controls) return;
      const bounds = new THREE.Box3();
      components.forEach((c) =>
        bounds.expandByPoint(new THREE.Vector3(...c.position))
      );
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      // Keep the default viewing angle; back off far enough to fit the network.
      const distance = Math.max(8, sphere.radius * 3.2);
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
      const p: [number, number, number] = [...active.start];
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
      setHandPosition(new THREE.Vector3(...p));
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
  const startDrag = (
    e: ThreeEvent<PointerEvent>,
    component: ComponentEntity,
  ) => {
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
    setHandPosition(origin);
  };
  const placedOnPointerDown = useRef(false);
  const placeAt = (type: ComponentType, position: [number, number, number]) => {
    placedOnPointerDown.current = true;
    place(type, position, rotation3[1], rotation3);
  };
  const getPos = (
    e: ThreeEvent<PointerEvent>,
  ): [number, number, number] => [
    Math.round(e.point.x * 2) / 2,
    Math.round(e.point.y * 2) / 2,
    Math.round(e.point.z * 2) / 2,
  ];
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight
        position={[4, 8, 5]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight
        position={[-4, 4, 1]}
        intensity={18}
        color="#7bb9bb"
        distance={16}
      />
      <Grid
        args={[40, 40]}
        position={[0, -.04, 0]}
        cellSize={1}
        cellThickness={.55}
        cellColor="#344447"
        sectionSize={5}
        sectionThickness={1.2}
        sectionColor="#52696a"
        fadeDistance={26}
        infiniteGrid
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
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
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {connections.map((c) => {
        const a = components.find((x) => x.id === c.fromComponent),
          b = components.find((x) => x.id === c.toComponent);
        if (!a || !b) return null;
        const ap = a.ports.find((p) => p.id === c.fromPort)?.position ??
            [0, 0, 0],
          bp = b.ports.find((p) => p.id === c.toPort)?.position ?? [0, 0, 0];
        const av = new THREE.Vector3(...a.position).add(
            new THREE.Vector3(...ap).applyEuler(
              new THREE.Euler(...(a.rotation3 ?? [0, a.rotation, 0])),
            ),
          ),
          bv = new THREE.Vector3(...b.position).add(
            new THREE.Vector3(...bp).applyEuler(
              new THREE.Euler(...(b.rotation3 ?? [0, b.rotation, 0])),
            ),
          );
        const delta = bv.clone().sub(av);
        const len = delta.length();
        const mid = av.clone().add(bv).multiplyScalar(.5);
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          delta.clone().normalize(),
        );
        const aligned = len <= .2;
        const flowing = running && aligned && pressure > 0 &&
          (a.flow > 0 || b.flow > 0);
        const color = aligned ? (flowing ? "#4eb8df" : "#a6b5b1") : "#e3a66d";
        return (
          <group
            key={c.id}
            position={mid}
            quaternion={q}
            onDoubleClick={(e) => {
              e.stopPropagation();
              disconnect(a.id, b.id);
            }}
          >
            {aligned
              ? (
                <>
                  <mesh castShadow>
                    <cylinderGeometry
                      args={[.15, .15, Math.max(.01, len), 20, 1, true]}
                    />
                    <meshStandardMaterial
                      color={color}
                      metalness={.55}
                      roughness={.28}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  <mesh>
                    <cylinderGeometry
                      args={[.112, .112, Math.max(.01, len - .02), 16, 1, true]}
                    />
                    <meshStandardMaterial
                      color="#121a1c"
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  {flowing && (
                    <mesh>
                      <cylinderGeometry
                        args={[.09, .09, Math.max(.05, len - .08), 12, 1]}
                      />
                      <meshBasicMaterial
                        color="#35bdf5"
                        transparent
                        opacity={.88}
                        toneMapped={false}
                      />
                    </mesh>
                  )}
                  {flowing && <WaterFlow length={Math.max(.1, len)} />}
                </>
              )
              : (
                <>
                  <mesh>
                    <cylinderGeometry args={[.018, .018, len, 8, 1, true]} />
                    <meshBasicMaterial
                      color={color}
                      transparent
                      opacity={.15}
                    />
                  </mesh>
                  {Array.from(
                    { length: Math.max(2, Math.ceil(len / .16)) },
                    (_, i) => (
                      <mesh
                        key={i}
                        position={[
                          0,
                          -len / 2 +
                          (i + .5) * len / Math.max(2, Math.ceil(len / .16)),
                          0,
                        ]}
                      >
                        <sphereGeometry args={[.025, 7, 7]} />
                        <meshBasicMaterial color={color} />
                      </mesh>
                    ),
                  )}
                </>
              )}
            {running && pressure > 0 && !aligned && (
              <Leak position={[0, 0, 0]} />
            )}
          </group>
        );
      })}
      {running &&
        leaks.map((leak) => (
          <WaterJet
            key={`${leak.component_id}-${leak.port_id}`}
            position={leak.position}
            outlet={leak.kind === "outlet"}
            broken={leak.kind === "break"}
            pressure={leak.pressure}
          />
        ))}

      {components.map((c) => (
        <group
          key={c.id}
          onPointerDown={(e) => {
            if (e.button !== 0 || placing || connectionMode) return;
            e.stopPropagation();
            setSelected(c.id);
            if (c.type !== "tap") startDrag(e, c);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ComponentMesh component={c} />
          {c.type === "tap" && selected === c.id && (
            <Html center position={[0, .9, 0]} distanceFactor={10}>
              <span className={`tap-state-tag ${c.open ? "open" : "closed"}`}>
                {c.open
                  ? "● OPEN · USE INSPECTOR TO CLOSE"
                  : "● CLOSED · USE INSPECTOR TO OPEN"}
              </span>
            </Html>
          )}
        </group>
      ))}
      {dragging && <HandCursor position={handPosition} />}
      {base && (() => {
        const snap = snapPlacement(
          placing!,
          ghostPosition,
          rotation3,
          components,
          connections,
        );
        return (
          <group
            position={snap.position}
            onPointerDown={(e) => {
              e.stopPropagation();
              placeAt(placing!, ghostPosition);
            }}
          >
            <ComponentMesh
              component={{
                ...base,
                position: [0, 0, 0],
                rotation3,
                rotation: rotation3[1],
              }}
              ghost
            />
          </group>
        );
      })()}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.052, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <OrbitControls
        enabled={!dragging}
        makeDefault
        minDistance={3}
        maxDistance={60}
        maxPolarAngle={Math.PI / 1.95}
        enableDamping
        dampingFactor={.09}
        zoomSpeed={.8}
        rotateSpeed={.65}
        panSpeed={.8}
        screenSpacePanning
      />
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
    tank: "#8fa5a5",
    pipe: "#97a9a9",
    "curved-pipe": "#97a9a9",
    valve: "#dcae61",
    tap: "#65c9d4",
    custom: "#a991cf",
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
                stroke="#293535"
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
            stroke="#be776733"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={centerY}
            x2={width}
            y2={centerY}
            stroke="#68a48f33"
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
                  stroke="#111819"
                  strokeWidth="19"
                  strokeLinecap="round"
                />
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#9eaeab"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#d2ded7"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {components.map((c) => {
            const p = point(c.position[0], c.position[2]);
            const color = c.status === "failed"
              ? "#ff5262"
              : c.status === "warning"
              ? "#ffbd4a"
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
                  fill={isSelected ? "#a7ed7022" : "#121819"}
                  stroke={isSelected ? "#a7ed70" : color}
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
                  <circle cx="18" cy="-18" r="6" fill="#ff5262" />
                )}
                <text
                  y="38"
                  textAnchor="middle"
                  fill="#b6c3ba"
                  fontSize="10"
                  fontFamily="DM Sans"
                >
                  {c.name}
                </text>
                <text
                  y="51"
                  textAnchor="middle"
                  fill="#73827b"
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
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "low-power" }}
        fallback={<StaticNetwork />}
      >
        <PerspectiveCamera makeDefault position={[9, 8, 11]} fov={42} />
        <SceneContents />
      </Canvas>
    </CanvasErrorBoundary>
  );
}
