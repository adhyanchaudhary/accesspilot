import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import styles from "./landing.module.css";
import Link from "./Link";
import { Logo } from "./Logo";

export function Footer() {
  const { status } = useAuth();
  const authed = status === "authenticated";

  return (
    <footer className={styles.siteFooter}>
      <div className={styles.shell}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}>
            <Logo className={styles.footerLogo} />
            <p>
              An AI-powered accessibility auditor that helps teams find, fix, and verify web
              accessibility issues.
            </p>
            <span className={styles.footerBadge}>
              <span aria-hidden="true" />
              WCAG 2.2 aligned checks
            </span>
          </div>

          <div className={styles.footerCols}>
            <div className={styles.footerCol}>
              <h3>Explore</h3>
              <ul>
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#how-it-works">How it works</a>
                </li>
                <li>
                  <a href="#why-accesspilot">Why AccessPilot</a>
                </li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h3>Get started</h3>
              <ul>
                <li>
                  <Link href={authed ? "/dashboard" : api.loginUrl()}>
                    {authed ? "Go to dashboard" : "Start a scan"}
                  </Link>
                </li>
                <li>
                  <a href="#main">Back to top</a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className={styles.footerBottom}>
          <span className={styles.footerTagline}>
            Accessibility isn’t a feature. It’s a better web for everyone.
          </span>
          <span>© 2026 AccessPilot. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
