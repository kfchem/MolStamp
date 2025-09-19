export const SHARE_BASE_URL =
  typeof window === "undefined"
    ? ""
    : process.env.NEXT_PUBLIC_SHARE_BASE_URL ?? window.location.origin;
