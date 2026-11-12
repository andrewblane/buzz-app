import { useEffect, useRef, useState } from "react";
import { useAgentChoices } from "../../features/agents/use-choices";
import type { RelaySession } from "../../features/relay/session";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Input } from "../../shared/design-system/ui/Input";
import { Select } from "../../shared/design-system/ui/Select";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import type { SavedReviewConfig } from "./configuration";
import {
  loadSubmissions,
  prUrl,
  submitReview,
  type SavedSubmission,
} from "./submissions";

export function ReviewSubmissions({
  session,
  channel,
  configurations,
  disabled,
  writable,
  onEditingChange,
  onOpenThread,
}: {
  session: RelaySession;
  channel: string;
  configurations: readonly SavedReviewConfig[];
  disabled: boolean;
  writable: boolean;
  onEditingChange: (editing: boolean) => void;
  onOpenThread?: ((channel: string, id: string) => Promise<void>) | undefined;
}) {
  const [rows, setRows] = useState<SavedSubmission[]>([]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [draft, setDraft] = useState<{
    config: SavedReviewConfig;
    existing?: SavedSubmission;
  }>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    onEditingChange(!!draft);
    if (!draft) trigger.current?.focus();
    return () => onEditingChange(false);
  }, [draft, onEditingChange]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload is an explicit fresh read.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadSubmissions(
      session,
      channel,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result.rows);
          setWarning(result.warning);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load submissions.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, channel, reload]);
  return (
    <section className="review-config-form" aria-label="PR submissions">
      <InlineHeader title="PR submissions" />
      <p>
        Submit a PR to start reviewer conversations using saved settings.
        Delivery does not confirm that a reviewer is running. Automatic
        reminders are off.
      </p>
      <div className="review-config-actions">
        <Button
          disabled={disabled || !!draft || loading}
          onClick={() => setReload((value) => value + 1)}
        >
          Reload submissions
        </Button>
        <Button
          variant="prominent"
          disabled={
            disabled ||
            loading ||
            !!draft ||
            !writable ||
            !configurations.length
          }
          onClick={(event) => {
            trigger.current = event.currentTarget;
            const first = configurations[0];
            if (first) setDraft({ config: first });
          }}
        >
          Submit PR
        </Button>
      </div>
      {loading && <p role="status">Loading submissions…</p>}
      {error && (
        <p role="alert">{error} Use Reload submissions to try again.</p>
      )}
      {warning && <p role="alert">{warning}</p>}
      {draft && (
        <SubmissionForm
          key={draft.existing?.artifactId ?? "new"}
          session={session}
          channel={channel}
          configurations={configurations}
          initial={draft.config}
          existing={draft.existing}
          writable={writable}
          onClose={() => setDraft(undefined)}
          onProgress={(record) =>
            setRows((current) => [
              record,
              ...current.filter((row) => row.artifactId !== record.artifactId),
            ])
          }
        />
      )}
      {!loading && !error && !rows.length && (
        <p>No PRs submitted in this channel.</p>
      )}
      {rows.map((row) => (
        <section
          key={row.artifactId}
          className="review-config-lane"
          aria-label={`${row.value.config.repository}#${row.value.pr}`}
        >
          <InlineHeader
            title={`${row.value.config.repository}#${row.value.pr}`}
          />
          <p>{prUrl(row.value)}</p>
          {row.value.threads.map((thread, index) => (
            <div
              key={
                index === 0
                  ? "overview"
                  : (row.value.config.lanes[index - 1]?.id ?? index)
              }
              className="review-config-actions"
            >
              <span>
                {index === 0
                  ? "Overview"
                  : row.value.config.lanes[index - 1]?.name}
                :{" "}
                {thread.delivered
                  ? "Request delivered"
                  : thread.id || thread.started
                    ? "Delivery unconfirmed"
                    : "Not sent"}
              </span>
              {thread.id && (
                <Button
                  disabled={!onOpenThread || !!draft || disabled}
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
                  Open{" "}
                  {index === 0
                    ? "overview"
                    : row.value.config.lanes[index - 1]?.name}{" "}
                  thread
                </Button>
              )}
            </div>
          ))}
          {!row.value.threads.every((thread) => thread.delivered) && (
            <div>
              <Button
                disabled={disabled || loading || !!draft || !writable}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setDraft({
                    config: {
                      config: row.value.config,
                      revision: row.value.configRevision,
                      artifactId: "",
                    },
                    existing: row,
                  });
                }}
              >
                Resume submission
              </Button>
            </div>
          )}
        </section>
      ))}
    </section>
  );
}

function SubmissionForm({
  session,
  channel,
  configurations,
  initial,
  existing,
  writable,
  onClose,
  onProgress,
}: {
  session: RelaySession;
  channel: string;
  configurations: readonly SavedReviewConfig[];
  initial: SavedReviewConfig;
  existing: SavedSubmission | undefined;
  writable: boolean;
  onClose: () => void;
  onProgress: (record: SavedSubmission) => void;
}) {
  const choices = useAgentChoices(session, true, true);
  const [config, setConfig] = useState(initial);
  const [pr, setPr] = useState(existing ? String(existing.value.pr) : "");
  const [reviewers, setReviewers] = useState(
    initial.config.lanes.map((lane) => lane.reviewers[0] ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(!!existing);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function submit() {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    let recorded = started;
    try {
      await submitReview(
        session,
        channel,
        config,
        pr,
        reviewers,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        (record) => {
          if (!controller.signal.aborted) {
            recorded = true;
            setStarted(true);
            setConfig({
              config: record.value.config,
              revision: record.value.configRevision,
              artifactId: config.artifactId,
            });
            setPr(String(record.value.pr));
            setReviewers(
              record.value.config.lanes.map((lane) => lane.reviewers[0] ?? ""),
            );
            onProgress(record);
          }
        },
        started,
      );
      if (!controller.signal.aborted) onClose();
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          `${reason instanceof Error ? reason.message : "Could not submit."} ${recorded ? "Saved messages are retained. Close and reload submissions to check progress; Resume retries the same messages." : "Your draft is still here."}`,
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      className="review-config-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <InlineHeader
        title={started ? "Resume saved submission" : "New PR submission"}
      />
      <SettingsGroup layout="form">
        <Select
          label="Repository to review"
          variant="field"
          value={config.config.repository}
          disabled={busy || started}
          groups={[
            {
              label: "Repositories",
              options: (existing ? [config] : configurations).map((row) => ({
                value: row.config.repository,
                label: row.config.repository,
              })),
            },
          ]}
          onValueChange={(repository) => {
            const row = configurations.find(
              (item) => item.config.repository === repository,
            );
            if (row) {
              setConfig(row);
              setReviewers(
                row.config.lanes.map((lane) => lane.reviewers[0] ?? ""),
              );
            }
          }}
        />
        <Field
          label="Pull request"
          description="PR number or full GitHub PR URL. The reviewer verifies the PR and current commit; Buzz does not fetch GitHub metadata here."
        >
          <Input
            autoFocus
            required
            maxLength={300}
            placeholder="https://github.com/example-org/project/pull/123"
            value={pr}
            disabled={busy || started}
            onValueChange={setPr}
          />
        </Field>
      </SettingsGroup>
      {config.config.lanes.map((lane, index) => (
        <section key={lane.id} className="review-config-lane">
          <Select
            variant="field"
            label={`${lane.name} reviewer`}
            value={reviewers[index] ?? ""}
            required
            disabled={busy || started}
            placeholder="Choose a reviewer"
            groups={[
              {
                label: "Configured reviewers",
                options: lane.reviewers.map((key) => {
                  const choice = choices.selectable.find(
                    (item) => item.pubkey === key,
                  );
                  return {
                    value: key,
                    label:
                      choice?.managedName ??
                      choice?.name ??
                      `Unavailable (${key.slice(0, 10)})`,
                    disabled: !choice,
                  };
                }),
              },
            ]}
            onValueChange={(value) =>
              setReviewers((current) =>
                current.map((item, i) => (i === index ? value : item)),
              )
            }
          />
          <details>
            <summary>Instructions for {lane.name}</summary>
            <p className="review-config-instructions">{lane.instructions}</p>
          </details>
        </section>
      ))}
      <p>
        This sends a request to one reviewer per lane in this channel. Reviewers
        must belong to your signed-in identity and already have channel access.
        Their model runner must be connected to reply.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Saving submission and delivering threads…</p>}
      <div className="review-config-actions">
        <Button disabled={busy} onClick={onClose}>
          {started ? "Close" : "Cancel"}
        </Button>
        <Button
          type="submit"
          variant="prominent"
          loading={busy}
          disabled={!writable || choices.pending}
        >
          {started ? "Resume delivery" : "Start review threads"}
        </Button>
      </div>
    </form>
  );
}
