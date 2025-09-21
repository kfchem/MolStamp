"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { Variants } from "framer-motion";

type Props = {
  open: boolean;
  onToggle: () => void;
};

// 背景のバブル（右上のボタン位置から円が拡大）
const bubbleVariants: Variants = {
  open: {
    clipPath: [
      // アニメの立ち上がりをスムーズに
      "circle(28px at calc(100% - 24px) 24px)",
      "circle(140vmax at calc(100% - 24px) 24px)",
    ],
    transition: {
      type: "spring",
      stiffness: 24,
      restDelta: 2,
    },
  },
  closed: {
    clipPath: "circle(28px at calc(100% - 24px) 24px)",
    transition: {
      delay: 0.1,
      type: "spring",
      stiffness: 420,
      damping: 42,
    },
  },
};

const Path = (props: any) => (
  <motion.path
    fill="transparent"
    strokeWidth="2.2"
    stroke="currentColor"
    strokeLinecap="round"
    {...props}
  />
);

export const MorphingMenuButton = ({ open, onToggle }: Props) => {
  return (
    <button
      type="button"
      aria-label={open ? "Close menu" : "Open menu"}
      aria-pressed={open}
      onClick={onToggle}
      className="relative z-[60] inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition hover:text-sky-600"
    >
      <svg width="23" height="23" viewBox="0 0 23 23" className="h-5 w-5">
        <Path
          variants={{
            closed: { d: "M 2 2.5 L 20 2.5" },
            open: { d: "M 3 16.5 L 17 2.5" },
          }}
          animate={open ? "open" : "closed"}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
        <Path
          d="M 2 9.423 L 20 9.423"
          variants={{
            closed: { opacity: 1 },
            open: { opacity: 0 },
          }}
          animate={open ? "open" : "closed"}
          transition={{ duration: 0.12 }}
        />
        <Path
          variants={{
            closed: { d: "M 2 16.346 L 20 16.346" },
            open: { d: "M 3 2.5 L 17 16.346" },
          }}
          animate={open ? "open" : "closed"}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </svg>
    </button>
  );
};
