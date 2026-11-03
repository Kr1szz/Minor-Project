import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CustomAsset } from "../domain/types";

function Dialog(
  { title, eyebrow, onClose, children }: {
    title: string;
    eyebrow?: string;
    onClose: () => void;
    children: ReactNode;
  },
) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const shortcuts: [string, string][] = [
  ["1 – 6", "Pick a part from the inventory"],
  ["Click", "Place the picked part (snaps to free ports)"],
  ["Q / E", "Rotate 90° around the chosen axis"],
  ["X / Y / Z", "Limit dragging and nudging to one axis"],
  ["Arrows, W / S", "Nudge the selected part by 0.5 m"],
  ["Delete", "Delete the selected part"],
  ["Esc", "Cancel placing, connecting or dragging"],
  ["Drag empty space", "Orbit the camera"],
  ["Shift + drag", "Pan"],
  ["Scroll", "Zoom"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard and mouse" eyebrow="Help" onClose={onClose}>
      <dl className="shortcut-list">
        {shortcuts.map(([keys, action]) => (
          <div key={keys}>
            <dt><kbd>{keys}</kbd></dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        Parts connect when their ports meet. Run a simulation to see pressure, flow, leaks and wear.
      </p>
    </Dialog>
  );
}

type NewAsset = Omit<CustomAsset, "id">;

async function readModel(file: File) {
  const format = file.name.split(".").pop()?.toLowerCase();
  if (format !== "glb" && format !== "obj" && format !== "fbx") {
    throw new Error("Choose a GLB, OBJ or FBX model file.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the model file."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the model file."));
    reader.readAsDataURL(file);
  });
  return { format: format as NonNullable<CustomAsset["format"]>, dataUrl, fileName: file.name };
}

export function CustomObjectDialog(
  { onClose, onCreate }: {
    onClose: () => void;
    onCreate: (asset: NewAsset) => Promise<void>;
  },
) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [material, setMaterial] = useState("Steel");
  const [maxPressure, setMaxPressure] = useState(100);
  const [ageDays, setAgeDays] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the object a name.");
    setSaving(true);
    try {
      const model = file ? await readModel(file) : undefined;
      await onCreate({
        name: name.trim(),
        description: description.trim() || "User-defined inline part",
        material,
        maxPressure,
        ageDays,
        ...model,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the object in this browser.");
      setSaving(false);
    }
  };
  return (
    <Dialog title="New inline part" eyebrow="Custom object" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            value={description}
            placeholder="What does this part do?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="field-grid">
          <label className="field">
            <span>Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value)}>
              <option>Steel</option>
              <option>PVC</option>
              <option>Brass</option>
            </select>
          </label>
          <label className="field">
            <span>Rating (psi)</span>
            <input type="number" min={1} value={maxPressure} onChange={(e) => setMaxPressure(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Service age (days)</span>
            <input type="number" min={0} value={ageDays} onChange={(e) => setAgeDays(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>3D model <small className="muted">optional · GLB, OBJ or FBX</small></span>
          <input
            type="file"
            accept=".glb,.obj,.fbx"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <p className="muted small">
          It connects inline like a pipe: one inlet and one outlet, 2 m apart. Without a model it shows as a generic housing.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save and place"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
