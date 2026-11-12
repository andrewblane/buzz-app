import { useEffect, useRef, useState } from "react";
import { useAgentChoices } from "../../features/agents/use-choices";
import type { RelaySession } from "../../features/relay/session";
import { Accordion } from "../../shared/design-system/ui/Accordion";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { Input } from "../../shared/design-system/ui/Input";
import { ReviewerIdentity } from "./LaneReviewers";
import { loadConfigurations } from "./configuration";
import { createPullReader, type ReadPull } from "./pull-facts";
import {
  loadSubmissions,
  prUrl,
  pullRepository,
  pullRequest,
  submitReview,
  submissionLane,
  type SavedSubmission,
} from "./submissions";

const publicPullReader = createPullReader();

export function ReviewSubmissions({
  session,
  channel,
  writable,
  onEditingChange,
  onOpenThread,
  readPull = publicPullReader,
}: {
  session: RelaySession;
  channel: string;
  writable: boolean;
  onEditingChange: (editing: boolean) => void;
  onOpenThread?: ((channel: string, id: string) => Promise<void>) | undefined;
  readPull?: ReadPull;
}) {
  const choices = useAgentChoices(session, true, true);
  const [pr, setPr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<SavedSubmission>();
  const [rows, setRows] = useState<SavedSubmission[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [warning, setWarning] = useState("");
  const [reload, setReload] = useState(0);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    onEditingChange(busy || !!pr.trim());
    return () => onEditingChange(false);
  }, [busy, pr, onEditingChange]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload is an explicit fresh read.
  useEffect(() => {
    const controller = new AbortController();
    setListError("");
    setListLoading(true);
    loadSubmissions(
      session,
      channel,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        // A list read can finish after Submit; keep the action's newer result.
        setRows((current) => [
          ...current,
          ...next.rows.filter(
            (row) =>
              !current.some((item) => item.artifactId === row.artifactId),
          ),
        ]);
        setWarning(next.warning);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setListError(
            reason instanceof Error
              ? reason.message
              : "Could not load previous submissions.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [session, channel, reload]);

  async function submit() {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(120_000),
    ]);
    operation.current = controller;
    setBusy(true);
    setError("");
    setResult(undefined);
    setStatus("Finding repository and assigning reviewers…");
    let existing = false;
    let recorded = false;
    let alreadyComplete: boolean | undefined;
    try {
      const repository = pullRepository(pr);
      const configurations = await loadConfigurations(session, channel, signal);
      const saved = configurations.rows.find(
        (row) => row.config.repository === repository,
      );
      if (!saved) {
        if (configurations.truncated || configurations.unreadable)
          throw new Error(
            "Could not confirm this repository's configuration. Check Review Configuration and try again.",
          );
        throw new Error(
          `${repository} is not configured in this channel. Add it in Review Configuration, then submit again.`,
        );
      }
      const record = await submitReview(
        session,
        channel,
        saved,
        pr,
        saved.config.lanes.map((lane) => lane.reviewers[0] ?? ""),
        signal,
        (next) => {
          if (controller.signal.aborted) return;
          recorded = true;
          alreadyComplete ??= next.value.threads.every(
            (thread) => thread.delivered,
          );
          setResult(next);
          setRows((current) => [
            next,
            ...current.filter((row) => row.artifactId !== next.artifactId),
          ]);
        },
        true,
        () => readPull(repository, pullRequest(pr, repository), signal),
        () => {
          existing = true;
        },
      );
      if (controller.signal.aborted) return;
      setResult(record);
      setStatus(
        existing && alreadyComplete
          ? "Already exists — reviewers notified in their existing threads."
          : "Submitted — reviewers assigned and requests delivered.",
      );
    } catch (reason) {
      if (!controller.signal.aborted) {
        setStatus("");
        setError(
          `${reason instanceof Error ? reason.message : "Could not submit PR."}${recorded ? " Existing threads are preserved. Submit again to retry unconfirmed delivery." : ""}`,
        );
      }
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function threads(row: SavedSubmission) {
    return (
      <section
        className="review-config-form"
        aria-label={`${row.value.config.repository}#${row.value.pr} reviewers`}
      >
        {row.value.threads.map((thread, index) => {
          const lane = submissionLane(row.value, index);
          return (
            <div
              key={lane?.id ?? "overview"}
              className="review-config-actions review-config-result-row"
            >
              <span className="text-caption text-subtle">
                {lane?.name ?? "Overview (earlier submission)"}
              </span>
              {lane?.reviewers.map((pubkey) => (
                <ReviewerIdentity
                  key={pubkey}
                  pubkey={pubkey}
                  choices={choices}
                />
              ))}
              <div className="review-config-actions">
                {thread.id ? (
                  <Button
                    disabled={busy || !onOpenThread}
                    onClick={async () => {
                      try {
                        if (thread.id) await onOpenThread?.(channel, thread.id);
                      } catch (reason) {
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "Could not open thread.",
                        );
                      }
                    }}
                  >
                    Open {lane?.name ?? "overview"} thread
                  </Button>
                ) : (
                  <span>Thread delivery pending</span>
                )}
                {!thread.delivered && thread.id && (
                  <span>Delivery unconfirmed</span>
                )}
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <section className="review-config-form" aria-label="PR submissions">
      <form
        className="review-config-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="GitHub PR URL"
          description="We’ll assign a reviewer to each matching lane. Submitting an existing PR notifies its reviewers again."
        >
          <Input
            ref={input}
            required
            maxLength={300}
            value={pr}
            disabled={busy}
            placeholder="https://github.com/example-org/project/pull/123"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onValueChange={(value) => {
              setPr(value);
              setError("");
              setStatus("");
              setResult(undefined);
            }}
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant="prominent"
            loading={busy}
            disabled={!writable || !pr.trim()}
          >
            Submit PR
          </Button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {result && (
        <section className="review-config-form" aria-label="Submission result">
          <InlineHeader
            title={`${result.value.config.repository}#${result.value.pr}`}
          />
          {threads(result)}
        </section>
      )}
      <section className="review-config-form" aria-label="Existing PRs">
        <InlineHeader title="Existing PRs" />
        <LoadingRegion
          pending={listLoading}
          label="Loading submissions…"
          statusVisibility="screen-reader"
        >
          {!listLoading && !listError && !rows.length && (
            <p>No PRs submitted in this channel yet.</p>
          )}
        </LoadingRegion>
        {listError && (
          <>
            <p role="alert">{listError}</p>
            <div>
              <Button
                disabled={busy}
                onClick={() => setReload((value) => value + 1)}
              >
                Reload submissions
              </Button>
            </div>
          </>
        )}
        {warning && <p role="alert">{warning}</p>}
        <Accordion
          variant="form"
          items={rows
            .filter((row) => row.artifactId !== result?.artifactId)
            .map((row) => ({
              value: row.artifactId,
              title: (
                <span className="review-config-pr-summary">
                  <span>
                    {row.value.config.repository}#{row.value.pr}
                  </span>
                  <span className="text-caption text-subtle">
                    {row.value.threads.every((thread) => thread.delivered)
                      ? "Requests delivered"
                      : "Delivery incomplete"}
                  </span>
                </span>
              ),
              content: (
                <div className="review-config-form">
                  {threads(row)}
                  <div>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setPr(prUrl(row.value));
                        input.current?.focus();
                        setResult(row);
                        setError("");
                        setStatus(
                          "Submit again to notify reviewers or resume incomplete delivery.",
                        );
                      }}
                    >
                      Use this PR
                    </Button>
                  </div>
                </div>
              ),
            }))}
        />
      </section>
    </section>
  );
}
