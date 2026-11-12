import { createPullReader, type ReadPull } from "./pull-facts";
const publicPullReader = createPullReader();
import { LaneRules, ruleDescription } from "./LaneRules";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAgentChoices } from "../../features/agents/use-choices";
import { ReviewSubmissions } from "./ReviewSubmissions";
import { pullRepository } from "./submissions";
import type { Navigation } from "../../features/navigation/controller";
import { splitPartition } from "../../features/relay/partition";
import { LaneReviewers, ReviewerIdentity } from "./LaneReviewers";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import {
  ArrowLeftIcon,
  ListChecksIcon,
} from "../../shared/design-system/icons";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Input } from "../../shared/design-system/ui/Input";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { Select } from "../../shared/design-system/ui/Select";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  loadConfigurations,
  repositoryName,
  saveConfiguration,
  type ReviewConfig,
  type ReviewLane,
  type SavedReviewConfig,
} from "./configuration";
import "./review-configuration.css";

function Frame({ children }: { children: ReactNode }) {
  return (
    <FullPageSurface aria-label="Review Configuration">
      <div className="review-config-page text-body">
        <PanelHeader
          title={
            <PanelHeaderLabel
              title="Review Configuration"
              icon={<ListChecksIcon />}
            />
          }
        />
        <div className="review-config-scroll">
          <div className="review-config-content">{children}</div>
        </div>
      </div>
    </FullPageSurface>
  );
}

export function ReviewConfigurationPage({
  relay,
  navigator,
  readPull = publicPullReader,
}: {
  relay: RelayData;
  navigator?: Navigation;
  readPull?: ReadPull;
}) {
  const connection = useRelayConnection(relay);
  if (connection.status === "ready")
    return (
      <ReviewConfigurationCommunity
        key={`${connection.scope}:${connection.generation}`}
        session={connection.session}
        readPull={readPull}
        onOpenThread={async (channelId, id) => {
          const scope = splitPartition(connection.scope ?? "");
          if (!navigator || !scope)
            throw new Error("Thread navigation is unavailable.");
          const result = await navigator.open({
            version: 1,
            kind: "conversation",
            scope,
            channelId,
            messageId: id,
            threadRootId: id,
          });
          if (result.status === "failed")
            throw new Error("Could not open the review thread.");
        }}
      />
    );
  return (
    <Frame>
      <p>
        {connection.status === "connecting"
          ? "Connecting to your community…"
          : "Connect to a community to configure reviews."}
      </p>
      {connection.status === "error" && (
        <>
          <p role="alert">{connection.error}</p>
          <Button onClick={() => relay.retry()}>Retry connection</Button>
        </>
      )}
    </Frame>
  );
}

export function ReviewConfigurationCommunity({
  session,
  onOpenThread,
  readPull = publicPullReader,
}: {
  session: RelaySession;
  readPull?: ReadPull;
  onOpenThread?: ((channel: string, id: string) => Promise<void>) | undefined;
}) {
  const list = useChannelList(session.channels);
  const selectionKey = `buzz.review.channel:${session.scope}`;
  const [channel, setChannel] = useState(() => {
    try {
      return localStorage.getItem(selectionKey) ?? "";
    } catch {
      return "";
    }
  });
  const [editing, setEditing] = useState(false);
  const channels = list.channels.filter(
    (item) =>
      !item.metadataPending &&
      !item.huddle &&
      !item.archived &&
      !item.pending &&
      (item.channelType === "stream" || item.channelType === "forum"),
  );
  useEffect(() => {
    if (list.status !== "ready" || list.coverage === "partial" || editing)
      return;
    if (list.channels.some((item) => item.metadataPending)) return;
    if (channel && channels.some((item) => item.id === channel)) return;
    setChannel(channels.length === 1 ? (channels[0]?.id ?? "") : "");
  }, [list.status, list.coverage, list.channels, channels, channel, editing]);
  useEffect(() => {
    try {
      if (channel) localStorage.setItem(selectionKey, channel);
      else localStorage.removeItem(selectionKey);
    } catch {
      /* Storage may be unavailable; selection still works for this visit. */
    }
  }, [selectionKey, channel]);
  const selected = channels.find((item) => item.id === channel);
  const writable =
    !!selected &&
    !selected.metadataCached &&
    !selected.cached &&
    !selected.readOnly &&
    !!session.configArtifactWriter;
  return (
    <Frame>
      <Select
        label="Review channel"
        variant="field"
        value={channel}
        onValueChange={setChannel}
        disabled={editing}
        placeholder="Choose a channel"
        groups={[
          {
            label: "Channels",
            options: channels.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          },
        ]}
        description="Repositories and reviews are shared with this channel."
      />
      {list.status === "loading" && <p role="status">Loading channels…</p>}
      {list.status === "error" && (
        <p role="alert">Could not load channels. Reconnect to try again.</p>
      )}
      {channel && !writable && (
        <p role="alert">
          Saving is unavailable until channel access is confirmed. Your open
          draft is preserved.
        </p>
      )}
      {channel && (
        <ChannelConfiguration
          key={channel}
          session={session}
          channel={channel}
          writable={writable}
          onEditingChange={setEditing}
          onOpenThread={onOpenThread}
          readPull={readPull}
        />
      )}
    </Frame>
  );
}

function ChannelConfiguration({
  session,
  channel,
  writable,
  onEditingChange,
  onOpenThread,
  readPull,
}: {
  session: RelaySession;
  readPull: ReadPull;
  channel: string;
  writable: boolean;
  onEditingChange: (editing: boolean) => void;
  onOpenThread?: ((channel: string, id: string) => Promise<void>) | undefined;
}) {
  const choices = useAgentChoices(session, true, true);
  const [laneId, setLaneId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [lookup, setLookup] = useState(false);
  const [pullUrl, setPullUrl] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [initialPull, setInitialPull] = useState("");
  const submissionEditing = useCallback((editing: boolean) => {
    setSubmitting(editing);
    if (!editing) setInitialPull("");
  }, []);
  const [rows, setRows] = useState<SavedReviewConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<SavedReviewConfig | "new">();
  const [repository, setRepository] = useState("");
  const [section, setSection] = useState<"configuration" | "pulls">(
    "configuration",
  );
  const selected = rows.find((row) => row.config.repository === repository);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const lanesRegion = useRef<HTMLElement | null>(null);
  useEffect(() => {
    onEditingChange(editor !== undefined || submitting || lookup);
    if (editor === undefined) {
      const trigger = editorTrigger.current;
      if (trigger?.isConnected && !trigger.matches(":disabled"))
        trigger.focus();
      else lanesRegion.current?.focus();
    }
    return () => onEditingChange(false);
  }, [editor, submitting, lookup, onEditingChange]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload explicitly requests a fresh snapshot.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadConfigurations(
      session,
      channel,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((next) => {
        if (!controller.signal.aborted) {
          setRows(next.rows);
          setRemaining(
            next.truncated ? 0 : 100 - next.rows.length - next.unreadable,
          );
          setWarning(
            [
              next.unreadable
                ? `${next.unreadable} saved configuration(s) could not be read. They may use a newer format or contain invalid data; other repositories remain editable.`
                : "",
              next.truncated
                ? "Showing the first 100 configurations. Use another review channel for additional repositories."
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load configurations.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, channel, reload]);
  function saved(next: SavedReviewConfig) {
    if (editor === "new") setRemaining((value) => value - 1);
    setRows((current) =>
      [
        ...current.filter((row) => row.artifactId !== next.artifactId),
        next,
      ].sort((a, b) => a.config.repository.localeCompare(b.config.repository)),
    );
    setRepository(next.config.repository);
    setEditor(undefined);
    setNotice(`Saved ${next.config.repository}.`);
  }
  return (
    <>
      {!selected && editor !== "new" ? (
        <>
          <InlineHeader title="Repositories" />
          <div className="review-config-actions">
            <Button
              disabled={loading || lookup}
              onClick={() => setReload((value) => value + 1)}
            >
              Reload
            </Button>
            <Button
              ref={editorTrigger}
              variant="prominent"
              disabled={
                loading || lookup || !!error || !writable || remaining <= 0
              }
              onClick={(event) => {
                editorTrigger.current = event.currentTarget;
                setNotice("");
                setEditor("new");
              }}
            >
              Register repository
            </Button>
            <Button
              disabled={
                loading || lookup || !!error || !writable || !rows.length
              }
              onClick={() => {
                setLookup(true);
                setLookupError("");
              }}
            >
              Submit PR
            </Button>
          </div>
          {lookup && (
            <form
              className="review-config-form"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  const name = pullRepository(pullUrl);
                  const match = rows.find(
                    (row) => row.config.repository === name,
                  );
                  if (!match)
                    throw new Error(
                      `${name} is not configured in this channel. Register it before submitting.`,
                    );
                  setRepository(name);
                  setSection("pulls");
                  setInitialPull(pullUrl.trim());
                  setLookup(false);
                } catch (reason) {
                  setLookupError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not find repository.",
                  );
                }
              }}
            >
              <Field
                label="GitHub PR URL"
                description="We’ll find its configured repository and match its lane rules."
              >
                <Input
                  autoFocus
                  required
                  maxLength={300}
                  value={pullUrl}
                  onValueChange={setPullUrl}
                  placeholder="https://github.com/example-org/project/pull/123"
                />
              </Field>
              {lookupError && <p role="alert">{lookupError}</p>}
              <div className="review-config-actions">
                <Button onClick={() => setLookup(false)}>Cancel</Button>
                <Button type="submit" variant="prominent">
                  Continue
                </Button>
              </div>
            </form>
          )}
          {loading ? (
            <p role="status">Loading configurations…</p>
          ) : error ? (
            <p role="alert">{error} Use Reload to try again.</p>
          ) : rows.length ? (
            <div className="review-config-repositories">
              {rows.map((row) => (
                <NavigationItem
                  key={row.artifactId}
                  aria-label={`Open ${row.config.repository}`}
                  multiline
                  disabled={lookup}
                  label={
                    <span className="review-config-repository-label">
                      <span>{row.config.repository}</span>
                      <span className="text-caption text-subtle">
                        {row.config.lanes.map((lane) => lane.name).join(" · ")}
                      </span>
                    </span>
                  }
                  trailing="Open"
                  onClick={() => {
                    setRepository(row.config.repository);
                    setSection("configuration");
                    setNotice("");
                  }}
                />
              ))}
            </div>
          ) : (
            <p>
              {warning
                ? "No readable configurations in this channel."
                : "No repositories configured in this channel. Register one to save its review lanes."}
            </p>
          )}
          {warning && <p role="alert">{warning}</p>}
        </>
      ) : (
        <>
          {!editor && (
            <div>
              <Button
                disabled={submitting}
                onClick={() => {
                  setRepository("");
                  setNotice("");
                }}
              >
                <ArrowLeftIcon /> Back to repositories
              </Button>
            </div>
          )}
          {selected && (
            <>
              <InlineHeader title={selected.config.repository} />
              <Tabs
                variant="panel"
                label="Repository sections"
                value={section}
                items={[
                  {
                    value: "configuration",
                    label: "Configuration",
                    disabled: !!editor || submitting,
                  },
                  {
                    value: "pulls",
                    label: "Pull requests",
                    disabled: !!editor || submitting,
                  },
                ]}
                onValueChange={setSection}
                renderPanel={(tab) =>
                  tab === "configuration" ? (
                    <section
                      className="review-config-form"
                      aria-label="Repository configuration"
                      ref={lanesRegion}
                      tabIndex={-1}
                    >
                      {editor ? (
                        <ConfigurationEditor
                          key={editor === "new" ? "new" : editor.revision}
                          session={session}
                          channel={channel}
                          writable={writable}
                          previous={editor === "new" ? undefined : editor}
                          laneId={laneId}
                          existing={rows}
                          onCancel={() => setEditor(undefined)}
                          onSaved={saved}
                        />
                      ) : (
                        <>
                          <InlineHeader
                            title="Lanes"
                            subtitle="Each lane has its own agents, instructions, and routing rules."
                            actions={
                              <Button
                                disabled={loading}
                                onClick={() => {
                                  setNotice("");
                                  setReload((value) => value + 1);
                                }}
                              >
                                Reload
                              </Button>
                            }
                          />
                          {error && <p role="alert">{error}</p>}
                          <SettingsGroup layout="cards">
                            {selected.config.lanes.map((lane) => (
                              <section
                                key={lane.id}
                                aria-label={`${lane.name} lane`}
                                className="review-config-lane-card"
                              >
                                <InlineHeader
                                  title={lane.name}
                                  actions={
                                    <Button
                                      ref={(node) => {
                                        if (laneId === lane.id)
                                          editorTrigger.current = node;
                                      }}
                                      disabled={!writable || loading || !!error}
                                      aria-label={`Edit ${lane.name} lane`}
                                      onClick={() => {
                                        setLaneId(lane.id);
                                        setNotice("");
                                        setEditor(selected);
                                      }}
                                    >
                                      Edit lane
                                    </Button>
                                  }
                                />
                                <div className="review-config-reviewers">
                                  <span className="text-caption text-subtle">
                                    Agents
                                  </span>
                                  {lane.reviewers.length ? (
                                    lane.reviewers.map((pubkey) => (
                                      <ReviewerIdentity
                                        key={pubkey}
                                        pubkey={pubkey}
                                        choices={choices}
                                      />
                                    ))
                                  ) : (
                                    <p>No agents assigned.</p>
                                  )}
                                </div>
                                <div className="review-config-summary-section">
                                  <span className="text-caption text-subtle">
                                    Routing rules ·{" "}
                                    {lane.routing?.mode === "any"
                                      ? "Match any"
                                      : "Match all"}
                                  </span>
                                  {lane.routing?.rules.length ? (
                                    <ul>
                                      {lane.routing.rules.map((rule) => (
                                        <li key={rule.id}>
                                          {ruleDescription(rule)}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>
                                      All PRs · Add a routing rule when editing
                                      this lane.
                                    </p>
                                  )}
                                </div>
                                <div className="review-config-summary-section">
                                  <span className="text-caption text-subtle">
                                    Instructions
                                  </span>
                                  <p className="review-config-instructions">
                                    {lane.instructions}
                                  </p>
                                </div>
                              </section>
                            ))}
                          </SettingsGroup>
                          <div>
                            <Button
                              ref={(node) => {
                                if (!laneId) editorTrigger.current = node;
                              }}
                              variant="prominent"
                              disabled={
                                !writable ||
                                loading ||
                                !!error ||
                                selected.config.lanes.length >= 12
                              }
                              onClick={() => {
                                setLaneId(undefined);
                                setNotice("");
                                setEditor(selected);
                              }}
                            >
                              Add lane
                            </Button>
                          </div>
                        </>
                      )}
                    </section>
                  ) : (
                    <ReviewSubmissions
                      session={session}
                      channel={channel}
                      configurations={[selected]}
                      initialPull={initialPull}
                      disabled={loading || !!error}
                      writable={writable}
                      onEditingChange={submissionEditing}
                      onOpenThread={onOpenThread}
                      readPull={readPull}
                    />
                  )
                }
              />
            </>
          )}
          {editor === "new" && (
            <ConfigurationEditor
              session={session}
              channel={channel}
              writable={writable}
              previous={undefined}
              existing={rows}
              onCancel={() => setEditor(undefined)}
              onSaved={saved}
            />
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}

function ConfigurationEditor({
  session,
  channel,
  writable,
  previous,
  laneId,
  existing,
  onCancel,
  onSaved,
}: {
  session: RelaySession;
  channel: string;
  writable: boolean;
  previous: SavedReviewConfig | undefined;
  laneId?: string | undefined;
  existing: readonly SavedReviewConfig[];
  onCancel: () => void;
  onSaved: (saved: SavedReviewConfig) => void;
}) {
  const choices = useAgentChoices(session, true, true);
  const [refreshingAgents, setRefreshingAgents] = useState(false);
  const [agentRefreshError, setAgentRefreshError] = useState("");
  const original = previous?.config.lanes.find((lane) => lane.id === laneId);
  const [repository, setRepository] = useState(
    previous?.config.repository ?? "",
  );
  const [lane, setLane] = useState<ReviewLane>(() => ({
    ...(original ?? {
      id: crypto.randomUUID(),
      name: previous ? "" : "General",
      instructions: "",
      reviewers: [],
    }),
    routing: original?.routing?.rules.length
      ? original.routing
      : {
          mode: "all",
          rules: [
            {
              id: crypto.randomUUID(),
              field: "title",
              operator: "contains",
              value: "",
            },
          ],
        },
  }));
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const editorRegion = useRef<HTMLFormElement>(null);
  useEffect(() => {
    editorRegion.current?.focus();
  }, []);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function save(remove = false) {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      if (
        !previous &&
        existing.some(
          (row) => row.config.repository === repositoryName(repository),
        )
      )
        throw new Error(
          "This repository is already configured in this channel. Cancel and edit its saved settings.",
        );
      if (!remove && !lane.routing?.rules.length)
        throw new Error(
          "Add at least one routing rule before saving this lane.",
        );
      const lanes = previous?.config.lanes ?? [];
      const draft: ReviewConfig = {
        version: 1,
        reminderMinutes: 15,
        repository,
        lanes: remove
          ? lanes.filter((item) => item.id !== lane.id)
          : original
            ? lanes.map((item) => (item.id === lane.id ? lane : item))
            : [...lanes, lane],
      };
      const result = await saveConfiguration(
        session,
        channel,
        draft,
        previous,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) onSaved(result);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          `${reason instanceof Error ? reason.message : "Could not save lane."} Your draft is still here. If settings changed elsewhere or the save timed out, copy your changes, then Cancel and Reload before retrying.`,
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      ref={editorRegion}
      tabIndex={-1}
      aria-label="Edit lane"
      noValidate
      className="review-config-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <Button disabled={busy} onClick={onCancel}>
          <ArrowLeftIcon />{" "}
          {previous ? "Back to lanes" : "Back to repositories"}
        </Button>
      </div>
      <InlineHeader
        title={
          original
            ? `Edit ${original.name}`
            : previous
              ? "Add lane"
              : "Register repository"
        }
        subtitle="Save this lane before adding another."
      />
      {!previous && (
        <SettingsGroup layout="form">
          <Field
            label="GitHub repository"
            description="Use owner/repository or the full repository URL."
          >
            <Input
              required
              value={repository}
              disabled={busy}
              maxLength={250}
              placeholder="example-org/project"
              onValueChange={setRepository}
            />
          </Field>
        </SettingsGroup>
      )}
      <SettingsGroup layout="form">
        <Field label="Lane name">
          <Input
            required
            maxLength={80}
            disabled={busy}
            value={lane.name}
            onValueChange={(name) => setLane({ ...lane, name })}
          />
        </Field>
        <LaneReviewers
          lane={1}
          reviewers={lane.reviewers}
          choices={choices}
          disabled={busy}
          onChange={(reviewers) => setLane({ ...lane, reviewers })}
        />
        {choices.pending && <p role="status">Loading reviewer agents…</p>}
        {!choices.pending && !choices.selectable.length && (
          <p>
            No reviewer agents are available. Create or connect an agent, then
            refresh.
          </p>
        )}
        {choices.error && (
          <p role="alert">Some agents could not be loaded: {choices.error}</p>
        )}
        {choices.archives.error && (
          <p role="alert">
            Archived agents could not be checked: {choices.archives.error}
          </p>
        )}
        {agentRefreshError && <p role="alert">{agentRefreshError}</p>}
        <div>
          <Button
            disabled={busy || refreshingAgents}
            loading={refreshingAgents}
            onClick={async () => {
              setRefreshingAgents(true);
              setAgentRefreshError("");
              try {
                await session.agentChoices.refresh(true);
              } catch (reason) {
                setAgentRefreshError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not refresh agents.",
                );
              } finally {
                setRefreshingAgents(false);
              }
            }}
          >
            Refresh agents
          </Button>
        </div>
        <Field
          label="Instructions"
          description="What should the agents review in this lane?"
        >
          <Textarea
            required
            rows={3}
            maxLength={8000}
            disabled={busy}
            value={lane.instructions}
            onChange={(event) =>
              setLane({ ...lane, instructions: event.target.value })
            }
          />
        </Field>
        <section className="review-config-form" aria-label="Lane routing rules">
          <LaneRules
            lane={1}
            value={lane.routing}
            disabled={busy}
            onChange={(routing) => setLane({ ...lane, routing })}
          />
        </section>
      </SettingsGroup>
      {error && <p role="alert">{error}</p>}
      {removing ? (
        <div className="review-config-form">
          <p>
            Remove {original?.name} and its routing rules? Existing review
            threads are kept.
          </p>
          <div className="review-config-actions">
            <Button disabled={busy} onClick={() => setRemoving(false)}>
              Keep lane
            </Button>
            <Button
              disabled={busy || !writable}
              onClick={() => void save(true)}
            >
              Confirm remove lane
            </Button>
          </div>
        </div>
      ) : (
        <div className="review-config-actions">
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="prominent"
            loading={busy}
            disabled={!writable}
          >
            Save lane
          </Button>
          {original && previous && previous.config.lanes.length > 1 && (
            <Button
              disabled={busy || !writable}
              onClick={() => setRemoving(true)}
            >
              Remove lane
            </Button>
          )}
        </div>
      )}
      <div>
        <Button disabled>Add lane</Button>
        <p className="text-caption text-subtle">
          Save or cancel this lane first.
        </p>
      </div>
    </form>
  );
}
