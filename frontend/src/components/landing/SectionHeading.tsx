import styles from "./landing.module.css";
import { Reveal } from "./Reveal";

type SectionHeadingProps = {
  kicker: string;
  title: string;
  description: string;
  id: string;
  center?: boolean;
};

export function SectionHeading({
  kicker,
  title,
  description,
  id,
  center = false,
}: SectionHeadingProps) {
  return (
    <Reveal className={`${styles.sectionHead} ${center ? styles.sectionHeadCenter : ""}`.trim()}>
      <span className={styles.kicker}>
        {kicker}
      </span>
      <h2 id={id} className={styles.h2}>
        {title}
      </h2>
      <p>{description}</p>
    </Reveal>
  );
}
