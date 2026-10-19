import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h15M13 5l7 7-7 7" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={2.4} {...props}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export function WorkflowIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M7 12h10M9 17h6" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 5 6.5V11c0 4.4 2.9 7 7 8 4.1-1 7-3.6 7-8V6.5z" />
      <path d="m9 11.5 2 2 4-4.5" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

export function UserCheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c.7-4 3.4-6 7-6s6.3 2 7 6" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c.6-3.7 2.7-5.5 6-5.5s5.4 1.8 6 5.5M16 5.5a3 3 0 0 1 0 5.8M18 14c2 .8 3 2.7 3 6" />
    </svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

export function CodeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5 10.5 19" />
    </svg>
  );
}

export function BadgeCheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.2 14 5l2.6-.4 1 2.4 2.4 1-.4 2.6 1.8 2-1.8 2 .4 2.6-2.4 1-1 2.4L14 19l-2 1.8L10 19l-2.6.4-1-2.4-2.4-1 .4-2.6-1.8-2 1.8-2-.4-2.6 2.4-1 1-2.4L10 5z" />
      <path d="m8.7 12.2 2.1 2.1 4.5-4.6" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V4M4 20h16" />
      <path d="m7.5 15 3-3.5 3 2 4-6" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2.5" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" />
    </svg>
  );
}
