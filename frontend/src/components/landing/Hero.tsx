import Image from "./Image";
import styles from "./landing.module.css";
import { ButtonLink } from "./ButtonLink";
import { CheckIcon, ShieldIcon, SparkleIcon } from "./Icons";
import { Reveal } from "./Reveal";
import { useStartScan } from "./useStartScan";

const highlights = [
  "No setup required",
  "WCAG 2.2 aligned checks",
  "Human-approved fixes",
];

export function Hero() {
  const start = useStartScan();

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.shell}>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <Reveal>
              <span className={styles.eyebrow}>
                <span className={styles.eyebrowDot} aria-hidden="true" />
                AI-powered accessibility auditor
              </span>
            </Reveal>

            <Reveal delay={70}>
              <h1 id="hero-title" className={styles.heroTitle}>
                Make the web <span className={styles.accent}>accessible</span>, one fix at a time.
              </h1>
            </Reveal>

            <Reveal delay={140}>
              <p className={styles.lead}>
                AccessPilot finds accessibility issues, explains them in plain language, suggests
                code fixes, applies the ones you approve, and verifies the result — all in one clear
                workflow.
              </p>
            </Reveal>

            <Reveal delay={210}>
              <div className={styles.heroActions}>
                <ButtonLink href={start.href} onClick={start.onClick} withArrow>
                  {start.label}
                </ButtonLink>
                <ButtonLink href="#how-it-works" variant="ghost">
                  See how it works
                </ButtonLink>
              </div>
            </Reveal>

            <Reveal delay={280}>
              <ul className={styles.heroPoints} aria-label="Product highlights">
                {highlights.map((point) => (
                  <li key={point}>
                    <span className={styles.pointIcon} aria-hidden="true">
                      <CheckIcon />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal className={styles.heroVisualWrap} delay={160}>
            <div className={styles.heroVisual}>
              <span className={styles.heroGlow} aria-hidden="true" />
              <span className={styles.heroOrbit} aria-hidden="true" />
              <div className={styles.heroFrame}>
                <div className={styles.heroShot}>
                  <Image
                    src="/assets/hero-audit.svg"
                    alt="AccessPilot dashboard preview showing a 92 accessibility score, prioritized issues, an AI-suggested code fix, and resolved issues over time."
                    width={760}
                    height={620}
                    priority
                    unoptimized
                    className={styles.heroImage}
                  />
                </div>
              </div>

              <div className={styles.floatChipTop} aria-hidden="true">
                <span className={styles.liveDot} />
                <span>Live audit preview</span>
              </div>

              <div className={styles.floatChipBottom} aria-hidden="true">
                <span className={styles.chipCheck}>
                  <CheckIcon />
                </span>
                <span>
                  <strong>Fix verified</strong>
                  <small>Re-checked automatically</small>
                </span>
              </div>

              <div className={styles.floatChipSide} aria-hidden="true">
                <span className={styles.chipBadge}>
                  <SparkleIcon />
                </span>
                <span>
                  <strong>AI-assisted</strong>
                  <small>Fixes, not just findings</small>
                </span>
              </div>

              <div className={styles.heroMicro} aria-hidden="true">
                <ShieldIcon />
                <span>WCAG 2.2</span>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={220}>
          <section className={styles.proofStrip} aria-label="AccessPilot at a glance">
            <div className={styles.proof} data-tone="blue">
              <span className={styles.proofIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16M7 12h10M9 17h6" />
                </svg>
              </span>
              <div>
                <strong>5-step workflow</strong>
                <span>From URL to verified fix</span>
              </div>
            </div>
            <div className={styles.proof} data-tone="violet">
              <span className={styles.proofIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3 5 6.5V11c0 4.4 2.9 7 7 8 4.1-1 7-3.6 7-8V6.5z" />
                  <path d="m9 11.5 2 2 4-4.5" />
                </svg>
              </span>
              <div>
                <strong>WCAG 2.2</strong>
                <span>Aligned audit checks</span>
              </div>
            </div>
            <div className={styles.proof} data-tone="green">
              <span className={styles.proofIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
                </svg>
              </span>
              <div>
                <strong>AI-assisted</strong>
                <span>Fixes, not just findings</span>
              </div>
            </div>
            <div className={styles.proof} data-tone="amber">
              <span className={styles.proofIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="3.4" />
                  <path d="M5 20c.7-4 3.4-6 7-6s6.3 2 7 6" />
                </svg>
              </span>
              <div>
                <strong>Human-approved</strong>
                <span>You stay in control</span>
              </div>
            </div>
          </section>
        </Reveal>
      </div>
    </section>
  );
}
