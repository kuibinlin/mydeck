// variants: primary | success | danger | outline | ghost | github
// size: md (default) | sm
// Renders <a> when href is provided.
// Extend base styles via className prop.
import { cn } from "@/lib/cn";

const BASE =
  "inline-flex items-center gap-1.5 font-semibold rounded-btn transition-all cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANTS = {
  primary: "bg-primary hover:bg-primary-hover text-white",
  success: "bg-success hover:opacity-90 text-white",
  danger: "bg-error hover:opacity-90 text-white",
  outline:
    "bg-transparent text-primary border-[1.5px] border-primary hover:bg-primary hover:text-white",
  dangerOutline:
    "bg-transparent text-error border border-error hover:bg-error hover:text-white",
  ghost: "bg-transparent text-muted hover:text-text",
  github: "bg-[#24292e] hover:bg-[#1a1e22] text-white",
  ai: "bg-purple-600 hover:bg-purple-700 text-white",
};

const SIZES = {
  md: "px-5 py-2.5 text-sm",
  sm: "px-3.5 py-1.5 text-xs",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  disabled,
  type = "button",
  href,
  className = "",
  ...props
}) {
  const cls = cn(BASE, VARIANTS[variant], SIZES[size], className);

  if (href) {
    return (
      <a href={href} className={cls} {...props}>
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
