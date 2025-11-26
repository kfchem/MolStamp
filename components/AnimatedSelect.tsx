"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDownIcon, CheckIcon } from "@heroicons/react/24/solid";

type Option<T extends string> = {
  value: T;
  label: string;
};

export type AnimatedSelectProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: Option<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function AnimatedSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled,
  className = "",
}: AnimatedSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const current = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  // click outside to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-left text-sm shadow-sm transition hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? "ring-2 ring-sky-400 border-sky-300" : ""
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`block ${current ? "text-slate-900" : "text-slate-400"}`}
        >
          {current?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={listRef}
            initial={{ opacity: 0, scale: 0.98, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
            role="listbox"
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                    selected ? "bg-sky-50 text-sky-700" : "text-slate-800"
                  }`}
                >
                  <span>{opt.label}</span>
                  {selected ? (
                    <CheckIcon className="h-4 w-4 text-sky-600" aria-hidden />
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
