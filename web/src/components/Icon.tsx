import type { CSSProperties } from "react";

const paths = {
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3v-8.5A8.5 8.5 0 1 1 21 11.5Z M8 11.5h.1 M12 11.5h.1 M16 11.5h.1",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
  mute: "M3 3l18 18 M9 9v3a3 3 0 0 0 5 2 M15 9V6a3 3 0 0 0-5-2 M5 10v2a7 7 0 0 0 12 5 M19 10v2 M12 19v3 M8 22h8",
  camera: "M3 7h4l2-3h6l2 3h4v14H3Z M16 13a4 4 0 1 0-8 0a4 4 0 0 0 8 0",
  sources: "M6 3h8l4 4v14H6Z M14 3v5h4 M9 12h6 M9 16h6",
  stop: "M7 7h10v10H7Z",
  keyboard: "M3 6h18v13H3Z M6 10h1 M10 10h1 M14 10h1 M18 10h.1 M6 14h1 M10 14h7",
  float: "M4 14V4h16v16H10 M3 21l9-9 M5 12h7v7",
  close: "M6 6l12 12 M18 6 6 18",
  chevron: "M6 9l6 6 6-6",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  sound: "M4 10v4h4l5 4V6l-5 4Z M17 8a6 6 0 0 1 0 8 M20 5a10 10 0 0 1 0 14",
} as const;

export function Icon({ name, style }: { name: keyof typeof paths; style?: CSSProperties }) {
  return <svg style={style} className="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
