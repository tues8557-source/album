import type { ButtonHTMLAttributes } from "react";

type ActionStatusButtonProps = {
  label: string;
  display?: string;
  fullWidth?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

function StableButtonLabel({
  label,
  display,
}: {
  label: string;
  display: string;
}) {
  return (
    <span className="relative inline-grid items-center justify-items-center whitespace-nowrap">
      <span className="invisible">{label}</span>
      <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap">
        {display}
      </span>
    </span>
  );
}

export function ActionStatusButton({
  label,
  display,
  fullWidth = false,
  className = "",
  type = "button",
  ...buttonProps
}: ActionStatusButtonProps) {
  const classes = [
    "flex min-h-10 items-center justify-center rounded-md bg-zinc-900 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
    fullWidth ? "w-full px-2 py-2" : "px-3 py-2",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
    >
      <StableButtonLabel label={label} display={display ?? label} />
    </button>
  );
}
