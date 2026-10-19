import Image from "./Image";
import Link from "./Link";
import styles from "./landing.module.css";

type LogoProps = {
  className?: string;
  priority?: boolean;
};

export function Logo({ className = "", priority = false }: LogoProps) {
  return (
    <Link href="/" className={`${styles.brand} ${className}`.trim()} aria-label="AccessPilot home">
      <Image
        src="/accesspilot-logo.png"
        alt="AccessPilot"
        width={708}
        height={169}
        priority={priority}
        className={styles.logoImage}
      />
    </Link>
  );
}
