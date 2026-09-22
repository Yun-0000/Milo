import type { SourceEvidence } from "../../../shared/types";
import { Icon } from "./Icon";

export function SourceCards({ evidence }: { evidence: SourceEvidence[] }) {
  const sources = [...new Map(evidence.filter((item) => item.kind === "fetched").map((item) => [item.finalUrl, item])).values()];
  if (!sources.length) return null;
  return (
    <ul className="source-links" aria-label="Sources">
      {sources.map((item) => (
        <li key={item.id}>
          <a href={item.finalUrl} target="_blank" rel="noreferrer" title={(item.title || item.finalUrl).replace(/&amp;/g, "&").replace(/&#0*39;|&apos;/g, "'")}>
            <span className="source-copy"><span className="source-title">{(item.title || item.finalUrl).replace(/&amp;/g, "&").replace(/&#0*39;|&apos;/g, "'")}</span><span className="source-domain">{new URL(item.finalUrl).hostname.replace(/^www\./, "")}</span></span><Icon name="arrow" />
          </a>
        </li>
      ))}
    </ul>
  );
}
