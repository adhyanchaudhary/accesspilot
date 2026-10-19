import Image from "./Image";
import styles from "./landing.module.css";
import { ButtonLink } from "./ButtonLink";
import { UsersIcon } from "./Icons";
import { Reveal } from "./Reveal";

const steps = [
  {
    title: "Submit your website",
    description:
      "Paste your URL and, optionally, the GitHub repository you want AccessPilot to work with.",
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
    title: "Apply the patch",
    description:
      "Review AI-suggested code changes and approve only the ones that fit your codebase.",
    image: "/assets/step-4-apply.svg",
    tone: "green",
  },
  {
    title: "Verify the results",
    description:
      "AccessPilot re-runs the checks and confirms each approved fix is working.",
    image: "/assets/step-5-verify.svg",
    tone: "teal",
  },
];

export function HowItWorks() {
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
                <span className={styles.kickerIndex} aria-hidden="true">
                  02
                </span>
                How it works
              </span>
              <h2 id="how-title" className={styles.h2}>
                From URL to verified fix, in five clear steps.
              </h2>
              <p>
                A guided flow that keeps developers in control and gives the whole team a shared
                record of every change.
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
              <ButtonLink href="#features" withArrow className={styles.howCta}>
                Try the workflow
              </ButtonLink>
            </Reveal>
          </div>

          <Reveal delay={80}>
            <ol className={styles.timeline}>
              {steps.map((step, index) => (
                <li key={step.title} className={styles.timelineItem} data-tone={step.tone}>
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
          </Reveal>
        </div>
      </div>
    </section>
  );
}
