import styles from "./landing.module.css";
import { Reveal } from "./Reveal";

type SectionHeadingProps = {
  index: string;
  kicker: string;
  title: string;
  description: string;
  id: string;
  center?: boolean;
};

export function SectionHeading({
  index,
  kicker,
  title,
  description,
  id,
  center = false,
}: SectionHeadingProps) {
  return (
    <Reveal className={`${styles.sectionHead} ${center ? styles.sectionHeadCenter : ""}`.trim()}>
      <span className={styles.kicker}>
        <span className={styles.kickerIndex} aria-hidden="true">
          {index}
        </span>
        {kicker}
      </span>
      <h2 id={id} className={styles.h2}>
        {title}
      </h2>
      <p>{description}</p>
    </Reveal>
  );
}
