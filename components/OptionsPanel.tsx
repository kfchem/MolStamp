"use client";
import { StyleSettings } from "@/lib/chem/types";
import { AnimatedSelect } from "./AnimatedSelect";

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
//

export const OptionsPanel = ({ value, onChange, disabled }: OptionsPanelProps) => {
  const update = (partial: Partial<StyleSettings>) => onChange({ ...value, ...partial });
  return (
    <div className={`rounded-xl border border-slate-300 bg-white p-4 shadow-sm ${disabled ? "opacity-60" : ""}`}>
      <h2 className="text-lg font-semibold text-slate-900">Rendering Options</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <label className="flex justify-between text-sm font-medium text-slate-700">
            <span>Atom scale</span>
            <span className="text-slate-500">× {value.atomScale.toFixed(2)}</span>
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
        <div>
          <label className="flex justify-between text-sm font-medium text-slate-700">
            <span>Material</span>
            <span className="text-slate-500">{MATERIAL_LABELS[value.material]}</span>
          </label>
          <AnimatedSelect
            className="mt-2"
            value={value.material}
            onChange={(v) => update({ material: v })}
            options={Object.entries(MATERIAL_LABELS).map(([value, label]) => ({ value: value as StyleSettings["material"], label }))}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="flex justify-between text-sm font-medium text-slate-700">
            <span>Quality</span>
            <span className="text-slate-500">{QUALITY_LABELS[value.quality]}</span>
          </label>
          <AnimatedSelect
            className="mt-2"
            value={value.quality}
            onChange={(v) => update({ quality: v })}
            options={Object.entries(QUALITY_LABELS).map(([value, label]) => ({ value: value as StyleSettings["quality"], label }))}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
};

OptionsPanel.displayName = "OptionsPanel";
