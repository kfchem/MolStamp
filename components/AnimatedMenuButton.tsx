"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AdjustmentsHorizontalIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { ButtonHTMLAttributes } from "react";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

type Props = {
  open: boolean;
  onToggle: () => void;
  className?: string;
  disabled?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">;

/**
 * AnimatedMenuButton
 * - Small circular button whose SVG frame morphs when open.
 * - Uses Heroicons for glyphs and framer-motion for subtle morph/scale.
 * - Self-contained; safe to reuse without altering other pages.
 */
export const AnimatedMenuButton = ({ open, onToggle, className, disabled, ...rest }: Props) => {
  return (
    <button
      type="button"
      aria-label={open ? "Close menu" : "Rendering Options"}
      aria-pressed={open}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "group relative inline-flex h-11 w-11 items-center justify-center",
        "rounded-full bg-white text-slate-700 shadow-sm",
        "transition hover:text-sky-600",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...rest}
    >
      {/* Morphing frame */}
      <motion.svg
        viewBox="0 0 48 48"
        aria-hidden
        className="absolute inset-0 z-0 h-full w-full pointer-events-none"
        initial={false}
        animate={{ scale: open ? 1.35 : 1, x: open ? 6 : 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
        style={{ transformOrigin: "right center" }}
      >
        {/* Base frame */}
        <motion.rect
          x={2}
          y={2}
          width={44}
          height={44}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          animate={{ rx: open ? 8 : 22, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
        />

        {/* Right-side panel silhouette (outline grows in) */}
        <motion.g
          initial={false}
          animate={{ opacity: open ? 1 : 0, scaleX: open ? 1 : 0 }}
          style={{ transformOrigin: "right center" }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
        >
          <rect
            x={24}
            y={6}
            width={24}
            height={36}
            rx={10}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </motion.g>
      </motion.svg>

      {/* Icon swap */}
      <div className="relative z-10">
        <AnimatePresence mode="popLayout" initial={false}>
          {open ? (
            <motion.span
              key="x"
              initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="block h-5 w-5"
            >
              <XMarkIcon className="h-5 w-5" />
            </motion.span>
          ) : (
            <motion.span
              key="adj"
              initial={{ opacity: 0, scale: 0.8, rotate: 10 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.8, rotate: -10 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="block h-5 w-5"
            >
              <AdjustmentsHorizontalIcon className="h-5 w-5" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </button>
  );
};
