import { validateRouting, type LaneRouting } from "./routing";
import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import type { EventData } from "../../features/relay/events";
import type { RelaySession } from "../../features/relay/session";

export const REVIEW_CONFIG_TYPE = "buzz.review.config";
export type ReviewLane = Readonly<{
  id: string;
  name: string;
  instructions: string;
  reviewers: readonly string[];
  routing?: LaneRouting;
}>;
export type ReviewConfig = Readonly<{
  version: 1;
  repository: string;
  lanes: readonly ReviewLane[];
  reminderMinutes: 15;
}>;
export type SavedReviewConfig = Readonly<{
  config: ReviewConfig;
  revision: string;
  artifactId: string;
}>;

/** Canonical GitHub repository identity; credentials and non-repository URLs are refused. */
export function repositoryName(input: string): string {
  const value = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\/$/, "");
  if (
    !/^[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d_.-]{1,100}$/i.test(value) ||
    /\/(?:\.|\.\.)$/.test(value)
  )
    throw new Error(
      "Enter a GitHub repository as owner/repository or its https://github.com URL.",
    );
  return value.toLowerCase();
}

/** Validate both form drafts and untrusted stored content. */
export function validateConfig(value: unknown): ReviewConfig {
  if (!value || typeof value !== "object")
    throw new Error("Invalid review configuration.");
  const item = value as Partial<ReviewConfig>;
  if (
    item.version !== 1 ||
    item.reminderMinutes !== 15 ||
    typeof item.repository !== "string"
  )
    throw new Error("Unsupported review configuration version or settings.");
  if (
    !Array.isArray(item.lanes) ||
    item.lanes.length < 1 ||
    item.lanes.length > 12
  )
    throw new Error("Configure between 1 and 12 review lanes.");
  const ids = new Set<string>();
  const names = new Set<string>();
  const lanes = item.lanes.map((lane: ReviewLane) => {
    if (
      !lane ||
      typeof lane.id !== "string" ||
      !/^[a-z\d-]{1,64}$/i.test(lane.id) ||
      typeof lane.name !== "string" ||
      !lane.name.trim() ||
      lane.name.trim().length > 80 ||
      typeof lane.instructions !== "string" ||
      !lane.instructions.trim() ||
      lane.instructions.length > 8000
    )
      throw new Error(
        "Each lane needs a name (up to 80 characters) and instructions (up to 8,000 characters).",
      );
    const name = lane.name.trim();
    if (ids.has(lane.id) || names.has(name.toLowerCase()))
      throw new Error("Lane names must be unique.");
    ids.add(lane.id);
    names.add(name.toLowerCase());
    // Early draft configurations may not yet have reviewer selections.
    const reviewers: unknown = lane.reviewers ?? [];
    if (
      !Array.isArray(reviewers) ||
      reviewers.length > 20 ||
      reviewers.some(
        (key) => typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key),
      ) ||
      new Set(reviewers).size !== reviewers.length
    )
      throw new Error("Choose up to 20 distinct reviewer agents per lane.");
    return {
      id: lane.id,
      name,
      instructions: lane.instructions.trim(),
      reviewers: reviewers as string[],
      ...(lane.routing === undefined
        ? {}
        : { routing: validateRouting(lane.routing) }),
    };
  });
  const config: ReviewConfig = {
    version: 1,
    repository: repositoryName(item.repository),
    lanes,
    reminderMinutes: 15,
  };
  if (new TextEncoder().encode(JSON.stringify(config)).length > 32_000)
    throw new Error(
      "This configuration is too large. Shorten the lane instructions.",
    );
  return config;
}

const tag = (event: EventData, name: string) =>
  event.tags.find((item) => item[0] === name)?.[1];
const identity = (channel: string, repository: string) =>
  uuidv5(channel, `${REVIEW_CONFIG_TYPE}:${repository}`);

/** One bounded read when the user opens or reloads a channel; never a polling loop. */
export async function loadConfigurations(
  session: RelaySession,
  channel: string,
  signal: AbortSignal,
): Promise<{
  rows: SavedReviewConfig[];
  unreadable: number;
  truncated: boolean;
}> {
  if (!session.snapshotRead)
    throw new Error("This connection cannot read review configuration.");
  const events = await session.snapshotRead(
    [
      {
        kinds: [ARTIFACT_KIND],
        "#h": [channel],
        "#type": [REVIEW_CONFIG_TYPE],
        artifact: "current",
        limit: 101,
      },
    ],
    { signal },
  );
  const results = await Promise.allSettled(
    events.slice(0, 100).map(async (event) => {
      if (
        event.kind !== ARTIFACT_KIND ||
        tag(event, "h") !== channel ||
        tag(event, "type") !== REVIEW_CONFIG_TYPE
      )
        throw new Error(
          "The relay returned an unexpected review configuration.",
        );
      const config = validateConfig(JSON.parse(event.content));
      const artifactId = await identity(channel, config.repository);
      if (tag(event, "d") !== artifactId)
        throw new Error(
          "A saved configuration has an invalid repository identity.",
        );
      return { config, revision: event.id, artifactId };
    }),
  );
  const rows = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  return {
    rows: rows.sort((a, b) =>
      a.config.repository.localeCompare(b.config.repository),
    ),
    unreadable: results.filter((result) => result.status === "rejected").length,
    truncated: events.length > 100,
  };
}

/** Save against the revision the editor loaded, so concurrent edits cannot be overwritten. */
export async function saveConfiguration(
  session: RelaySession,
  channel: string,
  draft: ReviewConfig,
  previous: SavedReviewConfig | undefined,
  signal: AbortSignal,
): Promise<SavedReviewConfig> {
  const writer = session.configArtifactWriter;
  if (!writer)
    throw new Error("This connection cannot save review configuration.");
  const config = validateConfig(draft);
  for (const lane of config.lanes) {
    const saved = previous?.config.lanes.find((item) => item.id === lane.id);
    // Preserve readable legacy lanes until they are edited; new/changed lanes require rules.
    if (
      !lane.routing?.rules.length &&
      JSON.stringify(saved) !== JSON.stringify(lane)
    )
      throw new Error(
        `Add at least one routing rule to ${lane.name} before saving.`,
      );
  }

  const artifactId = await identity(channel, config.repository);
  if (
    previous &&
    (previous.artifactId !== artifactId ||
      previous.config.repository !== config.repository)
  )
    throw new Error(
      "Create a new configuration to change the repository or channel.",
    );
  const event = await writer.sign(
    {
      kind: ARTIFACT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(config),
      tags: [
        ["ar", "1"],
        ["d", artifactId],
        ["h", channel],
        ["type", REVIEW_CONFIG_TYPE],
        ["title", `Review configuration: ${config.repository}`],
        ["op", previous ? "update" : "create"],
        ...(previous ? [["prev", previous.revision]] : []),
      ],
    },
    signal,
  );
  await writer.publish(event, signal);
  return { config, artifactId, revision: event.id };
}
