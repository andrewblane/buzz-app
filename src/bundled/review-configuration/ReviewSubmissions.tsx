import { createAdmissionReader, type ReadAdmission } from "./admission";
import { triageError, subscribeTriageErrors } from "./triage-recovery";
import { REVIEW_SUBMISSION } from "../../features/agents/pr-review";
import type { EventData } from "../../features/relay/events";
import type { ToolDescription } from "../../buzz-mcp/session-tools";
import {
  overallReviewStatus,
  REVIEW_REPORT,
  type ReviewState,
} from "../../features/agents/pr-review";
const reviewLabels: Record<ReviewState, string> = {
  need_review: "Needs review",
  done: "Done",
  wait_author: "Waiting on author",
};
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAgentChoices } from "../../features/agents/use-choices";
import type { RelaySession } from "../../features/relay/session";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { TrashIcon } from "../../shared/design-system/icons";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { Input } from "../../shared/design-system/ui/Input";
import { ReviewerIdentity } from "./LaneReviewers";
import { loadConfigurations } from "./configuration";
import {
  createPullReader,
  createPullStatusReader,
  type PullStatus,
  type ReadPullStatus,
  type ReadPull,
} from "./pull-facts";
import {
  loadSubmissions,
  deliveryThreads,
  applyReviewReports,
  deleteSubmission,
  remindSubmission,
  prUrl,
  pullRepository,
  pullRequest,
  submitReview,
  submissionLane,
  type SavedSubmission,
} from "./submissions";

const publicPullReader = createPullReader();
const publicStatusReader = createPullStatusReader();
const publicAdmissionReader = createAdmissionReader();
function TriageError({ scope, artifact }: { scope: string; artifact: string }) {
  const message = useSyncExternalStore(subscribeTriageErrors, () =>
    triageError(scope, artifact),
  );
  return message ? <p role="alert">{message}</p> : null;
}

export function ReviewSubmissions({
  session,
  mode = "submit",
  channel,
  writable,
  onEditingChange,
  onOpenThread,
  readPull = publicPullReader,
  readStatus = publicStatusReader,
  readAdmission = publicAdmissionReader,
  describeTool,
}: {
  session: RelaySession;
  mode?: "submit" | "all";
  channel: string;
  writable: boolean;
  onEditingChange: (editing: boolean) => void;
  onOpenThread?: ((channel: string, id: string) => Promise<void>) | undefined;
  readPull?: ReadPull;
  readStatus?: ReadPullStatus;
  readAdmission?: ReadAdmission;
  describeTool?: ((name: string) => ToolDescription | undefined) | undefined;
}) {
  const choices = useAgentChoices(session, true, true);
  const [pr, setPr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<SavedSubmission>();
  const [rows, setRows] = useState<SavedSubmission[]>([]);
  const [statuses, setStatuses] = useState<
    Record<string, { value: PullStatus | "Unavailable"; error?: string }>
  >({});
  const input = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLDivElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [removing, setRemoving] = useState<SavedSubmission>();
  const [deleteError, setDeleteError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [warning, setWarning] = useState("");
  const [reload, setReload] = useState(0);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    onEditingChange(busy || !!removing || (!result && !!pr.trim()));
    return () => onEditingChange(false);
  }, [busy, pr, result, removing, onEditingChange]);
  const resultId = result?.artifactId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload is an explicit fresh read.
  useEffect(() => {
    if (mode !== "all" && !resultId) return;
    const controller = new AbortController();
    setListError("");
    setListLoading(true);
    // Subscribe before reading so reports arriving during the snapshot are kept.
    const pending: EventData[] = [];
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;
    const stop = session.subscribeLive?.(({ events }) => {
      if (
        events.some(
          (event) =>
            event.kind === 45010 &&
            event.tags.some((tag) => tag[0] === "h" && tag[1] === channel) &&
            event.tags.some(
              (tag) => tag[0] === "type" && tag[1] === REVIEW_SUBMISSION,
            ),
        )
      ) {
        clearTimeout(refresh);
        refresh = setTimeout(() => setReload((value) => value + 1), 100);
      }
      const reports = events.filter(
        (event) =>
          event.kind === 9 &&
          event.tags.some((tag) => tag[0] === "h" && tag[1] === channel) &&
          event.tags.some((tag) => tag[0] === "t" && tag[1] === REVIEW_REPORT),
      );
      if (!reports.length) return;
      if (!loaded) pending.push(...reports);
      else {
        setRows((rows) =>
          rows.map((row) => applyReviewReports(row, channel, reports)),
        );
        setResult((row) => row && applyReviewReports(row, channel, reports));
      }
    });
    loadSubmissions(
      session,
      channel,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        loaded = true;
        const reconciled = next.rows.map((row) =>
          applyReviewReports(row, channel, pending),
        );
        setRows(reconciled);
        pending.length = 0;
        if (resultId)
          setResult(
            (current) =>
              reconciled.find(
                (row) => row.artifactId === current?.artifactId,
              ) ?? current,
          );
        setWarning(next.warning);
      })
      .catch((reason: unknown) => {
        loaded = true;
        pending.length = 0;
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
    return () => {
      controller.abort();
      stop?.();
      clearTimeout(refresh);
    };
  }, [session, channel, reload, mode, resultId]);

  const statusRowsKey = rows.map((row) => row.revision).join(":");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Report updates preserve PR/revision; only saved-row changes and explicit Reload require GitHub reads.
  useEffect(() => {
    if (mode !== "all") return;
    const controller = new AbortController();
    setStatuses({});
    let next = 0;
    async function worker() {
      while (!controller.signal.aborted) {
        const row = rows[next++];
        if (!row) return;
        try {
          const value = await readStatus(
            row.value.config.repository,
            row.value.pr,
            AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          );
          if (!controller.signal.aborted)
            setStatuses((current) => ({
              ...current,
              [row.revision]: { value },
            }));
        } catch (reason) {
          if (!controller.signal.aborted)
            setStatuses((current) => ({
              ...current,
              [row.revision]: {
                value: "Unavailable",
                error:
                  reason instanceof Error
                    ? reason.message
                    : "Could not read PR status.",
              },
            }));
        }
      }
    }
    // Limit GitHub/desktop work when the bounded saved list contains many PRs.
    for (let index = 0; index < Math.min(rows.length, 4); index++)
      void worker();
    return () => controller.abort();
  }, [statusRowsKey, mode, readStatus, reload]);

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
          alreadyComplete ??= deliveryThreads(next.value).every(
            (thread) => thread.delivered,
          );
          setResult(next);
        },
        true,
        () => readPull(repository, pullRequest(pr, repository), signal),
        () => {
          existing = true;
        },
        toolDocumentation(),
        {
          read: readAdmission,
          documentation: saved.config.admission?.triage
            ? toolDocumentation("pr_triage_decision")
            : "",
        },
      );
      if (controller.signal.aborted) return;
      setResult(record);
      setStatus(
        record.value.triage?.state === "pending"
          ? "Submitted — awaiting agent triage. Keep Buzz connected on this device to continue automatically."
          : record.value.triage?.state === "rejected"
            ? `Rejected: ${record.value.triage.message}`
            : existing && alreadyComplete
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

  function toolDocumentation(name = "pr_review_status_update") {
    const tool = describeTool?.(name);
    if (!tool)
      throw new Error(
        "Review reporting is unavailable. Update Buzz before sending review requests.",
      );
    return `Tool: ${tool.name}\n${tool.description}\nArguments: ${JSON.stringify(tool.inputSchema)}`;
  }

  async function remind(row: SavedSubmission) {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    const name = `${row.value.config.repository}#${row.value.pr}`;
    setStatus(`Reminding reviewers for ${name}…`);
    try {
      const updated = await remindSubmission(
        session,
        channel,
        row,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        async (repository, pr, signal) => {
          try {
            const value = await readStatus(repository, pr, signal);
            if (!controller.signal.aborted)
              setStatuses((current) => ({
                ...current,
                [row.revision]: { value },
              }));
            return value;
          } catch (reason) {
            if (!controller.signal.aborted)
              setStatuses((current) => ({
                ...current,
                [row.revision]: { value: "Unavailable" },
              }));
            throw reason;
          }
        },
        toolDocumentation(),
      );
      if (!controller.signal.aborted) {
        // A reviewer may have reported while later lane notifications were pending.
        // Reload captures those reports; the read effect buffers concurrent arrivals.
        setReload((value) => value + 1);
        if (updated)
          setRows((rows) =>
            rows.map((entry) =>
              entry.artifactId === updated.artifactId ? updated : entry,
            ),
          );
        setStatus(
          `Reviewers reminded for ${name} in their existing threads. Status reset to needs review.`,
        );
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setStatus("");
        setError(
          `${reason instanceof Error ? reason.message : "Could not remind reviewers."} Reload to refresh PR status; use Remind to retry unconfirmed delivery when available.`,
        );
      }
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function remove() {
    if (!removing || operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setDeleteError("");
    setError("");
    setStatus("");
    try {
      await deleteSubmission(
        session,
        channel,
        removing,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (controller.signal.aborted) return;
      setRows((current) =>
        current.filter((row) => row.artifactId !== removing.artifactId),
      );
      setRemoving(undefined);
      setStatus(
        "Submission deleted from the list. Existing conversations are kept.",
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setDeleteError(
          `${reason instanceof Error ? reason.message : "Could not delete submission."} Close this confirmation and reload to check the saved state before retrying.`,
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function threads(row: SavedSubmission) {
    return (
      <div className="review-config-reviewers">
        {row.value.triage && (
          <div className="review-config-thread-cell">
            <span className="text-caption text-subtle">Triage</span>
            <ReviewerIdentity
              pubkey={row.value.triage.agent}
              choices={choices}
            />
            {row.value.triage.message && <p>{row.value.triage.message}</p>}
            {row.value.triage.thread.id ? (
              <Button
                size="sm"
                disabled={busy || !onOpenThread}
                onClick={() => {
                  const id = row.value.triage?.thread.id;
                  if (id)
                    void onOpenThread?.(channel, id).catch((reason) =>
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "Could not open triage thread.",
                      ),
                    );
                }}
              >
                Open triage thread
              </Button>
            ) : (
              <span>Triage delivery pending</span>
            )}
            {row.value.triage.state === "pending" && (
              <p className="text-caption text-subtle">
                Continues on the submitting device. Submit this PR again to
                retry.
              </p>
            )}
            <TriageError scope={session.scope} artifact={row.artifactId} />
          </div>
        )}
        {row.value.threads.map((thread, index) => {
          const lane = submissionLane(row.value, index);
          return (
            <div
              key={lane?.id ?? "overview"}
              className="review-config-thread-cell"
            >
              <span className="text-caption text-subtle">
                {lane?.name ?? "Overview"}
              </span>
              <div>
                {lane?.reviewers.map((pubkey) => (
                  <ReviewerIdentity
                    key={pubkey}
                    pubkey={pubkey}
                    choices={choices}
                  />
                ))}
              </div>
              {lane && (
                <span>
                  {reviewLabels[row.reviewStates?.[index] ?? "need_review"]}
                </span>
              )}
              {thread.id ? (
                <Button
                  size="sm"
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
            </div>
          );
        })}
      </div>
    );
  }

  function table(records: SavedSubmission[], deletable: boolean) {
    return (
      <section
        className="review-config-table-scroll"
        aria-label="Submitted PRs table"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The table scrollport must support keyboard horizontal scrolling.
        tabIndex={0}
      >
        <table className="review-config-table text-body-sm">
          <thead>
            <tr>
              <th scope="col">Pull request</th>
              {deletable && <th scope="col">Status</th>}
              <th scope="col">Review status</th>
              <th scope="col">Delivery</th>
              <th scope="col">Reviewers &amp; threads</th>
              {deletable && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {records.map((row) => (
              <tr key={row.artifactId}>
                <th scope="row">
                  <a href={prUrl(row.value)} target="_blank" rel="noreferrer">
                    {row.value.config.repository}#{row.value.pr}
                  </a>
                </th>
                {deletable && (
                  <td title={statuses[row.revision]?.error}>
                    {statuses[row.revision]?.value ?? "Loading…"}
                  </td>
                )}
                <td>
                  {row.value.triage?.state === "pending"
                    ? "Awaiting triage"
                    : row.value.triage?.state === "rejected"
                      ? "Rejected"
                      : reviewLabels[
                          overallReviewStatus(
                            row.value.threads.flatMap((_thread, index) =>
                              submissionLane(row.value, index)
                                ? [row.reviewStates?.[index] ?? "need_review"]
                                : [],
                            ),
                          )
                        ]}
                </td>
                <td>
                  {row.value.triage?.state === "rejected"
                    ? "Triage complete"
                    : deliveryThreads(row.value).every(
                          (thread) => thread.delivered,
                        )
                      ? "Requests delivered"
                      : "Delivery incomplete"}
                </td>
                <td>{threads(row)}</td>
                {deletable && (
                  <td>
                    <div className="review-config-actions">
                      <Button
                        size="sm"
                        disabled={
                          busy ||
                          listLoading ||
                          !writable ||
                          (!!row.value.triage &&
                            row.value.triage.state !== "admitted") ||
                          row.value.submitter !== session.viewer ||
                          !["Open", "Draft"].includes(
                            statuses[row.revision]?.value ?? "",
                          ) ||
                          !row.value.threads.every((thread) => thread.delivered)
                        }
                        aria-label={`Remind reviewers for ${row.value.config.repository}#${row.value.pr}`}
                        onClick={() => void remind(row)}
                      >
                        Remind
                      </Button>
                      <IconButton
                        icon={<TrashIcon />}
                        title="Delete submission"
                        size="sm"
                        disabled={
                          busy ||
                          listLoading ||
                          !writable ||
                          row.value.submitter !== session.viewer
                        }
                        onClick={(event) => {
                          deleteTrigger.current = event.currentTarget;
                          setDeleteError("");
                          setRemoving(row);
                        }}
                        aria-label={`Delete ${row.value.config.repository}#${row.value.pr}`}
                      />
                    </div>
                    {row.value.submitter !== session.viewer && (
                      <p className="text-caption text-subtle">
                        Only the submitter can remind or delete.
                      </p>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section className="review-config-form" aria-label="PR submissions">
      {mode === "submit" && (
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
          {pr && (
            <Button
              disabled={busy}
              onClick={() => {
                setPr("");
                setResult(undefined);
                setError("");
                setStatus("");
                input.current?.focus();
              }}
            >
              Clear
            </Button>
          )}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {status && (
        <p role="status">
          {result?.value.triage?.state === "rejected"
            ? `Rejected: ${result.value.triage.message}`
            : result?.value.triage?.state === "admitted" &&
                status.startsWith("Submitted — awaiting")
              ? "Admitted — review routing has started."
              : status}
        </p>
      )}
      {result && (
        <section className="review-config-form" aria-label="Submission result">
          <InlineHeader
            title={`${result.value.config.repository}#${result.value.pr}`}
          />
          {table([result], false)}
          {listError && (
            <p role="alert">
              {listError} Open Pull requests and Reload to refresh.
            </p>
          )}
        </section>
      )}
      {mode === "all" && (
        <section className="review-config-form" aria-label="All PRs">
          <div ref={listHeading} tabIndex={-1}>
            <InlineHeader
              title="Submitted pull requests"
              actions={
                <Button
                  disabled={busy || listLoading || !!removing}
                  onClick={() => {
                    setStatus("");
                    setError("");
                    setReload((value) => value + 1);
                  }}
                >
                  Reload
                </Button>
              }
            />
          </div>
          <LoadingRegion
            pending={listLoading}
            label="Loading submissions…"
            statusVisibility="screen-reader"
          >
            {!listLoading && !listError && !rows.length && (
              <p>
                {warning
                  ? "No readable submissions in this result."
                  : "No submissions in the list. Use Submit PR to start a review."}
              </p>
            )}
            {rows.length > 0 && table(rows, true)}
          </LoadingRegion>
          {listError && (
            <p role="alert">{listError} Use Reload to try again.</p>
          )}
          {Object.values(statuses).some(
            (status) => status.value === "Unavailable",
          ) && (
            <p role="alert">
              Some GitHub statuses could not be loaded. Remind is disabled for
              those PRs. Use Reload to try again.
            </p>
          )}
          {warning && <p role="alert">{warning}</p>}
        </section>
      )}
      {removing && (
        <AlertDialog
          title={`Delete ${removing.value.config.repository}#${removing.value.pr}?`}
          description="Remove this submission from the shared list. The GitHub PR and existing conversations stay available. This does not stop an active review. Submitting the same URL again starts a new review with new threads."
          pending={busy}
          finalFocus={() =>
            deleteTrigger.current?.isConnected
              ? deleteTrigger.current
              : listHeading.current
          }
          onClose={() => setRemoving(undefined)}
          actions={
            <>
              <Button disabled={busy} onClick={() => setRemoving(undefined)}>
                Cancel
              </Button>
              <Button
                variant="prominent"
                disabled={!writable}
                loading={busy}
                onClick={() => void remove()}
              >
                Delete submission
              </Button>
            </>
          }
        >
          {deleteError && <p role="alert">{deleteError}</p>}
        </AlertDialog>
      )}
    </section>
  );
}
