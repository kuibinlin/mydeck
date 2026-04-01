// variant: error (default) | success | warning
// Extend base styles via className prop.
import { cn } from "@/lib/cn";

const VARIANTS = {
  error: "bg-red-100 text-red-700 dark:bg-red-900/15 dark:text-[#ff6b6b]",
  success:
    "bg-green-100 text-green-700 dark:bg-green-900/15 dark:text-[#6ee7a0]",
  warning:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/15 dark:text-amber-400",
};

export default function Alert({ variant = "error", children, className = "" }) {
  return (
    <div
      className={cn(
        "p-2.5 px-3.5 rounded-lg mb-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
