import Image from "./Image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./landing.module.css";
import { SectionHeading } from "./SectionHeading";

type Feature = { tag: string; title: string; description: string; image: string; alt: string; color: string; ink: string; bullets: string[] };
const features: Feature[] = [
  { tag: "Inclusive", title: "Inclusive by Design.", description: "Build experiences that work for every ability, device, and input method — not just the default user.", image: "/assets/feature-inclusive.svg", alt: "An accessible website preview surrounded by alt text, contrast, keyboard, and caption checks.", color: "#f4b84d", ink: "#282333", bullets: ["Keyboard & focus paths", "Contrast and readable UI", "Inclusive interaction checks"] },
  { tag: "AI-assisted", title: "Smarter Fix Suggestions.", description: "AccessPilot pinpoints the issue and proposes code-level fixes you can review before applying.", image: "/assets/feature-ai.svg", alt: "A code editor with an accessibility issue highlighted and an AI panel suggesting a fix.", color: "#f2f1ee", ink: "#282333", bullets: ["Context-aware code hints", "Review before applying", "Developer-first explanations"] },
  { tag: "Verification", title: "Verified Changes.", description: "Every approved patch is re-checked automatically, so you know the fix actually solved the problem.", image: "/assets/feature-verified.svg", alt: "A verified shield and checklist confirming contrast, keyboard, and ARIA checks.", color: "#7c4ee4", ink: "#ffffff", bullets: ["Re-run checks after fixes", "Confirm outcomes", "Keep changes accountable"] },
  { tag: "Workflow", title: "Faster, Easier Compliance.", description: "Replace scattered audits and manual tickets with one continuous, repeatable accessibility workflow.", image: "/assets/feature-speed.svg", alt: "A stopwatch and a single scan, fix, verify workflow showing a faster compliance process.", color: "#c9a9f6", ink: "#282333", bullets: ["One repeatable workflow", "Prioritized issue lists", "Less manual busywork"] },
];
const CARD_COUNT = 22;
const TAU = Math.PI * 2;

type CardNode = HTMLElement & { dataset: DOMStringMap };

export function Features() {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<CardNode[]>([]);
  const rotationRef = useRef(0);
  const velocityRef = useRef(0.0045);
  const draggingRef = useRef(false);
  const pointerRef = useRef({ x: 0, lastX: 0 });
  const frameRef = useRef<number | null>(null);
  const lastActiveRef = useRef(-1);
  const [active, setActive] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [paused, setPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [hovered, setHovered] = useState(false);

  const renderFrame = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const radius = 0.62 * Math.min(width, height);
    const rotation = rotationRef.current;
    const positioned: { card: CardNode; z: number }[] = [];
    let frontIndex = 0;
    let frontZ = -Infinity;

    // One angle and one trigonometric pair per card, reused for all layout values.
    cardsRef.current.forEach((card, i) => {
      const angle = rotation + (i / CARD_COUNT) * TAU;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const x = sin * radius;
      const z = cos * radius;
      const y = -cos * radius * 0.42;
      const depth = (z / radius + 1) / 2;
      const scale = 0.55 + depth * 0.55;
      card.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${(sin * 14).toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      card.style.opacity = String(0.30 + depth * 0.70);
      card.style.filter = `brightness(${0.5 + depth * 0.7})`;
      positioned.push({ card, z });
      if (z > frontZ) { frontZ = z; frontIndex = i; }
    });

    // Explicit painter's order is essential for the overlapping ring illusion.
    positioned.sort((a, b) => a.z - b.z);
    positioned.forEach(({ card }, index) => { card.style.zIndex = String(index + 1); });
    const activeFeature = frontIndex % features.length;
    if (activeFeature !== lastActiveRef.current) {
      lastActiveRef.current = activeFeature;
      setActive(activeFeature);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      if (!draggingRef.current && !paused && !hovered) {
        rotationRef.current += velocityRef.current;
        velocityRef.current += (0.0045 - velocityRef.current) * 0.02;
      }
      renderFrame();
      frameRef.current = window.requestAnimationFrame(tick);
    };
    cardsRef.current = Array.from(stageRef.current?.querySelectorAll<CardNode>("[data-ring-card]") ?? []);
    frameRef.current = window.requestAnimationFrame(tick);
    const onResize = () => renderFrame();
    window.addEventListener("resize", onResize);
    return () => {
      mounted = false;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [renderFrame, paused, hovered]);

  const nudge = (direction: number) => {
    rotationRef.current += direction * (TAU / CARD_COUNT) * 2.8;
    velocityRef.current = paused ? 0 : direction * 0.035;
    renderFrame();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    setIsDragging(true);
    velocityRef.current = 0;
    pointerRef.current = { x: event.clientX, lastX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = event.clientX - pointerRef.current.lastX;
    rotationRef.current += dx * 0.0045;
    velocityRef.current = dx * 0.0045;
    pointerRef.current.lastX = event.clientX;
  };
  const onPointerUp = () => {
    draggingRef.current = false;
    setIsDragging(false);
  };

  const frontFeature = features[active];
  return (
    <section className={`${styles.section} ${styles.featureStackSection}`} id="features" aria-labelledby="features-title">
      <div className={styles.shell}>
        <SectionHeading kicker="Why AccessPilot" id="features-title" title="Accessibility, without the busywork." description="One connected workflow for finding issues, understanding their impact, and shipping fixes that hold up." center />
        <div className={styles.rolodexLayout}>
          <div className={`${styles.rolodexStage} ${isDragging ? styles.rolodexDragging : ""}`} ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} tabIndex={0} onKeyDown={event => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault(); nudge(event.key === 'ArrowRight' ? 1 : -1);
            }
          }} role="group" aria-label="Interactive rotating AccessPilot feature cards. Drag horizontally to spin.">
            <div className={styles.rolodexOrbit} aria-hidden="true" />
            {Array.from({ length: CARD_COUNT }, (_, i) => {
              const feature = features[i % features.length];
              return <article key={i} data-ring-card data-feature={i % features.length} className={styles.rolodexCard} style={{ "--card-color": feature.color, "--card-ink": feature.ink } as React.CSSProperties} aria-label={`${feature.title} feature card ${i + 1}`}>
                <div className={styles.rolodexCardHead}><span>ACCESSPILOT</span><span className={styles.rolodexDot} /></div>
                <div className={styles.rolodexVisual}><Image src={feature.image} alt={feature.alt} width={440} height={260} unoptimized draggable={false} /></div>
                <div className={styles.rolodexCopy}><span className={styles.rolodexTag}>{feature.tag}</span><h3>{feature.title}</h3><p>{feature.description}</p><ul>{feature.bullets.map(item => <li key={item}>{item}</li>)}</ul></div>
              </article>;
            })}
          </div>
          <div className={styles.rolodexInfo}>
            <div className={styles.rolodexInfoLabel}><span className={styles.rolodexStatus} /> FEATURE IN FOCUS</div>
            <h3>{frontFeature.title}</h3><p>{frontFeature.description}</p>
            <div className={styles.rolodexBullets}>{frontFeature.bullets.map((item, i) => <span key={item}><b>0{i + 1}</b>{item}</span>)}</div>
            <div className={styles.rolodexControls}>
              <button type="button" className={styles.rolodexButton} onClick={() => nudge(-1)} aria-label="Rotate cards backwards">←</button>
              <button type="button" className={styles.rolodexButton} onClick={() => nudge(1)} aria-label="Spin feature cards">→</button>
              <button type="button" className={styles.rolodexButtonGhost} onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? "Resume rotation" : "Pause rotation"}>{paused ? "▶" : "Ⅱ"}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
