import { useState } from "react";
import type { MentionRecipient } from "./mention-draft";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Button } from "../../shared/design-system/ui/Button";

/** An agent a draft addresses that cannot reply where it is sent. */
export type UnheardAgent = MentionRecipient & {
  reason: "viewing-only" | "not-in-channel";
  own: boolean;
};
export type UnheardChoice = "send" | "solo" | null;

type Pending = {
  agents: readonly UnheardAgent[];
  solo: boolean;
  finish(choice: UnheardChoice): void;
};

/** Before a send reaches agents that can't answer here, offer to ask the agent
 * in a new Solo chat instead. Sending here stays available and unchanged. */
export function useGuestAgentMentions(restoreFocus: () => void) {
  const [pending, setPending] = useState<Pending>();
  return {
    prepare(
      agents: readonly UnheardAgent[],
      solo: boolean,
      signal: AbortSignal,
    ) {
      signal.throwIfAborted();
      return new Promise<UnheardChoice>((resolve) => {
        const finish = (choice: UnheardChoice) => {
          signal.removeEventListener("abort", abort);
          setPending(undefined);
          resolve(choice);
        };
        const abort = () => finish(null);
        signal.addEventListener("abort", abort, { once: true });
        setPending({ agents, solo, finish });
      });
    },
    dialog: (
      <Dialog
        size="compact"
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) pending?.finish(null);
        }}
        title={pending ? title(pending.agents) : ""}
        description={pending && describe(pending.agents, pending.solo)}
        finalFocus={() => {
          restoreFocus();
          return false;
        }}
        actions={
          <>
            <Button type="button" onClick={() => pending?.finish("send")}>
              Send here anyway
            </Button>
            {pending?.solo && (
              <Button
                type="button"
                variant="prominent"
                onClick={() => pending.finish("solo")}
              >
                Ask in a Solo chat
              </Button>
            )}
          </>
        }
      />
    ),
  };
}

function title(agents: readonly UnheardAgent[]) {
  return agents.length === 1
    ? `${agents[0]?.name} can’t reply here`
    : "These agents can’t reply here";
}

function describe(agents: readonly UnheardAgent[], solo: boolean) {
  const [only] = agents;
  const why =
    agents.length === 1 && only
      ? only.reason === "viewing-only"
        ? `${only.name} is viewing only in this channel${only.own ? ", so it answers you in your DM" : ""}.`
        : `${only.name} isn’t in this channel.`
      : `${agents.map((agent) => agent.name).join(", ")} can read this channel but can’t post here, or aren’t in it.`;
  return solo
    ? `${why} Ask in a Solo chat to start a private conversation that links back here.`
    : why;
}
