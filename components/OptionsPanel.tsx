"use client";

import { StyleSettings } from "@/lib/chem/types";

export type OptionsPanelProps = {
  value: StyleSettings;
  onChange: (settings: StyleSettings) => void;
  disabled?: boolean;
};

const QUALITY_LABELS: Record<StyleSettings["quality"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  ultra: "Ultra",
};
const MATERIAL_LABELS: Record<StyleSettings["material"], string> = {
  standard: "Standard",
  metal: "Metal",
  toon: "Toon",
  glass: "Glass",
};
const formatAtomScale = (value: number): string => `${value.toFixed(2)}× vdW`;

export const OptionsPanel = ({ value, onChange, disabled }: OptionsPanelProps) => {
  const update = (partial: Partial<StyleSettings>) => onChange({ ...value, ...partial });
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${disabled ? "opacity-60" : ""}`}>
      <h2 className="text-lg font-semibold text-slate-900">Rendering Options</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-slate-700">Material</label>
          <select
            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={value.material}
            onChange={(e) => update({ material: e.target.value as StyleSettings["material"] })}
            disabled={disabled}
          >
            {Object.entries(MATERIAL_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flex justify-between text-sm font-medium text-slate-700">
            <span>Quality</span>
            <span className="text-slate-500">{QUALITY_LABELS[value.quality]}</span>
          </label>
          <select
            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={value.quality}
            onChange={(event) => update({ quality: event.target.value as StyleSettings["quality"] })}
            disabled={disabled}
          >
            {Object.entries(QUALITY_LABELS).map(([quality, label]) => (
              <option key={quality} value={quality}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flex justify-between text-sm font-medium text-slate-700">
            <span>Atom scale</span>
            <span className="text-slate-500">{formatAtomScale(value.atomScale)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={value.atomScale}
            onChange={(event) => update({ atomScale: Number.parseFloat(event.target.value) })}
            disabled={disabled}
            className="mt-3 w-full accent-sky-500"
          />
        </div>
        <div>
          <label className="flex justify-between text-sm font-medium text-slate-700">
            <span>Bond radius</span>
            <span className="text-slate-500">{value.bondRadius.toFixed(2)} Å</span>
          </label>
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.01}
            value={value.bondRadius}
            onChange={(event) => update({ bondRadius: Number.parseFloat(event.target.value) })}
            disabled={disabled}
            className="mt-3 w-full accent-sky-500"
          />
        </div>
      </div>
    </div>
  );
};

OptionsPanel.displayName = "OptionsPanel";
