import type { ComponentType } from "../domain/types";

/** Line icons for each part type, drawn to match the lucide icon set. */
const paths: Record<ComponentType, JSX.Element> = {
  pipe: (
    <>
      <path d="M6 10h12v4H6z" />
      <path d="M3 8.5h3v7H3zM18 8.5h3v7h-3z" />
    </>
  ),
  "curved-pipe": (
    <>
      <path d="M4 9.5h4a6.5 6.5 0 0 1 6.5 6.5v4" />
      <path d="M4 14h4a2 2 0 0 1 2 2v4" />
      <path d="M2.5 8v7.5M9 21.5h7" />
    </>
  ),
  valve: (
    <>
      <path d="M2.5 13h4M17.5 13h4" />
      <circle cx="12" cy="13" r="4.5" />
      <path d="M12 8.5V5M8 4.5h9" />
    </>
  ),
  tap: (
    <>
      <path d="M3 11h6" />
      <path d="M9 8h4v7H9z" />
      <path d="M13 10h3a3 3 0 0 1 3 3v2" />
      <path d="M8 5h6" />
      <path d="M19 18v.5M19 21v.5" />
    </>
  ),
  tank: (
    <>
      <path d="M7 6.5a5 2 0 0 1 10 0v10a5 2 0 0 1-10 0z" />
      <path d="M17 11h3.5" />
      <path d="M9 18.5 8 22M15 18.5l1 3.5" />
    </>
  ),
  custom: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
};

export function PartIcon(
  { type, size = 20 }: { type: ComponentType; size?: number },
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[type]}
    </svg>
  );
}
