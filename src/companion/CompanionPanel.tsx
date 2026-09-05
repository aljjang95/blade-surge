import { Component, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CompanionTactic } from './companion-agent';
import type { CompanionDirector } from './director';

const TACTICS: Array<{ id: CompanionTactic; label: string; detail: string }> = [
  { id: 'gather', label: '몰이', detail: '적을 한곳에 견인' },
  { id: 'guard', label: '수호', detail: '위기 시 회복막' },
  { id: 'break', label: '파쇄', detail: '정예·보스 우선 경직' },
];

const QUICK_LINES = ['지금 어디로?', '장비 조언해줘', '상태 보고'];

interface CompanionPanelProps {
  director: CompanionDirector;
}

interface PortraitBoundaryState {
  failed: boolean;
}

class PortraitBoundary extends Component<{ children: ReactNode }, PortraitBoundaryState> {
  state: PortraitBoundaryState = { failed: false };

  static getDerivedStateFromError(): PortraitBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('companion portrait fallback', error.message, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? <PortraitFallback /> : this.props.children;
  }
}

function PortraitModel() {
  const gltf = useLoader(GLTFLoader, '/models/Skeleton_Mage.glb', (loader) => loader.setMeshoptDecoder(MeshoptDecoder)) as GLTF;
  const { model, mixer } = useMemo(() => {
    const next = cloneSkeleton(gltf.scene);
    next.traverse((node) => {
      if (!('isMesh' in node) || !node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
    });
    const nextMixer = new AnimationMixer(next);
    const idle = gltf.animations.find((clip) => clip.name === 'Idle_Combat') ?? gltf.animations.find((clip) => clip.name === 'Idle');
    if (idle) {
      nextMixer.clipAction(idle).play();
      nextMixer.setTime(idle.duration * 0.27);
    }
    return { model: next, mixer: nextMixer };
  }, [gltf.animations, gltf.scene]);

  useEffect(() => () => { mixer.stopAllAction(); }, [mixer]);

  return <primitive object={model} scale={1.1} position={[0, -1.65, 0]} rotation={[0, 0.08, 0]} />;
}

function PortraitFallback() {
  return (
    <div className="companion-portrait-fallback">
      <strong aria-hidden="true">N</strong>
      <span>저전력 모드</span>
    </div>
  );
}

function Portrait3D({ quality }: { quality: 'high' | 'mid' | 'low' }) {
  const webgl2 = useMemo(() => {
    if (quality === 'low') return false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  }, [quality]);

  if (!webgl2 || quality === 'low') return <PortraitFallback />;

  return (
    <PortraitBoundary>
      <div className="companion-portrait-canvas" aria-label="네브 3D 초상">
        <Canvas
          camera={{ position: [0, 1.05, 4.2], fov: 34, near: 0.1, far: 20 }}
          dpr={quality === 'high' ? [1, 1.25] : 1}
          frameloop="demand"
          gl={{ antialias: false, powerPreference: 'low-power', alpha: true }}
          shadows={false}
        >
          <ambientLight intensity={1.05} />
          <directionalLight position={[3, 4, 4]} intensity={2.2} color="#bfeef0" />
          <directionalLight position={[-3, 1, -2]} intensity={1.6} color="#c48a45" />
          <pointLight position={[0, -0.4, 2]} intensity={5} distance={7} color="#2fc7ce" />
          <Suspense fallback={null}>
            <PortraitModel />
          </Suspense>
        </Canvas>
      </div>
    </PortraitBoundary>
  );
}

export function CompanionPanel({ director }: CompanionPanelProps) {
  const snapshot = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  const [input, setInput] = useState('');
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snapshot.messages, snapshot.dialoguePending]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && snapshot.open) director.setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [director, snapshot.open]);

  useEffect(() => {
    if (snapshot.open) {
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      if (coarsePointer) closeRef.current?.focus({ preventScroll: true });
      else inputRef.current?.focus({ preventScroll: true });
    }
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = snapshot.open;
  }, [snapshot.open]);

  const send = (value: string) => {
    if (!value.trim()) return;
    if (snapshot.dialoguePending) return;
    void director.ask(value);
    if (director.getSnapshot().dialoguePending) setInput('');
  };

  return (
    <div className={`companion-ui ${snapshot.connected ? 'is-connected' : ''}`}>
      <button
        ref={launcherRef}
        className="companion-launcher"
        type="button"
        aria-expanded={snapshot.open}
        aria-controls="companion-panel"
        aria-label={`네브와 대화하기. 현재 ${snapshot.status}`}
        onClick={() => director.toggleOpen()}
      >
        <span className="companion-launcher-mark" aria-hidden="true">N</span>
        <span className="companion-launcher-copy"><b>네브</b><small>{snapshot.status}</small></span>
        <span className="companion-link-dot" aria-hidden="true" />
      </button>

      {snapshot.open && (
        <section id="companion-panel" className="companion-panel" role="dialog" aria-label="네브 동행 전술 대화">
          <header className="companion-head">
            <div>
              <span className="companion-kicker">PACT // FIELD LINK</span>
              <h2>봉인 해독자 네브</h2>
            </div>
            <button ref={closeRef} type="button" className="companion-close" onClick={() => director.setOpen(false)} aria-label="대화 닫기">×</button>
          </header>

          <div className="companion-hero">
            <Portrait3D quality={snapshot.quality} />
            <div className="companion-readout">
              <span className={snapshot.connected ? 'online' : ''}>{snapshot.connected ? '던전 동기화' : '로비 대기'}</span>
              <strong>{snapshot.status}</strong>
              <dl>
                <div><dt>유대</dt><dd>{snapshot.bond}</dd></div>
                <div><dt>체력</dt><dd>{Math.round(snapshot.context.hpRatio * 100)}%</dd></div>
                <div><dt>위협</dt><dd>{snapshot.context.enemiesNear}</dd></div>
              </dl>
            </div>
          </div>

          <div className="companion-tactics" aria-label="동행 전술">
            {TACTICS.map((tactic) => (
              <button
                key={tactic.id}
                type="button"
                className={snapshot.tactic === tactic.id ? 'active' : ''}
                aria-pressed={snapshot.tactic === tactic.id}
                onClick={() => director.setTactic(tactic.id)}
              >
                <b>{tactic.label}</b>
                <span>{tactic.detail}</span>
              </button>
            ))}
          </div>

          <div ref={logRef} className="companion-log" aria-live="polite" aria-label="대화 기록" aria-busy={snapshot.dialoguePending}>
            {snapshot.messages.slice(-7).map((message) => (
              <p key={message.id} className={message.role}>
                <span>{message.role === 'companion' ? '네브' : '나'}</span>
                {message.text}
              </p>
            ))}
            {snapshot.dialoguePending && <p className="companion"><span>네브</span>계약자의 말을 듣고 있습니다…</p>}
            {snapshot.dialogueError && <p role="status" className="companion">{snapshot.dialogueError}</p>}
            {snapshot.proposedTactic && <button className="companion-proposal" type="button" onClick={() => director.applyProposal()}>
              {TACTICS.find((tactic) => tactic.id === snapshot.proposedTactic)?.label} 진형으로 함께하기
            </button>}
          </div>

          <div className="companion-quick" aria-label="빠른 질문">
            {QUICK_LINES.map((line) => <button type="button" key={line} disabled={snapshot.dialoguePending} onClick={() => director.reply(line)}>{line}</button>)}
          </div>

          <form className="companion-form" onSubmit={(event) => { event.preventDefault(); send(input); }}>
            <label htmlFor="companion-input">네브에게 말하기</label>
            <div>
              <input
                ref={inputRef}
                id="companion-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={240}
                autoComplete="off"
                placeholder="예: 적을 한곳에 몰아줘"
              />
              {snapshot.dialoguePending
                ? <button type="button" onClick={() => director.cancelDialogue()}>취소</button>
                : <button type="submit" disabled={!input.trim()}>전송</button>}
            </div>
            <small className="companion-privacy">대화는 응답을 위해 Cloudflare로 전송됩니다.</small>
          </form>
        </section>
      )}
    </div>
  );
}
