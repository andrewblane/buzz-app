import { createPullReader, type ReadPull } from "./pull-facts";
const publicPullReader = createPullReader();
import { LaneRules } from "./LaneRules";
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
import { LaneReviewers } from "./LaneReviewers";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { ListChecksIcon } from "../../shared/design-system/icons";
import { Accordion } from "../../shared/design-system/ui/Accordion";
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
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    onEditingChange(editor !== undefined || submitting || lookup);
    if (editor === undefined) editorTrigger.current?.focus();
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
          <div>
            <Button
              disabled={!!editor || submitting}
              onClick={() => {
                setRepository("");
                setNotice("");
              }}
            >
              All repositories
            </Button>
          </div>
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
                    >
                      {editor ? (
                        <ConfigurationEditor
                          key={editor === "new" ? "new" : editor.revision}
                          session={session}
                          channel={channel}
                          writable={writable}
                          previous={editor === "new" ? undefined : editor}
                          existing={rows}
                          onCancel={() => setEditor(undefined)}
                          onSaved={saved}
                        />
                      ) : (
                        <>
                          <div className="review-config-actions">
                            <Button
                              ref={editorTrigger}
                              variant="prominent"
                              disabled={!writable || loading || !!error}
                              aria-label={`Edit ${selected.config.repository}`}
                              onClick={(event) => {
                                editorTrigger.current = event.currentTarget;
                                setNotice("");
                                setEditor(selected);
                              }}
                            >
                              Edit configuration
                            </Button>
                            <Button
                              disabled={loading}
                              onClick={() => {
                                setNotice("");
                                setReload((value) => value + 1);
                              }}
                            >
                              Reload
                            </Button>
                          </div>
                          {error && <p role="alert">{error}</p>}
                          <Accordion
                            variant="form"
                            items={selected.config.lanes.map((lane) => ({
                              value: lane.id,
                              title: (
                                <span className="review-config-pr-summary">
                                  <span>{lane.name}</span>
                                  <span className="text-caption text-subtle">
                                    {lane.reviewers.length}{" "}
                                    {lane.reviewers.length === 1
                                      ? "reviewer"
                                      : "reviewers"}{" "}
                                    ·{" "}
                                    {lane.routing?.rules.length
                                      ? `${lane.routing.rules.length} routing rules`
                                      : "All PRs"}
                                  </span>
                                </span>
                              ),
                              content: (
                                <p className="review-config-instructions">
                                  {lane.instructions}
                                </p>
                              ),
                            }))}
                          />
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
  existing,
  onCancel,
  onSaved,
}: {
  session: RelaySession;
  channel: string;
  writable: boolean;
  previous: SavedReviewConfig | undefined;
  existing: readonly SavedReviewConfig[];
  onCancel: () => void;
  onSaved: (saved: SavedReviewConfig) => void;
}) {
  const choices = useAgentChoices(session, true, true);
  const [refreshingAgents, setRefreshingAgents] = useState(false);
  const [agentRefreshError, setAgentRefreshError] = useState("");
  const [draft, setDraft] = useState<ReviewConfig>(
    () =>
      previous?.config ?? {
        version: 1,
        repository: "",
        reminderMinutes: 15,
        lanes: [
          {
            id: crypto.randomUUID(),
            name: "General",
            instructions: "",
            reviewers: [],
          },
        ],
      },
  );
  const editorRegion = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (previous) editorRegion.current?.focus();
  }, [previous]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function save() {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      if (
        !previous &&
        existing.some(
          (row) => row.config.repository === repositoryName(draft.repository),
        )
      )
        throw new Error(
          "This repository is already configured in this channel. Cancel and edit its saved settings.",
        );
      const result = await saveConfiguration(
        session,
        channel,
        draft,
        previous,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) onSaved(result);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setExpanded(draft.lanes.map((lane) => lane.id));
        setError(
          `${reason instanceof Error ? reason.message : "Could not save settings."} Your draft is still here. If settings changed elsewhere or the save timed out, copy your changes, then Cancel and Reload before retrying.`,
        );
      }
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      ref={editorRegion}
      tabIndex={-1}
      aria-label="Edit repository settings"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="review-config-form"
    >
      {!previous && <InlineHeader title="Register repository" />}
      {!previous && (
        <SettingsGroup layout="form">
          <Field
            label="GitHub repository"
            description="Use owner/repository or the full repository URL."
          >
            <Input
              autoFocus
              required
              value={draft.repository}
              readOnly={!!previous}
              disabled={busy}
              maxLength={250}
              placeholder="example-org/project"
              onValueChange={(repository) => setDraft({ ...draft, repository })}
            />
          </Field>
        </SettingsGroup>
      )}
      {choices.pending && <p role="status">Loading reviewer agents…</p>}
      {!choices.pending && !choices.selectable.length && (
        <p>
          No reviewer agents are available in this session. Create or connect an
          agent in Agents, then refresh this list.
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
      <Accordion
        variant="form"
        keepMounted
        value={expanded}
        onValueChange={setExpanded}
        items={draft.lanes.map((lane, index) => ({
          value: lane.id,
          title: (
            <span className="review-config-pr-summary">
              <span>{lane.name || `Lane ${index + 1}`}</span>
              <span className="text-caption text-subtle">
                {lane.reviewers.length}{" "}
                {lane.reviewers.length === 1 ? "reviewer" : "reviewers"} ·{" "}
                {lane.routing?.rules.length
                  ? `${lane.routing.rules.length} rules`
                  : "All PRs"}
              </span>
            </span>
          ),
          content: (
            <section className="review-config-lane">
              <div className="review-config-actions">
                <Button
                  disabled={busy || draft.lanes.length === 1}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      lanes: draft.lanes.filter((item) => item.id !== lane.id),
                    })
                  }
                >
                  Remove lane {index + 1}
                </Button>
              </div>
              <SettingsGroup layout="form">
                <Field label={`Lane ${index + 1} name`}>
                  <Input
                    required
                    maxLength={80}
                    disabled={busy}
                    value={lane.name}
                    onValueChange={(name) =>
                      setDraft({
                        ...draft,
                        lanes: draft.lanes.map((item) =>
                          item.id === lane.id ? { ...item, name } : item,
                        ),
                      })
                    }
                  />
                </Field>
                <LaneReviewers
                  lane={index + 1}
                  reviewers={lane.reviewers}
                  choices={choices}
                  disabled={busy}
                  onChange={(reviewers) =>
                    setDraft({
                      ...draft,
                      lanes: draft.lanes.map((item) =>
                        item.id === lane.id ? { ...item, reviewers } : item,
                      ),
                    })
                  }
                />
                <Field
                  label={`Lane ${index + 1} instructions`}
                  description="Save the instructions reviewers should receive for this lane."
                >
                  <Textarea
                    required
                    rows={3}
                    maxLength={8000}
                    disabled={busy}
                    value={lane.instructions}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        lanes: draft.lanes.map((item) =>
                          item.id === lane.id
                            ? { ...item, instructions: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </Field>
              </SettingsGroup>
              <Accordion
                variant="form"
                keepMounted
                items={[
                  {
                    value: "routing",
                    title: `Routing rules (${lane.routing?.rules.length ?? 0})`,
                    content: (
                      <div className="review-config-form">
                        {" "}
                        <LaneRules
                          lane={index + 1}
                          value={lane.routing}
                          disabled={busy}
                          onChange={(routing) =>
                            setDraft({
                              ...draft,
                              lanes: draft.lanes.map((item) =>
                                item.id === lane.id
                                  ? { ...item, routing }
                                  : item,
                              ),
                            })
                          }
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </section>
          ),
        }))}
      />
      <div>
        <Button
          disabled={busy || draft.lanes.length >= 12}
          onClick={() => {
            const id = crypto.randomUUID();
            setExpanded([id]);
            setDraft({
              ...draft,
              lanes: [
                ...draft.lanes,
                {
                  id,
                  name: "",
                  instructions: "",
                  reviewers: [],
                },
              ],
            });
          }}
        >
          Add lane
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
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
          Save settings
        </Button>
      </div>
    </form>
  );
}
