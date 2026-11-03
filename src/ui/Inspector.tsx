import { Link2, Link2Off, Power, Trash2, X } from "lucide-react";
import { catalog } from "../domain/catalog";
import type { ComponentEntity, Vec3 } from "../domain/types";
import { useStore } from "../state/stores";
import { PartIcon } from "./PartIcon";

const FLUIDS = ["Fresh water", "Hard water", "Salt water", "Waste water"];
const MATERIALS = ["PVC", "Steel", "Brass", "Chrome", "Glass"];
const AXES = ["X", "Y", "Z"] as const;

const typeName = (c: ComponentEntity) =>
  catalog.find((d) => d.type === c.type)?.name ?? c.type;
const round = (value: number, digits = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

function StatusBadge({ status }: { status: ComponentEntity["status"] }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

function HealthBar({ value }: { value: number }) {
  const tone = value < 35 ? "low" : value < 65 ? "mid" : "good";
  return (
    <div className={`meter ${tone}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function Overview() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const leaks = useStore((s) => s.leaks);
  const running = useStore((s) => s.running);
  const pressure = useStore((s) => s.pressure);
  const setSelected = useStore((s) => s.setSelected);
  const escaping = leaks.filter((leak) => leak.kind !== "outlet").length;
  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <div>
          <h2>Network</h2>
          <p className="muted">Select a part in the scene or below.</p>
        </div>
      </header>
      <dl className="stats">
        <div>
          <dt>Source</dt>
          <dd>{pressure} <small>psi</small></dd>
        </div>
        <div>
          <dt>Parts</dt>
          <dd>{components.length}</dd>
        </div>
        <div>
          <dt>Joints</dt>
          <dd>{connections.length}</dd>
        </div>
        <div>
          <dt>Leaks</dt>
          <dd className={escaping ? "danger-text" : ""}>{running ? escaping : "–"}</dd>
        </div>
      </dl>
      <ul className="part-list">
        {components.map((c) => (
          <li key={c.id}>
            <button onClick={() => setSelected(c.id)}>
              <span className="part-list-icon"><PartIcon type={c.type} size={18} /></span>
              <span className="part-list-name">
                <b>{c.name}</b>
                <small>{c.name === typeName(c) ? c.material : typeName(c)}</small>
              </span>
              {running ? <StatusBadge status={c.status} /> : <span className="muted small">{c.material}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NumberTriplet(
  { label, values, step, onChange }: {
    label: string;
    values: Vec3;
    step: number;
    onChange: (next: Vec3) => void;
  },
) {
  return (
    <fieldset className="triplet">
      <legend>{label}</legend>
      {AXES.map((axis, i) => (
        <label key={axis}>
          <span className={`axis-tag ${axis.toLowerCase()}`}>{axis}</span>
          <input
            aria-label={`${label} ${axis}`}
            type="number"
            step={step}
            value={round(values[i])}
            onChange={(e) => {
              const next: Vec3 = [...values];
              next[i] = Number(e.target.value);
              onChange(next);
            }}
          />
        </label>
      ))}
    </fieldset>
  );
}

function PartDetails({ c }: { c: ComponentEntity }) {
  const running = useStore((s) => s.running);
  const connections = useStore((s) => s.connections);
  const components = useStore((s) => s.components);
  const connectionMode = useStore((s) => s.connectionMode);
  const customAssets = useStore((s) => s.customAssets);
  const {
    setSelected,
    setFluid,
    setAgeDays,
    setMaterial,
    move,
    setRotation3,
    toggleValve,
    remove,
    disconnect,
    setConnectionMode,
  } = useStore.getState();
  const description = customAssets.find((a) => a.id === c.customAssetId)?.description ??
    String(catalog.find((d) => d.type === c.type)?.properties.description ?? "");
  const joints = connections
    .filter((edge) => edge.fromComponent === c.id || edge.toComponent === c.id)
    .map((edge) => {
      const mine = edge.fromComponent === c.id;
      const otherId = mine ? edge.toComponent : edge.fromComponent;
      return {
        edge,
        port: mine ? edge.fromPort : edge.toPort,
        other: components.find((x) => x.id === otherId),
      };
    });
  const rotation: Vec3 = c.rotation3 ?? [0, c.rotation, 0];
  const switchable = c.type === "valve" || c.type === "tap";
  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <span className="part-avatar"><PartIcon type={c.type} size={22} /></span>
        <div className="grow">
          <h2>{c.name}</h2>
          <p className="muted">{typeName(c)} · {c.material}</p>
        </div>
        <button className="icon-btn" aria-label="Close inspector" onClick={() => setSelected(null)}>
          <X size={16} />
        </button>
      </header>
      {description && <p className="description">{description}</p>}

      {switchable && (
        <button
          className={`switch ${c.open ? "on" : "off"}`}
          aria-pressed={c.open}
          onClick={() => toggleValve(c.id)}
        >
          <Power size={15} />
          <span>{c.type === "tap" ? "Outlet" : "Valve"} {c.open ? "open" : "closed"}</span>
          <small>{c.open ? "Click to close" : "Click to open"}</small>
        </button>
      )}

      <section className="section">
        <h3>
          Live status
          {running ? <StatusBadge status={c.status} /> : <span className="muted small">Run a simulation</span>}
        </h3>
        <dl className="readouts">
          <div>
            <dt>Pressure</dt>
            <dd>{running ? c.pressure.toFixed(1) : "–"} <small>psi</small></dd>
          </div>
          <div>
            <dt>Flow</dt>
            <dd>{running ? c.flow.toFixed(1) : "–"} <small>L/min</small></dd>
          </div>
        </dl>
        <div className="health">
          <div className="health-row">
            <span>Health</span>
            <b>{Math.round(c.health ?? 100)}%</b>
          </div>
          <HealthBar value={c.health ?? 100} />
          <p className="muted small">
            {c.lifeDays === undefined ? "Service life estimated after a simulation." : `About ${c.lifeDays} days of service left.`}
          </p>
        </div>
      </section>

      <section className="section">
        <h3>Configuration</h3>
        <div className="field-grid">
          <label className="field">
            <span>Material</span>
            <select value={c.material} onChange={(e) => setMaterial(c.id, e.target.value)}>
              {MATERIALS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Fluid</span>
            <select value={c.fluid ?? "Fresh water"} onChange={(e) => setFluid(c.id, e.target.value)}>
              {FLUIDS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Service age (days)</span>
            <input
              type="number"
              min={0}
              value={c.ageDays ?? 0}
              onChange={(e) => setAgeDays(c.id, Math.max(0, Number(e.target.value)))}
            />
          </label>
          <div className="field">
            <span>Rating</span>
            <output>{c.maxPressure} psi</output>
          </div>
        </div>
      </section>

      <section className="section">
        <h3>Transform</h3>
        <NumberTriplet label="Position (m)" values={c.position} step={.5} onChange={(p) => move(c.id, p)} />
        <NumberTriplet
          label="Rotation (°)"
          values={rotation.map((r) => r * 180 / Math.PI) as Vec3}
          step={15}
          onChange={(deg) => setRotation3(c.id, deg.map((d) => d * Math.PI / 180) as Vec3)}
        />
      </section>

      <section className="section">
        <h3>
          Connections
          <span className="muted small">{joints.length} of {c.ports.length} ports</span>
        </h3>
        {joints.length > 0
          ? (
            <ul className="joint-list">
              {joints.map(({ edge, port, other }) => (
                <li key={edge.id}>
                  <span className="joint-port">{port}</span>
                  <span className="grow">{other?.name ?? "Missing part"}</span>
                  <button
                    className="icon-btn"
                    aria-label={`Disconnect from ${other?.name ?? "part"}`}
                    title="Disconnect"
                    onClick={() => disconnect(edge.fromComponent, edge.toComponent)}
                  >
                    <Link2Off size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )
          : <p className="muted small">Not connected. Drag it next to another part's port, or connect manually.</p>}
        <button
          className={`btn block ${connectionMode ? "active" : ""}`}
          onClick={() => setConnectionMode(!connectionMode)}
        >
          <Link2 size={15} />
          {connectionMode ? "Click the part to connect to…" : "Connect to another part"}
        </button>
      </section>

      <button className="btn block danger-ghost" onClick={() => remove(c.id)}>
        <Trash2 size={15} /> Delete part
      </button>
    </div>
  );
}

export function Inspector() {
  const selected = useStore((s) =>
    s.selected ? s.components.find((c) => c.id === s.selected) : undefined
  );
  return selected ? <PartDetails c={selected} /> : <Overview />;
}
