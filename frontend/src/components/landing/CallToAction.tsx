import styles from "./landing.module.css";
import { ButtonLink } from "./ButtonLink";
import { LockIcon } from "./Icons";
import { Reveal } from "./Reveal";
import { useStartScan } from "./useStartScan";

export function CallToAction() {
  const start = useStartScan();

  return (
    <section className={styles.ctaSection} aria-labelledby="cta-title">
      <div className={styles.shell}>
        <Reveal>
          <div className={styles.ctaPanel}>
            <span className={styles.ctaOrb} aria-hidden="true" />
            <span className={styles.ctaRings} aria-hidden="true" />

            <div className={styles.ctaCopy}>
              <span className={`${styles.kicker} ${styles.kickerLight}`}>
                Start here
              </span>
              <h2 id="cta-title">Ready to build a more accessible web?</h2>
              <p>
                Run your first scan, review the issues, and see how AccessPilot turns findings into
                verified fixes.
              </p>
            </div>

            <div className={styles.ctaActions}>
              <ButtonLink href={start.href} onClick={start.onClick} variant="light" withArrow>
                {start.label}
              </ButtonLink>
              <span className={styles.ctaNote}>
                <LockIcon aria-hidden="true" />
                No credit card required · Works with any website
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
