import { createPullReader, pullFingerprint, type ReadPull } from "./pull-facts";
import { laneMatches, type PullFacts } from "./routing";
const publicPullReader = createPullReader();
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentChoices } from "../../features/agents/use-choices";
import type { RelaySession } from "../../features/relay/session";
import { Accordion } from "../../shared/design-system/ui/Accordion";
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
  submissionLane,
  pullRequest,
  type SavedSubmission,
} from "./submissions";

export function ReviewSubmissions({
  session,
  channel,
  configurations,
  initialPull = "",
  disabled,
  writable,
  onEditingChange,
  onOpenThread,
  readPull = publicPullReader,
}: {
  session: RelaySession;
  readPull?: ReadPull;
  channel: string;
  configurations: readonly SavedReviewConfig[];
  initialPull?: string;
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
  const [draft, setDraft] = useState<
    | {
        config: SavedReviewConfig;
        existing?: SavedSubmission;
      }
    | undefined
  >(() =>
    initialPull && configurations[0]
      ? { config: configurations[0] }
      : undefined,
  );
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
  const visibleRows = rows.filter((row) =>
    configurations.some(
      (config) => config.config.repository === row.value.config.repository,
    ),
  );
  return (
    <section className="review-config-form" aria-label="PR submissions">
      <div className="review-config-actions">
        <Button
          ref={trigger}
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
      {draft && (
        <SubmissionForm
          key={draft.existing?.artifactId ?? "new"}
          session={session}
          channel={channel}
          configurations={configurations}
          initial={draft.config}
          initialPull={initialPull}
          readPull={readPull}
          existing={draft.existing}
          writable={writable && !loading && !error}
          onClose={() => setDraft(undefined)}
          onProgress={(record) =>
            setRows((current) => [
              record,
              ...current.filter((row) => row.artifactId !== record.artifactId),
            ])
          }
        />
      )}
      <section className="review-config-form" aria-label="Existing PRs">
        <InlineHeader title="Existing PRs" />
        <div>
          <Button
            disabled={disabled || !!draft || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload submissions
          </Button>
        </div>
        {loading && <p role="status">Loading submissions…</p>}
        {error && (
          <p role="alert">{error} Use Reload submissions to try again.</p>
        )}
        {warning && <p role="alert">{warning}</p>}
        {!loading && !error && !visibleRows.length && (
          <p>No PRs submitted for this repository.</p>
        )}
        <Accordion
          variant="form"
          items={visibleRows.map((row) => ({
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
              <section
                className="review-config-lane"
                aria-label={`${row.value.config.repository}#${row.value.pr}`}
              >
                <p>{prUrl(row.value)}</p>
                {row.value.threads.map((thread, index) => (
                  <div
                    key={submissionLane(row.value, index)?.id ?? "overview"}
                    className="review-config-actions"
                  >
                    <span>
                      {submissionLane(row.value, index)?.name ??
                        "Overview (earlier submission)"}
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
                            if (thread.id)
                              await onOpenThread?.(channel, thread.id);
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
                        {submissionLane(row.value, index)?.name ?? "overview"}{" "}
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
            ),
          }))}
        />
      </section>
    </section>
  );
}

function SubmissionForm({
  session,
  channel,
  configurations,
  initial,
  initialPull,
  existing,
  writable,
  onClose,
  onProgress,
  readPull,
}: {
  session: RelaySession;
  readPull: ReadPull;
  channel: string;
  configurations: readonly SavedReviewConfig[];
  initial: SavedReviewConfig;
  initialPull: string;
  existing: SavedSubmission | undefined;
  writable: boolean;
  onClose: () => void;
  onProgress: (record: SavedSubmission) => void;
}) {
  const choices = useAgentChoices(session, true, true);
  const [config, setConfig] = useState(initial);
  const [pr, setPr] = useState(
    existing ? String(existing.value.pr) : initialPull,
  );
  const [reviewers, setReviewers] = useState(
    initial.config.lanes.map((lane) => lane.reviewers[0] ?? ""),
  );
  const [facts, setFacts] = useState<PullFacts>();
  const matched = useMemo(
    () =>
      config.config.lanes.map(
        (lane) => !!facts && laneMatches(lane.routing, facts),
      ),
    [config.config.lanes, facts],
  );
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(!!existing);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function preview() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setReading(true);
    setFacts(undefined);
    setError("");
    try {
      const next = await readPull(
        config.config.repository,
        pullRequest(pr, config.config.repository),
        AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      );
      if (!controller.signal.aborted) setFacts(next);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Could not load PR.",
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setReading(false);
    }
  }
  async function submit() {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    let recorded = started;
    try {
      if (!started) {
        if (!facts)
          throw new Error("Load PR details to preview matching lanes first.");
        const current = await readPull(
          config.config.repository,
          pullRequest(pr, config.config.repository),
          AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        );
        if (pullFingerprint(current) !== pullFingerprint(facts)) {
          setFacts(current);
          throw new Error(
            "The PR changed. Review the updated matching lanes before starting threads.",
          );
        }
      }
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
        facts,
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
        {configurations.length > 1 && (
          <Select
            label="Repository to review"
            variant="field"
            value={config.config.repository}
            disabled={busy || reading || started}
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
                setFacts(undefined);
                setConfig(row);
                setReviewers(
                  row.config.lanes.map((lane) => lane.reviewers[0] ?? ""),
                );
              }
            }}
          />
        )}
        <Field
          label="Pull request"
          description="Enter a PR number or full GitHub PR URL, then load its details to preview matching lanes."
        >
          <Input
            autoFocus
            required
            maxLength={300}
            placeholder="https://github.com/example-org/project/pull/123"
            value={pr}
            disabled={busy || reading || started}
            onValueChange={(value) => {
              setPr(value);
              setFacts(undefined);
            }}
          />
        </Field>
      </SettingsGroup>
      {!started && (
        <div className="review-config-form">
          <div>
            <Button
              disabled={busy || reading || !pr.trim()}
              loading={reading}
              onClick={() => void preview()}
            >
              Load PR details
            </Button>
          </div>
          {facts && (
            <>
              <p>
                {facts.title} · {facts.changedFiles} changed files · Labels:{" "}
                {facts.labels.join(", ") || "none"}
              </p>
              <p>
                Matching lanes:{" "}
                {config.config.lanes
                  .filter((_, index) => matched[index])
                  .map((lane) => lane.name)
                  .join(", ") ||
                  "None. Adjust the lane rules before submitting."}
              </p>
              <p>
                Other lanes:{" "}
                {config.config.lanes
                  .filter((_, index) => !matched[index])
                  .map((lane) => lane.name)
                  .join(", ") || "none"}
              </p>
            </>
          )}
        </div>
      )}
      {config.config.lanes.map((lane, index) =>
        !started && !matched[index] ? null : (
          <section key={lane.id} className="review-config-lane">
            <Select
              variant="field"
              label={`${lane.name} reviewer`}
              value={reviewers[index] ?? ""}
              required
              disabled={busy || reading || started}
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
        ),
      )}
      <p>
        This sends a request to one reviewer per matching lane in this channel,
        with no extra overview thread. Reviewers must belong to your signed-in
        identity and already have channel access. Their model runner must be
        connected to reply.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Saving submission and delivering threads…</p>}
      <div className="review-config-actions">
        <Button disabled={busy || reading} onClick={onClose}>
          {started ? "Close" : "Cancel"}
        </Button>
        <Button
          type="submit"
          variant="prominent"
          loading={busy}
          disabled={
            !writable ||
            choices.pending ||
            reading ||
            (!started && (!facts || !matched.some(Boolean)))
          }
        >
          {started ? "Resume delivery" : "Start review threads"}
        </Button>
      </div>
    </form>
  );
}
