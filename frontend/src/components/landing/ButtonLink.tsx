import Link from "./Link";
import type { ReactNode } from "react";
import styles from "./landing.module.css";
import { ArrowRightIcon } from "./Icons";

type ButtonLinkProps = {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  variant?: "primary" | "ghost" | "light";
  size?: "md" | "sm";
  withArrow?: boolean;
  className?: string;
};

export function ButtonLink({
  href,
  onClick,
  children,
  variant = "primary",
  size = "md",
  withArrow = false,
  className = "",
}: ButtonLinkProps) {
  const variantClass =
    variant === "ghost" ? styles.btnGhost : variant === "light" ? styles.btnLight : styles.btnPrimary;
  const sizeClass = size === "sm" ? styles.btnSmall : "";
  const classes = `${styles.btn} ${variantClass} ${sizeClass} ${className}`.trim();
  const content = (
    <>
      <span>{children}</span>
      {withArrow ? (
        <span className={styles.btnIcon}>
          <ArrowRightIcon />
        </span>
      ) : null}
    </>
  );

  if (!href) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
