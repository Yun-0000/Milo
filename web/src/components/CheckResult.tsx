import type { CheckTask } from "../../../shared/types";
import { checkSources } from "../../../shared/checkSources";
import { SourceCards } from "./SourceCards";
import { Icon } from "./Icon";

export function CheckResult({ task, voice }: { task: CheckTask; voice: boolean }) {
  if (task.status !== "completed" || (voice && task.voiceDelivery?.status !== "ready")) return null;
  const sources = checkSources(task).filter((source) => !voice || task.voiceDelivery?.sourceIds.includes(source.id));
  return <div className="concise-answer" aria-live="polite">
    {!voice ? task.claims.map((claim) => <p key={claim.id}>{claim.basis || claim.text}</p>) : null}
    {sources.length ? <details className="source-disclosure" key={task.id} open>
      <summary title="Show or hide sources"><span>Sources</span><Icon name="chevron" /></summary>
      <SourceCards evidence={sources} />
    </details> : null}
    {voice && !sources.length ? <p className="hint">No verified sources for this check.</p> : null}
  </div>;
}
