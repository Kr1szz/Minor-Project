import { type ReactNode, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Outlines, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { ComponentEntity, CustomAsset, Status, Vec3 } from "../domain/types";

// Every model is built around its catalog ports (src/domain/catalog.ts): the
// geometry must end exactly on each port so neighbouring parts meet flush.

type Look = { color: string; metalness: number; roughness: number; opacity?: number };
type Surface = Look & { emissive: string; emissiveIntensity: number; opacity: number };

/** Surface finish for each material the inspector offers. */
const materialLooks: Record<string, Look> = {
  PVC: { color: "#e3e6e1", metalness: 0, roughness: .48 },
  Steel: { color: "#a2acaf", metalness: .85, roughness: .3 },
  Brass: { color: "#c49a45", metalness: .9, roughness: .27 },
  Chrome: { color: "#eef2f3", metalness: 1, roughness: .1 },
  Glass: { color: "#d4edf2", metalness: 0, roughness: .04, opacity: .42 },
};
const statusColors: Partial<Record<Status, string>> = {
  failed: "#e5484d",
  warning: "#f5a524",
};
const STEEL = materialLooks.Steel;
const GRIP: Look = { color: "#c8443f", metalness: 0, roughness: .62 };
const DARK: Look = { color: "#1c2426", metalness: .2, roughness: .7 };
const WATER = "#3aa6dc";
const GHOST: Surface = {
  color: "#3fae8f",
  metalness: 0,
  roughness: .6,
  emissive: "#3fae8f",
  emissiveIntensity: .3,
  opacity: .45,
};

function surface(look: Look, status: Status, xray = false): Surface {
  const tint = statusColors[status];
  const color = tint
    ? `#${new THREE.Color(look.color).lerp(new THREE.Color(tint), .7).getHexString()}`
    : look.color;
  return {
    ...look,
    color,
    emissive: tint ?? "#000000",
    emissiveIntensity: tint ? .35 : 0,
    // While water flows, pipe walls turn translucent so the flow inside shows.
    opacity: xray ? Math.min(look.opacity ?? 1, .3) : look.opacity ?? 1,
  };
}

function Finish({ look }: { look: Surface }) {
  const see = look.opacity < 1;
  return (
    <meshStandardMaterial
      color={look.color}
      metalness={look.metalness}
      roughness={look.roughness}
      emissive={look.emissive}
      emissiveIntensity={look.emissiveIntensity}
      transparent={see}
      opacity={look.opacity}
      depthWrite={!see}
    />
  );
}

type PartProps = JSX.IntrinsicElements["mesh"] & {
  look: Surface;
  outline?: ReactNode;
};
/** A solid piece of a model: shared finish, shadows and selection outline. */
function Part({ look, outline, children, ...props }: PartProps) {
  return (
    <mesh castShadow receiveShadow {...props}>
      {children}
      <Finish look={look} />
      {outline}
    </mesh>
  );
}

const alongX: Vec3 = [0, 0, Math.PI / 2];
const alongZ: Vec3 = [Math.PI / 2, 0, 0];

/** Socket fitting that ends on a port, with chamfer rings and a dark bore. */
function Coupling(
  { at, axis, outward, look, outline, radius = .165, length = .16 }: {
    at: Vec3;
    axis: "x" | "z";
    outward: 1 | -1;
    look: Surface;
    outline?: ReactNode;
    radius?: number;
    length?: number;
  },
) {
  // The fitting's open face sits on `at`; its body extends back into the part.
  const offset = -outward * length / 2;
  const center: Vec3 = axis === "x"
    ? [at[0] + offset, at[1], at[2]]
    : [at[0], at[1], at[2] + offset];
  // The bore disc sits just proud of the open face so it never z-fights with it.
  const face: Vec3 = axis === "x"
    ? [at[0] + outward * .002, at[1], at[2]]
    : [at[0], at[1], at[2] + outward * .002];
  const faceTurn = axis === "x" ? outward * Math.PI / 2 : outward === 1 ? 0 : Math.PI;
  return (
    <group>
      <group position={center} rotation={axis === "x" ? alongX : alongZ}>
        <Part look={look} outline={outline}>
          <cylinderGeometry args={[radius, radius, length, 40]} />
        </Part>
        {[-length / 2, length / 2].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, .011, 10, 40]} />
            <Finish look={look} />
          </mesh>
        ))}
      </group>
      <mesh position={face} rotation={[0, faceTurn, 0]}>
        <circleGeometry args={[radius * .66, 32]} />
        <meshStandardMaterial color={DARK.color} roughness={.8} />
      </mesh>
    </group>
  );
}

/** Water moving through a straight run along X, shown while it flows. */
function StraightFlow({ length, direction }: { length: number; direction: 1 | -1 }) {
  const beads = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    beads.current?.children.forEach((bead, i, all) => {
      const t = (clock.elapsedTime * .55 + i / all.length) % 1;
      bead.position.x = (t - .5) * length * direction;
    });
  });
  return (
    <group>
      <mesh rotation={alongX}>
        <cylinderGeometry args={[.1, .1, length, 24, 1, true]} />
        <meshStandardMaterial color={WATER} transparent opacity={.6} roughness={.1} depthWrite={false} />
      </mesh>
      <group ref={beads}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[.034, 10, 10]} />
            <meshBasicMaterial color="#d9f4ff" toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

class ElbowArc extends THREE.Curve<THREE.Vector3> {
  // Quarter circle centred on (-.62, 0, -.62) through the inlet (-.62, 0, 0)
  // and the outlet (0, 0, -.62), tangent to each port's axis.
  constructor() {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI / 2;
    return target.set(-.62 + .62 * Math.sin(a), 0, -.62 + .62 * Math.cos(a));
  }
}
const elbowArc = new ElbowArc();

function ArcFlow({ direction }: { direction: 1 | -1 }) {
  const beads = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    beads.current?.children.forEach((bead, i, all) => {
      const t = (clock.elapsedTime * .55 + i / all.length) % 1;
      elbowArc.getPoint(direction === 1 ? t : 1 - t, bead.position);
    });
  });
  return (
    <group>
      <mesh>
        <tubeGeometry args={[elbowArc, 40, .1, 20, false]} />
        <meshStandardMaterial color={WATER} transparent opacity={.6} roughness={.1} depthWrite={false} />
      </mesh>
      <group ref={beads}>
        {Array.from({ length: 4 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[.034, 10, 10]} />
            <meshBasicMaterial color="#d9f4ff" toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

type ModelProps = {
  c: ComponentEntity;
  body: Surface;
  trim: Surface;
  outline?: ReactNode;
  flowing: boolean;
  flowDirection: 1 | -1;
};

function PipeModel({ body, trim, outline, flowing, flowDirection }: ModelProps) {
  return (
    <group>
      <Part look={body} outline={outline} rotation={alongX}>
        <cylinderGeometry args={[.13, .13, 1.7, 40, 1, true]} />
      </Part>
      <Coupling at={[-1, 0, 0]} axis="x" outward={-1} look={trim} outline={outline} />
      <Coupling at={[1, 0, 0]} axis="x" outward={1} look={trim} outline={outline} />
      {flowing && <StraightFlow length={1.84} direction={flowDirection} />}
    </group>
  );
}

function ElbowModel({ body, trim, outline, flowing, flowDirection }: ModelProps) {
  return (
    <group>
      <Part look={body} outline={outline}>
        <tubeGeometry args={[elbowArc, 48, .13, 36, false]} />
      </Part>
      <Coupling at={[-.62, 0, 0]} axis="x" outward={-1} look={trim} outline={outline} />
      <Coupling at={[0, 0, -.62]} axis="z" outward={-1} look={trim} outline={outline} />
      {flowing && <ArcFlow direction={flowDirection} />}
    </group>
  );
}

function ValveModel({ c, body, outline }: ModelProps) {
  const lever = surface(STEEL, "normal");
  const grip = surface(GRIP, "normal");
  return (
    <group>
      <Part look={body} outline={outline}>
        <sphereGeometry args={[.2, 40, 28]} />
      </Part>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part look={body} outline={outline} position={[side * .27, 0, 0]} rotation={alongX}>
            <cylinderGeometry args={[.165, .165, .12, 6]} />
          </Part>
          <Coupling
            at={[side * .39, 0, 0]}
            axis="x"
            outward={side as 1 | -1}
            look={body}
            outline={outline}
            radius={.13}
            length={.06}
          />
        </group>
      ))}
      <Part look={body} position={[0, .21, 0]}>
        <cylinderGeometry args={[.06, .06, .05, 6]} />
      </Part>
      <Part look={lever} position={[0, .27, 0]}>
        <cylinderGeometry args={[.03, .03, .1, 16]} />
      </Part>
      {/* A ball valve's lever runs along the pipe when open and across it when shut. */}
      <group position={[0, .33, 0]} rotation={[0, c.open ? 0 : -Math.PI / 2, 0]}>
        <RoundedBox args={[.44, .035, .07]} radius={.014} position={[.16, 0, 0]} castShadow>
          <Finish look={lever} />
        </RoundedBox>
        <RoundedBox args={[.2, .055, .09]} radius={.022} position={[.3, 0, 0]} castShadow>
          <Finish look={grip} />
        </RoundedBox>
      </group>
    </group>
  );
}

function TankModel({ c, body, outline }: ModelProps) {
  const steel = surface(STEEL, "normal");
  const ratio = Math.min(1.2, c.pressure / Math.max(1, c.maxPressure));
  return (
    <group>
      <Part look={body} outline={outline} position={[0, .2, 0]}>
        <cylinderGeometry args={[.46, .46, 1.3, 56]} />
      </Part>
      {[.85, -.45].map((y) => (
        <group key={y}>
          <Part look={body} outline={outline} position={[0, y, 0]} scale={[1, .42, 1]}>
            <sphereGeometry args={[.46, 56, 28]} />
          </Part>
          <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[.462, .009, 8, 64]} />
            <Finish look={steel} />
          </mesh>
        </group>
      ))}
      {[Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6].map((angle) => (
        <group key={angle} position={[Math.cos(angle) * .3, 0, Math.sin(angle) * .3]}>
          <Part look={steel} position={[0, -.8, 0]}>
            <cylinderGeometry args={[.032, .032, .6, 16]} />
          </Part>
          <Part look={steel} position={[0, -1.09, 0]}>
            <cylinderGeometry args={[.075, .075, .02, 24]} />
          </Part>
        </group>
      ))}
      {/* Outlet nozzle and bolted flange ending on the port at (.59, .25, 0). */}
      <Part look={body} position={[.485, .25, 0]} rotation={alongX}>
        <cylinderGeometry args={[.09, .09, .13, 32]} />
      </Part>
      <Coupling at={[.59, .25, 0]} axis="x" outward={1} look={steel} radius={.155} length={.04} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = i * Math.PI / 3;
        return (
          <mesh key={i} position={[.592, .25 + Math.sin(a) * .12, Math.cos(a) * .12]} rotation={alongX}>
            <cylinderGeometry args={[.014, .014, .02, 8]} />
            <Finish look={steel} />
          </mesh>
        );
      })}
      {/* Pressure gauge; the needle follows the simulated pressure. */}
      <Part look={steel} position={[0, 1.11, 0]}>
        <cylinderGeometry args={[.02, .02, .14, 12]} />
      </Part>
      <group position={[0, 1.27, 0]}>
        <Part look={steel} rotation={alongZ}>
          <cylinderGeometry args={[.1, .1, .045, 40]} />
        </Part>
        <mesh position={[0, 0, .024]}>
          <circleGeometry args={[.084, 40]} />
          <meshStandardMaterial color="#f6f7f2" roughness={.4} />
        </mesh>
        <mesh position={[0, 0, .027]} rotation={[0, 0, Math.PI * .75 - ratio * Math.PI * 1.5]}>
          <planeGeometry args={[.012, .14]} />
          <meshBasicMaterial color="#c8443f" />
        </mesh>
      </group>
    </group>
  );
}

function TapModel({ c, body, outline }: ModelProps) {
  const spout = useMemo(() =>
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(.083, .1, .056),
      new THREE.Vector3(.31, .17, .21),
      new THREE.Vector3(.34, .03, .23),
    ), []);
  const grip = surface(GRIP, "normal");
  return (
    <group>
      <Part look={body} outline={outline} position={[-.3, 0, 0]} rotation={alongX}>
        <cylinderGeometry args={[.07, .07, .4, 32]} />
      </Part>
      <Coupling at={[-.5, 0, 0]} axis="x" outward={-1} look={body} outline={outline} radius={.1} length={.08} />
      <Part look={body} outline={outline} position={[0, .04, 0]}>
        <cylinderGeometry args={[.1, .1, .34, 40]} />
      </Part>
      {[-.13, .21].map((y) => (
        <Part key={y} look={body} position={[0, y, 0]} scale={[1, .4, 1]}>
          <sphereGeometry args={[.1, 32, 16]} />
        </Part>
      ))}
      <Part look={body} outline={outline}>
        <tubeGeometry args={[spout, 32, .045, 20, false]} />
      </Part>
      <Part look={body} position={[.34, .025, .23]}>
        <cylinderGeometry args={[.055, .05, .05, 24]} />
      </Part>
      {/* Lever handle: turned toward the spout when open. */}
      <group position={[0, .27, 0]} rotation={[0, c.open ? -Math.PI / 4 : Math.PI / 4, 0]}>
        <Part look={body} position={[0, -.02, 0]}>
          <cylinderGeometry args={[.035, .035, .05, 16]} />
        </Part>
        <RoundedBox args={[.26, .028, .05]} radius={.012} position={[.1, 0, 0]} castShadow>
          <Finish look={body} />
        </RoundedBox>
        <mesh position={[.23, 0, 0]} castShadow>
          <sphereGeometry args={[.03, 16, 12]} />
          <Finish look={grip} />
        </mesh>
      </group>
    </group>
  );
}

function CustomModel({ body, trim, outline }: ModelProps) {
  const panel = surface(DARK, "normal");
  return (
    <group>
      <RoundedBox args={[.72, .44, .44]} radius={.06} castShadow receiveShadow>
        <Finish look={body} />
        {outline}
      </RoundedBox>
      <mesh position={[0, 0, .222]}>
        <planeGeometry args={[.42, .2]} />
        <Finish look={panel} />
      </mesh>
      {[-1, 1].map((side) => (
        <Part key={side} look={trim} outline={outline} position={[side * .6, 0, 0]} rotation={alongX}>
          <cylinderGeometry args={[.13, .13, .48, 32]} />
        </Part>
      ))}
      <Coupling at={[-1, 0, 0]} axis="x" outward={-1} look={trim} outline={outline} />
      <Coupling at={[1, 0, 0]} axis="x" outward={1} look={trim} outline={outline} />
    </group>
  );
}

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
function GlbModel({ url }: { url: string }) {
  return <CenteredModel object={useLoader(GLTFLoader, url).scene} />;
}
function ObjModel({ url }: { url: string }) {
  return <CenteredModel object={useLoader(OBJLoader, url)} />;
}
function FbxModel({ url }: { url: string }) {
  return <CenteredModel object={useLoader(FBXLoader, url)} />;
}
function ImportedModel({ asset }: { asset: CustomAsset }) {
  if (asset.format === "glb") return <GlbModel url={asset.dataUrl!} />;
  if (asset.format === "obj") return <ObjModel url={asset.dataUrl!} />;
  return <FbxModel url={asset.dataUrl!} />;
}

const models = {
  pipe: PipeModel,
  "curved-pipe": ElbowModel,
  valve: ValveModel,
  tank: TankModel,
  tap: TapModel,
  custom: CustomModel,
};

export function PartModel(
  {
    c,
    asset,
    ghost = false,
    selected = false,
    flowing = false,
    flowDirection = 1,
    showPorts = false,
  }: {
    c: ComponentEntity;
    asset?: CustomAsset;
    ghost?: boolean;
    selected?: boolean;
    flowing?: boolean;
    flowDirection?: 1 | -1;
    showPorts?: boolean;
  },
) {
  const look = materialLooks[c.material] ?? STEEL;
  const xray = flowing && (c.type === "pipe" || c.type === "curved-pipe");
  const body = ghost ? GHOST : surface(look, c.status, xray);
  const trim = ghost ? GHOST : surface(look, c.status);
  const outline = selected && !ghost
    ? <Outlines thickness={.024} color="#1f8a70" />
    : null;
  const Model = models[c.type];
  return (
    <group>
      {c.type === "custom" && asset?.dataUrl && asset.format
        ? <ImportedModel asset={asset} />
        : (
          <Model
            c={c}
            body={body}
            trim={trim}
            outline={outline}
            flowing={flowing && !ghost}
            flowDirection={flowDirection}
          />
        )}
      {showPorts && c.ports.map((port) => (
        <mesh key={port.id} position={port.position}>
          <sphereGeometry args={[.05, 16, 12]} />
          <meshStandardMaterial color="#19a37d" emissive="#19a37d" emissiveIntensity={.6} />
        </mesh>
      ))}
    </group>
  );
}
