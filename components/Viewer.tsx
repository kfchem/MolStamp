"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import { Molecule, StyleSettings } from "@/lib/chem/types";
import { buildMoleculeMesh } from "@/lib/three/buildMeshes";

const fallbackStyle: StyleSettings = {
  material: "standard",
  atomScale: 0.28,
  bondRadius: 0.09,
  quality: "high",
};

type ViewerProps = {
  molecule: Molecule | null;
  style?: StyleSettings;
  onGroupReady?: (group: THREE.Group | null) => void;
  className?: string;
  showRotateControl?: boolean;
  onOrientationChange?: (q: THREE.Quaternion) => void;
};

const useFitCamera = (
  molecule: Molecule | null,
  resetTick: number,
  setZoomBounds?: (minD: number, maxD: number) => void,
  transition?: boolean,
) => {
  const { camera, controls } = useThree((state) => ({
    camera: state.camera,
    controls: state.controls as unknown,
  }));

  useEffect(() => {
    if (!molecule || molecule.atoms.length === 0) {
      return;
    }

    const center = new THREE.Vector3();
    molecule.atoms.forEach((atom) => {
      center.x += atom.x;
      center.y += atom.y;
      center.z += atom.z;
    });
    center.divideScalar(molecule.atoms.length || 1);

  let radius = 1;
    molecule.atoms.forEach((atom) => {
      const dx = atom.x - center.x;
      const dy = atom.y - center.y;
      const dz = atom.z - center.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      radius = Math.max(radius, dist + 0.5);
    });
  const minR = 0.2;
    // Allow much farther zoom-out for very large molecules and give more headroom on initial fit
    const maxR = Math.max(200, radius * 8);
    const desiredR = Math.max(radius * 3.8, 6);
    const r = Math.min(Math.max(desiredR, minR), maxR);
    const d = r / Math.sqrt(3);
    const pos = new THREE.Vector3(center.x + d, center.y + d, center.z + d);
  camera.near = 0.01;
    camera.far = Math.max(20000, radius * 24);
    camera.updateProjectionMatrix();
    setZoomBounds?.(minR, maxR);
    const anyControls = controls as any;
    if (anyControls?.setLookAt) {
      anyControls.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, Boolean(transition));
    } else if (anyControls?.target) {
      camera.position.copy(pos);
      anyControls.target.copy(center);
      anyControls.update?.();
    } else {
      camera.position.copy(pos);
    }
  }, [camera, controls, molecule, resetTick, setZoomBounds, transition]);
};

type SceneContentProps = {
  molecule: Molecule | null;
  style: StyleSettings;
  onGroupReady?: (group: THREE.Group | null) => void;
  resetCameraTick: number;
  onZoomBounds?: (minD: number, maxD: number) => void;
  fitSmooth?: boolean;
};

const SceneContent = ({ molecule, style, onGroupReady, resetCameraTick, onZoomBounds, fitSmooth = false }: SceneContentProps) => {
  useFitCamera(molecule, resetCameraTick, onZoomBounds, fitSmooth);

  const mesh = useMemo(() => {
    if (!molecule) return null;
    return buildMoleculeMesh(molecule, style);
  }, [molecule, style]);

  useEffect(() => {
    if (!mesh) {
      onGroupReady?.(null);
      return;
    }
    onGroupReady?.(mesh.group);
    return () => {
      onGroupReady?.(null);
      mesh.dispose();
    };
  }, [mesh, onGroupReady]);

  if (!mesh) return null;
  return <primitive object={mesh.group} />;
};

export const Viewer = ({
  molecule,
  style = fallbackStyle,
  onGroupReady,
  className,
  showRotateControl = false,
  onOrientationChange,
}: ViewerProps) => {
  const bgColor = molecule ? "#ffffff" : "#f3f6fb";
  const groupRef = useRef<THREE.Group | null>(null);
  const controlsRef = useRef<any>(null);
  const [rotateMode, setRotateMode] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const startRot = useRef<{ x: number; y: number; z: number } | null>(null);
  const orientationQ = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  const [minDistance, setMinDistance] = useState(0.25);
  const [maxDistance, setMaxDistance] = useState(20000);
  const [fitSmooth, setFitSmooth] = useState(false);
  const [spinCount, setSpinCount] = useState(0);

  const handleZoomBounds = useCallback((minD: number, maxD: number) => {
    setMinDistance(minD);
    setMaxDistance(maxD);
  }, []);

  const handleGroupReady = useCallback((g: THREE.Group | null) => {
    groupRef.current = g;
    if (g) {
      g.quaternion.copy(orientationQ.current);
      g.updateMatrixWorld(true);
    }
    onGroupReady?.(g);
  }, [onGroupReady]);

  const toggleRotateMode = useCallback(() => {
    setRotateMode((prev) => {
      const next = !prev;
      setSpinCount((c) => c + 1);
      if (next) {
        setFitSmooth(true);
        setResetTick((t) => t + 1);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (fitSmooth) {
      const id = setTimeout(() => setFitSmooth(false), 60);
      return () => clearTimeout(id);
    }
  }, [fitSmooth, resetTick]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!rotateMode || !groupRef.current) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    const r = groupRef.current.rotation;
    startRot.current = { x: r.x, y: r.y, z: r.z };
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }, [rotateMode]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!rotateMode) return;
    if (e.pointerType === 'touch') {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size >= 2) {
        const pts = Array.from(activePointers.current.values());
        const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (lastPinchDist.current != null && controlsRef.current) {
          const delta = (lastPinchDist.current - d) * 0.015;
          try { controlsRef.current.dolly?.(delta, true); } catch {}
        }
        lastPinchDist.current = d;
        return;
      }
    }

    if (!dragging || !groupRef.current || !startPos.current || !startRot.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    const ROT_SENS = 0.018;
    const yaw = startRot.current.y + dx * ROT_SENS;
    const pitch = THREE.MathUtils.clamp(startRot.current.x + dy * ROT_SENS, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    groupRef.current.rotation.set(pitch, yaw, startRot.current.z);
    groupRef.current.updateMatrixWorld(true);
    orientationQ.current.copy(groupRef.current.quaternion);
    onOrientationChange?.(orientationQ.current.clone());
  }, [dragging, rotateMode, onOrientationChange]);

  const endDrag = useCallback((e?: ReactPointerEvent<HTMLDivElement>) => {
    if (e) {
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    }
    setDragging(false);
    startPos.current = null;
    startRot.current = null;
    activePointers.current.delete(e?.pointerId ?? -1);
    if (activePointers.current.size < 2) lastPinchDist.current = null;
    if (groupRef.current) {
      orientationQ.current.copy(groupRef.current.quaternion);
      onOrientationChange?.(orientationQ.current.clone());
    } else {
      onOrientationChange?.(orientationQ.current.clone());
    }
  }, [onOrientationChange]);

  const onPointerUpOrCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) lastPinchDist.current = null;
    endDrag(e);
  }, [endDrag]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!rotateMode || !controlsRef.current) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.003;
    try { controlsRef.current.dolly?.(delta, true); } catch {}
  }, [rotateMode]);

  return (
  <div className={`relative w-full overflow-hidden rounded-xl border border-slate-300 bg-white ${className ?? "h-[520px]"}`}>
      {molecule ? null : (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center">
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
              <p className="text-base font-semibold text-slate-900">Drop or click to load a molecule</p>
              <p className="mt-1 text-sm text-slate-600">SDF/MOL or XYZ — Upload 3D files here.</p>
          </div>
        </div>
      )}
  {/* Rotation overlay when in rotate mode */}
      {rotateMode && molecule ? (
        <div
          className={`absolute inset-0 z-10 select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUpOrCancel}
          onPointerCancel={onPointerUpOrCancel}
          onPointerLeave={onPointerUpOrCancel}
          onWheel={onWheel}
          aria-label="Rotate model by dragging"
        >
        </div>
      ) : null}
  {/* Rotate button (bottom-left) */}
      {showRotateControl && molecule ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10">
          <motion.button
            type="button"
            onClick={toggleRotateMode}
            className={`pointer-events-auto inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border shadow-sm overflow-hidden ${rotateMode ? "border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-400 ring-offset-2 ring-offset-white" : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700"}`}
            aria-pressed={rotateMode}
            aria-label={rotateMode ? "Exit rotate mode" : "Enter rotate mode"}
            title={rotateMode ? "Exit rotate mode" : "Enter rotate mode"}
            transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.36 }}
          >
            <motion.div
              className="shrink-0"
              initial={false}
              animate={{ rotate: spinCount * 180 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
              style={{ originX: 0.5, originY: 0.5 }}
              aria-hidden
            >
              <ArrowPathIcon className="h-5 w-5" />
            </motion.div>
          </motion.button>
        </div>
      ) : null}
      <Canvas
        shadows={false}
        camera={{ position: [5, 5, 5], fov: 45 }}
        className="h-full w-full"
      >
        <color attach="background" args={[bgColor]} />
        <ambientLight intensity={0.75} />
        <hemisphereLight args={[0xf5f7fb, 0x9aa5b1, 0.6]} />
        <directionalLight position={[4, 6, 3]} intensity={0.8} castShadow />
        <Suspense fallback={null}>
          <SceneContent
            molecule={molecule}
            style={style}
            onGroupReady={handleGroupReady}
            resetCameraTick={resetTick}
            onZoomBounds={handleZoomBounds}
            fitSmooth={fitSmooth}
          />
        </Suspense>
        <CameraControls
          ref={controlsRef}
          makeDefault
          enabled
          smoothTime={0.18}
          draggingSmoothTime={0.12}
          dollyToCursor
          dollySpeed={1.0}
          azimuthRotateSpeed={0.9}
          polarRotateSpeed={0.9}
          truckSpeed={1.0}
          minDistance={minDistance}
          maxDistance={maxDistance}
        />
      </Canvas>
    </div>
  );
};

Viewer.displayName = "Viewer";
