import { useEffect, useState } from "react";
import { Accordion } from "../../shared/design-system/ui/Accordion";
import { Button } from "../../shared/design-system/ui/Button";
import { ToastNotice } from "../../shared/design-system/ui/Toast";
import { messagePreview } from "../notifications/content";
import type { RelayEvent } from "../relay/events";
import { threadReference } from "../relay/thread-reference";
import { useAgentsSnapshot } from "./react";
import type { Agent, Agents } from "./service";

/** Asks the owner whether agents that were working when the app last closed
 * or reloaded carry on; nothing resumes until they choose. */
export function InterruptedNotice({ agents }: { agents: Agents }) {
  const interrupted = useAgentsSnapshot(agents)?.interrupted ?? [];
  if (!interrupted.length) return null;
  const names = new Intl.ListFormat(undefined, { type: "conjunction" }).format(
    interrupted.map((agent) => agent.name),
  );
  return (
    <ToastNotice
      title={
        interrupted.length === 1
          ? "Resume interrupted agent?"
          : "Resume interrupted agents?"
      }
      description={`${names} ${interrupted.length === 1 ? "was" : "were"} working when Buzz closed or reloaded.`}
      details={<InterruptedDetails agents={agents} interrupted={interrupted} />}
      tone="info"
    >
      <Button
        type="button"
        size="sm"
        variant="prominent"
        onClick={agents.resumeInterrupted}
      >
        Resume
      </Button>
      <Button type="button" size="sm" onClick={agents.dismissInterrupted}>
        Don’t resume
      </Button>
    </ToastNotice>
  );
}

/** Where the agents were working, read from the relay only once opened.
 * Resume reads the mentions again, so this is a preview, not a promise. */
function InterruptedDetails({
  agents,
  interrupted,
}: {
  agents: Agents;
  interrupted: readonly Agent[];
}) {
  const [open, setOpen] = useState(false);
  // Read once opened, and kept: closing it again does not read again.
  const [requested, setRequested] = useState(false);
  const [read, setRead] = useState<
    Readonly<Record<string, readonly RelayEvent[] | null>>
  >({});
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    for (const agent of interrupted) {
      const settle = (events: readonly RelayEvent[] | null) => {
        if (!controller.signal.aborted)
          setRead((prior) => ({ ...prior, [agent.key]: events }));
      };
      agents
        .readInterrupted(agent, controller.signal)
        .then(settle, () => settle(null));
    }
    return () => controller.abort();
  }, [requested, agents, interrupted]);
  const groups = interrupted.map((agent) => ({
    agent,
    turns: agents.interruptedTurns(agent),
  }));
  const count = groups.reduce((sum, { turns }) => sum + turns.length, 0);
  return (
    <Accordion
      variant="activity"
      value={open ? ["details"] : []}
      onValueChange={(value) => {
        setOpen(value.includes("details"));
        if (value.includes("details")) setRequested(true);
      }}
      items={[
        {
          value: "details",
          title: `${count} ${count === 1 ? "mention" : "mentions"}`,
          content: (
            <div className="grid max-h-48 gap-3 overflow-y-auto">
              {groups.map(({ agent, turns }) => (
                <section key={agent.key} className="grid gap-2">
                  {interrupted.length > 1 && (
                    <h4 className="m-0 text-label-sm text-subtle">
                      {agent.name}
                    </h4>
                  )}
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {conversations(turns, read[agent.key]).map((row) => (
                      <li key={row.key} className="min-w-0">
                        <div className="truncate text-label-sm">
                          {row.channel}
                        </div>
                        <div className="truncate text-body-sm text-subtle">
                          {row.place}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}

/** One row per conversation once its mentions are read; until then, or when
 * a mention was not found, one per mention. */
function conversations(
  turns: ReturnType<Agents["interruptedTurns"]>,
  events: readonly RelayEvent[] | null | undefined,
) {
  const rows = new Map<
    string,
    { key: string; channel: string; detail: string; count: number }
  >();
  for (const turn of turns) {
    const channel = turn.channel?.name ?? "Unknown channel";
    const event = events?.find((item) => item.id === turn.id);
    if (!event) {
      const detail = events === undefined ? "Checking…" : "Details unavailable";
      rows.set(turn.id, { key: turn.id, channel, detail, count: 1 });
      continue;
    }
    const reply = threadReference(event);
    const key = `${turn.channelId}:${reply?.rootId ?? event.id}`;
    const row = rows.get(key);
    if (row) row.count++;
    else
      rows.set(key, {
        key,
        channel,
        detail: `${reply ? "Thread" : "In channel"} · “${messagePreview(event.content)}”`,
        count: 1,
      });
  }
  return [...rows.values()].map(({ key, channel, detail, count }) => ({
    key,
    channel,
    place: count > 1 ? `${detail} · ${count} mentions` : detail,
  }));
}
