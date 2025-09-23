"use client";

import { Suspense, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import { Molecule, StyleSettings } from "@/lib/chem/types";
import { PLUS_NAME, PLUS_URL } from "@/lib/branding";
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
};

const useFitCamera = (molecule: Molecule | null) => {
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

    const distance = Math.max(radius * 3, 4.5);
    const pos = new THREE.Vector3(
      center.x + distance,
      center.y + distance,
      center.z + distance,
    );
    camera.near = Math.max(0.1, radius * 0.05);
    camera.far = Math.max(5000, radius * 12);
    camera.updateProjectionMatrix();

    // CameraControls を優先。なければ OrbitControls 風のtargetに対応
    const anyControls = controls as any;
    if (anyControls?.setLookAt) {
      anyControls.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, false);
    } else if (anyControls?.target) {
      camera.position.copy(pos);
      anyControls.target.copy(center);
      anyControls.update?.();
    } else {
      camera.position.copy(pos);
    }
  }, [camera, controls, molecule]);
};

type SceneContentProps = {
  molecule: Molecule | null;
  style: StyleSettings;
  onGroupReady?: (group: THREE.Group | null) => void;
};

const SceneContent = ({ molecule, style, onGroupReady }: SceneContentProps) => {
  useFitCamera(molecule);

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
}: ViewerProps) => {
  const bgColor = molecule ? "#ffffff" : "#f3f6fb";
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
            onGroupReady={onGroupReady}
          />
        </Suspense>
        <CameraControls
          makeDefault
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
          minDistance={0.25}
          maxDistance={5000}
        />
      </Canvas>
    </div>
  );
};

Viewer.displayName = "Viewer";
