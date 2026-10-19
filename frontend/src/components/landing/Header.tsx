import { useEffect, useState } from "react";
import styles from "./landing.module.css";
import { ButtonLink } from "./ButtonLink";
import { CloseIcon, MenuIcon } from "./Icons";
import { Logo } from "./Logo";
import { useStartScan } from "./useStartScan";

const navItems = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#why-accesspilot", label: "Why AccessPilot" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const start = useStartScan();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <header className={styles.siteHeader}>
      <div className={styles.shell}>
        <div className={styles.headerBar}>
          <Logo priority className={styles.headerLogo} />

          <nav className={styles.nav} aria-label="Primary navigation">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className={styles.navLink}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className={styles.headerCta}>
            {start.authed && <ButtonLink href="/dashboard" variant="ghost" size="sm">Dashboard</ButtonLink>}
            <ButtonLink
              href={start.href}
              onClick={start.onClick}
              size="sm"
              withArrow
            >
              {start.shortLabel}
            </ButtonLink>
          </div>

          <button
            type="button"
            className={styles.menuToggle}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>

        <div
          id="mobile-navigation"
          className={styles.mobileMenu}
          data-open={open ? "true" : "false"}
          aria-hidden={!open}
        >
          <nav className={styles.mobileNav} aria-label="Mobile navigation">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={styles.mobileNavLink}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {start.authed && <ButtonLink href="/dashboard" variant="ghost">Dashboard</ButtonLink>}
          <ButtonLink
            href={start.href}
            onClick={start.onClick}
            withArrow
            className={styles.mobileCta}
          >
            {start.label}
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
