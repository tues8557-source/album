type IconProps = {
  className?: string;
  strokeWidth?: number;
};

export function TrashIcon({
  className = "h-4 w-4",
  strokeWidth = 2,
}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    >
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 10v6" strokeLinecap="round" />
      <path d="M14 10v6" strokeLinecap="round" />
    </svg>
  );
}

export function RotateIcon({
  className = "h-5 w-5",
  strokeWidth = 2.05,
}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    >
      <path d="M4.5 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.3 8.9A7.5 7.5 0 1 1 7.3 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({
  className = "h-5 w-5",
  strokeWidth = 2.05,
}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    >
      <path d="M12 4.5v10.2" strokeLinecap="round" />
      <path d="m8.4 11.6 3.6 3.8 3.6-3.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19.5h14" strokeLinecap="round" />
    </svg>
  );
}
