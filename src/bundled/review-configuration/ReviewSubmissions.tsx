import { useEffect, useRef, useState } from "react";
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
import { createPullReader, type ReadPull } from "./pull-facts";
import {
  loadSubmissions,
  deleteSubmission,
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
  mode = "submit",
  channel,
  writable,
  onEditingChange,
  onOpenThread,
  readPull = publicPullReader,
}: {
  session: RelaySession;
  mode?: "submit" | "all";
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload is an explicit fresh read.
  useEffect(() => {
    if (mode !== "all") return;
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
        setRows(next.rows);
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
  }, [session, channel, reload, mode]);

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

  async function remove() {
    if (!removing || operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setDeleteError("");
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
                <td>
                  {row.value.threads.every((thread) => thread.delivered)
                    ? "Requests delivered"
                    : "Delivery incomplete"}
                </td>
                <td>{threads(row)}</td>
                {deletable && (
                  <td>
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
                    {row.value.submitter !== session.viewer && (
                      <p className="text-caption text-subtle">
                        Only the submitter can delete.
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
      {status && <p role="status">{status}</p>}
      {result && (
        <section className="review-config-form" aria-label="Submission result">
          <InlineHeader
            title={`${result.value.config.repository}#${result.value.pr}`}
          />
          {table([result], false)}
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
          {warning && <p role="alert">{warning}</p>}
        </section>
      )}
      {removing && (
        <AlertDialog
          title={`Delete ${removing.value.config.repository}#${removing.value.pr}?`}
          description="Remove this submission from the shared list. The GitHub PR and existing conversations stay available. This does not stop an active review. Submitting the same URL again restores its saved reviewers and threads."
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
