import Image from "./Image";
import styles from "./landing.module.css";
import { ButtonLink } from "./ButtonLink";
import { CheckIcon } from "./Icons";
import { Reveal } from "./Reveal";
import { useStartScan } from "./useStartScan";

const checklist = [
  {
    title: "Plain-language explanations",
    text: "understand the impact, not just the rule.",
  },
  {
    title: "Severity-based priorities",
    text: "fix what matters most, first.",
  },
  {
    title: "Code-level suggestions",
    text: "review and apply with confidence.",
  },
  {
    title: "Continuous verification",
    text: "every change is re-checked automatically.",
  },
];

export function Showcase() {
  const start = useStartScan();

  return (
    <section className={styles.section} id="why-accesspilot" aria-labelledby="showcase-title">
      <div className={styles.shell}>
        <div className={styles.showcaseGrid}>
          <Reveal className={styles.showcaseMediaWrap}>
            <div className={styles.showcaseMedia}>
              <span className={styles.showcaseGlow} aria-hidden="true" />
              <div className={styles.reportFrame}>
                <div className={styles.reportToolbar} aria-hidden="true">
                  <span className={styles.windowDots}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.reportAddress}>accesspilot / audit-report</span>
                  <span className={styles.reportStatus}>
                    <span />
                    Ready
                  </span>
                </div>
                <div className={styles.reportShot}>
                  <Image
                    src="/assets/audit-report.svg"
                    alt="AccessPilot report showing a score of 92, category results, a resolved issues trend chart, and recent fixes."
                    width={720}
                    height={520}
                    unoptimized
                    className={styles.reportImage}
                  />
                </div>
              </div>

              <div className={styles.reportChip} aria-hidden="true">
                <span className={styles.reportChipScore}>92</span>
                <span>
                  <strong>Accessibility score</strong>
                  <small>Improving steadily</small>
                </span>
              </div>
            </div>
          </Reveal>

          <div className={styles.showcaseCopy}>
            <Reveal delay={60}>
              <span className={styles.kicker}>
                <span className={styles.kickerIndex} aria-hidden="true">
                  03
                </span>
                Clarity you can act on
              </span>
              <h2 id="showcase-title" className={styles.h2}>
                Every issue explained. Every fix verifiable.
              </h2>
              <p>
                No black-box scores or endless spreadsheets. AccessPilot turns accessibility
                findings into a clear, prioritized plan your whole team can follow.
              </p>
            </Reveal>

            <Reveal delay={130}>
              <ul className={styles.checklist}>
                {checklist.map((item) => (
                  <li key={item.title}>
                    <span className={styles.checkIcon} aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <span>
                      <strong>{item.title}</strong> — {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={200}>
              <ButtonLink href={start.href} onClick={start.onClick} variant="ghost" withArrow>
                {start.label}
              </ButtonLink>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
