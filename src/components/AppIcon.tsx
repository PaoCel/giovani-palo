import type { SVGProps } from "react";

export type AppIconName =
  | "arrow-left"
  | "arrow-right"
  | "badge"
  | "bell"
  | "building"
  | "calendar"
  | "chart"
  | "check"
  | "download"
  | "ellipsis"
  | "eye"
  | "filter"
  | "globe"
  | "home"
  | "key"
  | "list"
  | "lock"
  | "logout"
  | "map-pin"
  | "mail"
  | "menu"
  | "pencil"
  | "plus"
  | "sparkles"
  | "ticket"
  | "trash"
  | "user"
  | "users"
  | "x";

interface AppIconProps extends SVGProps<SVGSVGElement> {
  name: AppIconName;
  decorative?: boolean;
  title?: string;
}

function getIconPaths(name: AppIconName) {
  switch (name) {
    case "arrow-left":
      return (
        <path d="M15.75 19.5 8.25 12l7.5-7.5" />
      );
    case "arrow-right":
      return (
        <path d="M8.25 4.5 15.75 12l-7.5 7.5" />
      );
    case "badge":
      return (
        <>
          <path d="M9.75 3.75h4.5l1.5 2.25h2.25v4.5l2.25 1.5-2.25 1.5v4.5h-2.25l-1.5 2.25h-4.5l-1.5-2.25H6v-4.5l-2.25-1.5L6 10.5V6h2.25l1.5-2.25Z" />
          <path d="m9.75 12 1.5 1.5 3-3" />
        </>
      );
    case "bell":
      return (
        <>
          <path d="M15 17.25H9a3.75 3.75 0 0 1-3.75-3.75v-2.16a6.75 6.75 0 1 1 13.5 0v2.16A3.75 3.75 0 0 1 15 17.25Z" />
          <path d="M10.5 19.5a1.5 1.5 0 0 0 3 0" />
        </>
      );
    case "building":
      return (
        <>
          <path d="M4.5 20.25h15" />
          <path d="M6.75 20.25V6.75l5.25-3 5.25 3v13.5" />
          <path d="M9 9.75h.008v.008H9zM12 9.75h.008v.008H12zM15 9.75h.008v.008H15zM9 12.75h.008v.008H9zM12 12.75h.008v.008H12zM15 12.75h.008v.008H15zM11.25 20.25v-3h1.5v3" />
        </>
      );
    case "calendar":
      return (
        <>
          <path d="M8.25 3.75v3M15.75 3.75v3M4.5 8.25h15" />
          <path d="M5.25 5.25h13.5a.75.75 0 0 1 .75.75v12a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75V6a.75.75 0 0 1 .75-.75Z" />
          <path d="M9 12h6M9 15h3" />
        </>
      );
    case "chart":
      return (
        <>
          <path d="M4.5 19.5h15" />
          <path d="M7.5 16.5V12" />
          <path d="M12 16.5V8.25" />
          <path d="M16.5 16.5v-4.5" />
        </>
      );
    case "check":
      return (
        <path d="m5.25 12.75 4.5 4.5 9-9" />
      );
    case "download":
      return (
        <>
          <path d="M12 3.75v10.5" />
          <path d="m8.25 10.5 3.75 3.75 3.75-3.75" />
          <path d="M4.5 19.5h15" />
        </>
      );
    case "ellipsis":
      return (
        <path d="M6 12h.008v.008H6zm6 0h.008v.008H12zm6 0h.008v.008H18z" />
      );
    case "eye":
      return (
        <>
          <path d="M2.25 12s3.75-6 9.75-6 9.75 6 9.75 6-3.75 6-9.75 6-9.75-6-9.75-6Z" />
          <path d="M12 14.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" />
        </>
      );
    case "filter":
      return (
        <>
          <path d="M4.5 6.75h15" />
          <path d="M7.5 12h9" />
          <path d="M10.5 17.25h3" />
        </>
      );
    case "globe":
      return (
        <>
          <path d="M12 3.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5Z" />
          <path d="M3.75 12h16.5" />
          <path d="M12 3.75c2.25 2.25 3.375 5 3.375 8.25S14.25 18 12 20.25c-2.25-2.25-3.375-5-3.375-8.25S9.75 6 12 3.75Z" />
        </>
      );
    case "home":
      return (
        <>
          <path d="m3.75 10.5 8.25-6.75 8.25 6.75" />
          <path d="M6.75 9.75v9h10.5v-9" />
        </>
      );
    case "key":
      return (
        <>
          <path d="M15 7.5a3.75 3.75 0 1 1-6.308 2.71L3.75 15.15V18h2.85v-1.65h1.65V14.7H9.9l4.44-4.44A3.735 3.735 0 0 1 15 7.5Z" />
          <path d="M16.5 6.75h.008v.008H16.5z" />
        </>
      );
    case "list":
      return (
        <>
          <path d="M8.25 6.75h11.25" />
          <path d="M8.25 12h11.25" />
          <path d="M8.25 17.25h11.25" />
          <path d="M4.5 6.75h.008v.008H4.5zM4.5 12h.008v.008H4.5zM4.5 17.25h.008v.008H4.5z" />
        </>
      );
    case "lock":
      return (
        <>
          <path d="M7.5 10.5V8.25a4.5 4.5 0 1 1 9 0v2.25" />
          <path d="M6.75 10.5h10.5a.75.75 0 0 1 .75.75V18a.75.75 0 0 1-.75.75H6.75A.75.75 0 0 1 6 18v-6.75a.75.75 0 0 1 .75-.75Z" />
        </>
      );
    case "logout":
      return (
        <>
          <path d="M15.75 8.25V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h8.25a1.5 1.5 0 0 0 1.5-1.5v-2.25" />
          <path d="M10.5 12h9" />
          <path d="m16.5 8.25 3.75 3.75-3.75 3.75" />
        </>
      );
    case "mail":
      return (
        <>
          <path d="M3.75 6.75h16.5v10.5H3.75z" />
          <path d="m4.5 7.5 7.5 6 7.5-6" />
        </>
      );
    case "menu":
      return (
        <>
          <path d="M4.5 7.5h15" />
          <path d="M4.5 12h15" />
          <path d="M4.5 16.5h15" />
        </>
      );
    case "map-pin":
      return (
        <>
          <path d="M12 20.25s6-5.377 6-10.125a6 6 0 1 0-12 0c0 4.748 6 10.125 6 10.125Z" />
          <path d="M12 12.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" />
        </>
      );
    case "sparkles":
      return (
        <>
          <path d="m12 3.75 1.62 4.88L18.75 10l-5.13 1.37L12 16.25l-1.62-4.88L5.25 10l5.13-1.37L12 3.75Z" />
          <path d="m19.5 15 .71 2.04L22.25 18l-2.04.96L19.5 21l-.71-2.04L16.75 18l2.04-.96L19.5 15Z" />
          <path d="m4.5 14.25.94 2.56L8 17.75l-2.56.94L4.5 21l-.94-2.31L1 17.75l2.56-.94.94-2.56Z" />
        </>
      );
    case "pencil":
      return (
        <>
          <path d="M4.5 19.5 8.25 18l9-9a1.59 1.59 0 0 0 0-2.25l-1-1a1.59 1.59 0 0 0-2.25 0l-9 9L4.5 19.5Z" />
          <path d="M13.5 6.75 17.25 10.5" />
        </>
      );
    case "plus":
      return (
        <>
          <path d="M12 5.25v13.5" />
          <path d="M5.25 12h13.5" />
        </>
      );
    case "ticket":
      return (
        <>
          <path d="M4.5 7.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v2.25a2.25 2.25 0 0 0 0 4.5v2.25A1.5 1.5 0 0 1 18 18H6a1.5 1.5 0 0 1-1.5-1.5v-2.25a2.25 2.25 0 0 0 0-4.5V7.5Z" />
          <path d="M9 7.5v9M15 7.5v9" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M5.25 7.5h13.5" />
          <path d="M9 7.5V5.25h6V7.5" />
          <path d="M7.5 7.5v11.25a.75.75 0 0 0 .75.75h7.5a.75.75 0 0 0 .75-.75V7.5" />
          <path d="M10.5 10.5v5.25M13.5 10.5v5.25" />
        </>
      );
    case "user":
      return (
        <>
          <path d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
          <path d="M4.5 19.5a7.5 7.5 0 0 1 15 0" />
        </>
      );
    case "users":
      return (
        <>
          <path d="M9 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 8.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
          <path d="M1.5 18.75a6 6 0 0 1 12 0M15.75 18.75a4.5 4.5 0 0 1 6.75-3.9" />
        </>
      );
    case "x":
      return (
        <>
          <path d="m6.75 6.75 10.5 10.5" />
          <path d="m17.25 6.75-10.5 10.5" />
        </>
      );
    default:
      return <path d="M12 4.5v15M4.5 12h15" />;
  }
}

export function AppIcon({
  name,
  decorative = true,
  title,
  ...props
}: AppIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative || !title ? true : undefined}
      role={!decorative && title ? "img" : undefined}
      {...props}
    >
      {!decorative && title ? <title>{title}</title> : null}
      {getIconPaths(name)}
    </svg>
  );
}
