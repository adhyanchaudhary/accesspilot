import type { CSSProperties } from "react";
import { useStartScan } from "./useStartScan";
import { useWorkflowReveal } from "./useWorkflowReveal";
import Image from "./Image";
import styles from "./landing.module.css";
import { ButtonLink } from "./ButtonLink";
import { UsersIcon } from "./Icons";
import { Reveal } from "./Reveal";

const steps = [
  {
    title: "Submit your website",
    description:
      "Connect GitHub, choose your authorized repository, and enter the URL of its deployed website.",
    image: "/assets/step-1-submit.svg",
    tone: "blue",
  },
  {
    title: "Scan for issues",
    description:
      "AccessPilot checks pages against accessibility best practices and highlights what needs attention.",
    image: "/assets/step-2-scan.svg",
    tone: "violet",
  },
  {
    title: "Find & prioritize",
    description:
      "Issues are grouped by severity and impact, so you know exactly what to fix first.",
    image: "/assets/step-3-prioritize.svg",
    tone: "amber",
  },
  {
    title: "Prepare the patch",
    description:
      "AI proposes source changes. AccessPilot validates them and opens a draft pull request for your review.",
    image: "/assets/step-4-apply.svg",
    tone: "green",
  },
  {
    title: "Review & verify",
    description:
      "Review the diff, test the proposed changes, and rerun accessibility checks before you merge.",
    image: "/assets/step-5-verify.svg",
    tone: "teal",
  },
];

export function HowItWorks() {
  const start = useStartScan();
  const { listRef, enabled, revealed, active } = useWorkflowReveal();
  return (
    <section
      className={`${styles.section} ${styles.howSection}`}
      id="how-it-works"
      aria-labelledby="how-title"
    >
      <span className={styles.howWatermark} aria-hidden="true">
        05
      </span>
      <div className={styles.shell}>
        <div className={styles.howGrid}>
          <div className={styles.howIntro}>
            <Reveal>
              <span className={styles.kicker}>
                How it works
              </span>
              <h2 id="how-title" className={styles.h2}>
                One scan.
                <br />A clearer way forward.
              </h2>
              <p>
                From your first URL to a reviewable pull request. Five deliberate steps,
                with you in control of what ships.
              </p>
            </Reveal>

            <Reveal delay={90}>
              <div className={styles.howNote}>
                <span className={styles.howNoteIcon} aria-hidden="true">
                  <UsersIcon />
                </span>
                <div>
                  <strong>Built for real teams</strong>
                  <span>
                    Designers, developers, QA, and content editors can all work from the same
                    report.
                  </span>
                </div>
              </div>
            </Reveal>

            <Reveal delay={160}>
              <ButtonLink onClick={start.onClick} withArrow className={styles.howCta}>
                Start a scan
              </ButtonLink>
            </Reveal>
          </div>

            <ol ref={listRef} className={styles.timeline} aria-label="Accessibility audit workflow"
              data-motion={enabled ? "enabled" : "off"}
              style={{ "--workflow-progress": active / (steps.length - 1) } as CSSProperties}>
              {steps.map((step, index) => (
                <li key={step.title} className={styles.timelineItem} data-tone={step.tone}
                  data-workflow-step={index} data-revealed={revealed.has(index)}
                  data-active={active === index} aria-current={active === index ? "step" : undefined}>
                  <div className={styles.timelineMarker} aria-hidden="true">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <div className={styles.timelineCard}>
                    <div className={styles.timelineCopy}>
                      <span className={styles.stepMeta} aria-hidden="true">
                        Step {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                    <div className={styles.timelineMedia} aria-hidden="true">
                      <Image
                        src={step.image}
                        alt=""
                        width={160}
                        height={120}
                        unoptimized
                        className={styles.timelineImage}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
        </div>
      </div>
    </section>
  );
}
