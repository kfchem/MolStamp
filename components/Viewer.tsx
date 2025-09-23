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
  /** ホームページのみ表示。QRページでは未表示 */
  showRotateControl?: boolean;
  /** 向きが変わったときに通知（共有URLの再生成などに利用）。現在の Quaternion を渡す */
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
    // ズーム境界（CameraControls の orbit 距離）。min は固定、max は分子サイズ連動。
  const minR = 0.2; // 固定拡大閾値（より寄れるように）
    const maxR = Math.max(50, radius * 1.8);
    const desiredR = Math.max(radius * 3, 4.5);
    // 初期距離（半径距離）を境界内にクランプ
    const r = Math.min(Math.max(desiredR, minR), maxR);
    // 対角方向へ配置する場合、各成分は r / √3 にする
    const d = r / Math.sqrt(3);
    const pos = new THREE.Vector3(center.x + d, center.y + d, center.z + d);
    // near を固定小値にして大小分子でも寄り限界の体感差を減らす
  camera.near = 0.01;
    camera.far = Math.max(5000, radius * 12);
    camera.updateProjectionMatrix();

    // ズーム境界を更新（縮小/拡大しすぎ防止）
    setZoomBounds?.(minR, maxR);

    // CameraControls を優先。なければ OrbitControls 風のtargetに対応
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
  /** カメラリセットのトリガー（値が変わるたびにfit/lookAtを再適用） */
  resetCameraTick: number;
  /** 分子サイズに応じたズーム境界の更新を親へ通知 */
  onZoomBounds?: (minD: number, maxD: number) => void;
  /** 今回のフィットをスムーズに行うか */
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
  // ユーザーが決めた向きを保持（メッシュ再生成時に適用）
  const orientationQ = useRef<THREE.Quaternion>(new THREE.Quaternion());
  // ピンチズーム用：アクティブポインタと直近距離
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  // CameraControls のズーム境界（分子サイズに応じて再計算）
  const [minDistance, setMinDistance] = useState(0.35);
  const [maxDistance, setMaxDistance] = useState(5000);
  const [fitSmooth, setFitSmooth] = useState(false);
  // 回転モードに入る瞬間だけアイコンを回すためのキー
  const [spinCount, setSpinCount] = useState(0);

  const handleZoomBounds = useCallback((minD: number, maxD: number) => {
    setMinDistance(minD);
    setMaxDistance(maxD);
  }, []);

  // onGroupReady をラップして内部参照も保持
  const handleGroupReady = useCallback((g: THREE.Group | null) => {
    groupRef.current = g;
    // 既存の向きを新しいグループに適用（スタイル変更などで再生成された場合）
    if (g) {
      g.quaternion.copy(orientationQ.current);
      g.updateMatrixWorld(true);
    }
    onGroupReady?.(g);
  }, [onGroupReady]);

  // 回転モード開始時にカメラをデフォルト位置へ
  const toggleRotateMode = useCallback(() => {
    setRotateMode((prev) => {
      const next = !prev;
      // トグル時は常にアイコンを回す（180度）
      setSpinCount((c) => c + 1);
      if (next) {
        setFitSmooth(true);
        setResetTick((t) => t + 1);
      }
      return next;
    });
  }, []);

  // スムーズフィットは1回だけ有効にしてすぐ解除
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
    // ピンチ用にポインタ登録
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }, [rotateMode]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!rotateMode) return;
    // ピンチジェスチャーを先に処理（2本指）
    if (e.pointerType === 'touch') {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size >= 2) {
        const pts = Array.from(activePointers.current.values());
        const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (lastPinchDist.current != null && controlsRef.current) {
          const delta = (lastPinchDist.current - d) * 0.015; // 感度を少し上げる
          try { controlsRef.current.dolly?.(delta, true); } catch {}
        }
        lastPinchDist.current = d;
        return; // ピンチ時はモデル回転は行わない
      }
    }

    if (!dragging || !groupRef.current || !startPos.current || !startRot.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    const ROT_SENS = 0.018; // 少し感度アップ
    const yaw = startRot.current.y + dx * ROT_SENS; // 左右ドラッグでY回転
    const pitch = THREE.MathUtils.clamp(startRot.current.x + dy * ROT_SENS, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    groupRef.current.rotation.set(pitch, yaw, startRot.current.z);
    groupRef.current.updateMatrixWorld(true);
    // 現在の姿勢を保持
    orientationQ.current.copy(groupRef.current.quaternion);
    onOrientationChange?.(orientationQ.current.clone());
  }, [dragging, rotateMode]);

  const endDrag = useCallback((e?: ReactPointerEvent<HTMLDivElement>) => {
    if (e) {
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    }
    setDragging(false);
    startPos.current = null;
    startRot.current = null;
    // ピンチ状態をクリア
    activePointers.current.delete(e?.pointerId ?? -1);
    if (activePointers.current.size < 2) lastPinchDist.current = null;
    if (groupRef.current) {
      orientationQ.current.copy(groupRef.current.quaternion);
      onOrientationChange?.(orientationQ.current.clone());
    } else {
      onOrientationChange?.(orientationQ.current.clone());
    }
  }, []);

  const onPointerUpOrCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) lastPinchDist.current = null;
    endDrag(e);
  }, [endDrag]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!rotateMode || !controlsRef.current) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.003; // 感度を少し上げる
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
      {/* モデル回転オーバーレイ（モード時のみ） */}
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
      {/* 左下の回転ボタン（トップページのみ） */}
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
          // 滑らかなズーム・回転・パン
          smoothTime={0.18}
          draggingSmoothTime={0.12}
          // カーソル位置に向けてドリー
          dollyToCursor
          // ズーム感度（大きいほど速い）
          dollySpeed={0.8}
          // 速度抑制（慣性が強すぎる場合は上げる）
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
