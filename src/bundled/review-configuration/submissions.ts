import { laneMatches, type PullFacts } from "./routing";
import { npubEncode } from "nostr-tools/nip19";
import { profileMentionLink } from "../../features/messages/message-edit";
import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import { attestedOwner } from "../../features/agents/owner-attestation";
import type { EventData } from "../../features/relay/events";
import type { Outbox } from "../../features/relay/outbox";
import type { RelaySession } from "../../features/relay/session";
import {
  repositoryName,
  validateConfig,
  type ReviewConfig,
  type SavedReviewConfig,
} from "./configuration";

const TYPE = "buzz.review.submission";
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f-]{36}$/;
type Thread = { id?: string; started?: true; delivered?: true };
export type Submission = {
  version: 1 | 2;
  pr: number;
  config: ReviewConfig;
  configRevision: string;
  submitter: string;
  device: string;
  threads: Thread[];
};
export type SavedSubmission = {
  value: Submission;
  artifactId: string;
  revision: string;
};
const tag = (event: EventData, name: string) =>
  event.tags.find((t) => t[0] === name)?.[1];
const identity = (channel: string, repository: string, pr: number) =>
  uuidv5(channel, `${TYPE}:${repository}:${pr}`);
export const prUrl = (value: Submission) =>
  `https://github.com/${value.config.repository}/pull/${value.pr}`;
export const threadUrl = (channel: string, id: string) =>
  `buzz://message?channel=${channel}&id=${id}`;

/** A global PR entry requires a full URL so the configured repository is unambiguous. */
export function pullRepository(input: string): string {
  const match =
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/i.exec(
      input.trim(),
    );
  if (!match)
    throw new Error("Enter a full GitHub PR URL to find its repository.");
  const repository = repositoryName(match[1] ?? "");
  pullRequest(input, repository);
  return repository;
}

export function pullRequest(input: string, repository: string): number {
  const text = input.trim();
  const match =
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/i.exec(text);
  if (match && repositoryName(match[1] ?? "") !== repository)
    throw new Error("This PR belongs to a different repository.");
  const number = /^(?:#)?[1-9]\d*$/.test(text)
    ? Number(text.replace(/^#/, ""))
    : match
      ? Number(match[2])
      : NaN;
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(
      "Enter a PR number or its full https://github.com pull request URL.",
    );
  return number;
}

async function decode(
  event: EventData,
  channel: string,
): Promise<SavedSubmission> {
  if (
    event.kind !== ARTIFACT_KIND ||
    tag(event, "h") !== channel ||
    tag(event, "type") !== TYPE
  )
    throw new Error("Unexpected review submission.");
  const value = JSON.parse(event.content) as Submission;
  const config = validateConfig(value.config);
  if (
    (value.version !== 1 && value.version !== 2) ||
    !Number.isSafeInteger(value.pr) ||
    value.pr < 1 ||
    value.submitter !== event.pubkey ||
    !HEX.test(value.configRevision) ||
    !UUID.test(value.device) ||
    config.lanes.some((lane) => lane.reviewers.length !== 1) ||
    !Array.isArray(value.threads) ||
    value.threads.length !==
      config.lanes.length + (value.version === 1 ? 1 : 0) ||
    value.threads.some(
      (thread) =>
        !thread ||
        (thread.started !== undefined && thread.started !== true) ||
        (thread.id !== undefined && !HEX.test(thread.id)) ||
        (thread.delivered !== undefined &&
          (thread.delivered !== true || !thread.id)),
    )
  )
    throw new Error("Invalid review submission.");
  const artifactId = await identity(channel, config.repository, value.pr);
  if (tag(event, "d") !== artifactId)
    throw new Error("Invalid submission identity.");
  return { value: { ...value, config }, artifactId, revision: event.id };
}

export async function loadSubmissions(
  session: RelaySession,
  channel: string,
  signal: AbortSignal,
) {
  if (!session.snapshotRead)
    throw new Error("This connection cannot read submissions.");
  const events = await session.snapshotRead(
    [
      {
        kinds: [ARTIFACT_KIND],
        "#h": [channel],
        "#type": [TYPE],
        artifact: "current",
        limit: 101,
      },
    ],
    { signal },
  );
  const results = await Promise.allSettled(
    events.slice(0, 100).map((event) => decode(event, channel)),
  );
  return {
    rows: results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    ),
    warning: [
      events.length > 100 ? "Showing the latest 100 submissions." : "",
      results.some((result) => result.status === "rejected")
        ? "Some saved submissions could not be read."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

async function write(
  session: RelaySession,
  channel: string,
  value: Submission,
  previous: SavedSubmission | undefined,
  signal: AbortSignal,
): Promise<SavedSubmission> {
  const writer = session.configArtifactWriter;
  if (!writer) throw new Error("This connection cannot save submissions.");
  signal.throwIfAborted();
  const artifactId = await identity(channel, value.config.repository, value.pr);
  const event = await writer.sign(
    {
      kind: ARTIFACT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(value),
      tags: [
        ["ar", "1"],
        ["d", artifactId],
        ["h", channel],
        ["type", TYPE],
        ["title", `Review: ${value.config.repository}#${value.pr}`],
        ["op", previous ? "update" : "create"],
        ...(previous ? [["prev", previous.revision]] : []),
      ],
    },
    signal,
  );
  await writer.publish(event, signal);
  return { value, artifactId, revision: event.id };
}

/** Device ownership is recovery coordination, never permission. The relay still
 * authorizes every write. Shared Web Locks serialize tabs; artifact create/CAS
 * serializes devices. Losing this profile cannot authorize replacement sends. */
function deviceId(scope: string) {
  const key = `buzz.review.device:${scope}`;
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  if (!UUID.test(value))
    throw new Error("Submission recovery storage is unavailable.");
  return value;
}

export function submissionLane(value: Submission, index: number) {
  return value.config.lanes[index - (value.version === 1 ? 1 : 0)];
}

export function threadMessage(
  value: Submission,
  channel: string,
  index: number,
  reviewerName = "Reviewer",
) {
  const lane = submissionLane(value, index);
  const title = `${value.config.repository}#${value.pr}${lane ? ` · ${lane.name}` : " · Review"}`;
  return {
    kind: 9,
    tags: [
      ["h", channel],
      ["subject", title],
      ...(lane ? [["p", lane.reviewers[0] ?? ""]] : []),
    ],
    content: lane
      ? `Review request: ${prUrl(value)}\n\nReviewer: ${profileMentionLink(`@${reviewerName}`, `nostr:${npubEncode(lane.reviewers[0] ?? "")}`)}\nLane: ${lane.name}\n\n${lane.instructions}\n\nReply in this thread with the commit you reviewed, findings, and any blockers. Verify the current PR and repository before reviewing. This submission does not pin a commit or post a GitHub review.${value.version === 1 ? `\n\nOverview: ${threadUrl(channel, value.threads[0]?.id ?? "")}` : ""}`
      : `Review request: ${prUrl(value)}\n\nLanes: ${value.config.lanes.map((item) => item.name).join(", ")}\n\nLane threads and delivery status are listed in Review Configuration. A delivered request does not mean the reviewer has started. Automatic reminders are off.`,
  };
}

async function eligible(
  session: RelaySession,
  value: Submission,
  signal: AbortSignal,
) {
  await session.agentChoices.refresh(true, { fresh: true });
  signal.throwIfAborted();
  const choices = session.agentChoices.snapshot();
  if (choices.archives.status !== "ready" || choices.archives.error)
    throw new Error(
      "Refresh agents after archive access is restored before submitting.",
    );
  const keys = [
    ...new Set(value.config.lanes.map((lane) => lane.reviewers[0] ?? "")),
  ];
  if (
    keys.some(
      (key) => !choices.selectable.some((choice) => choice.pubkey === key),
    )
  )
    throw new Error(
      "A selected reviewer is unavailable. Update the saved reviewer assignments.",
    );
  if (!session.snapshotRead)
    throw new Error("Submission reads are unavailable.");
  const profiles = await session.snapshotRead(
    [{ kinds: [0], authors: keys, limit: keys.length, consistency: "strong" }],
    { signal },
  );
  for (const key of keys) {
    const profile = profiles
      .filter((event) => event.kind === 0 && event.pubkey === key)
      .sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      )[0];
    if (!profile || (await attestedOwner(profile)) !== session.viewer)
      throw new Error(
        "Submission currently requires reviewers with verified ownership by your signed-in identity.",
      );
  }
}

function delivered(
  outbox: Outbox,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const finish = (error?: Error) => {
      stop();
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const abort = () =>
      finish(
        new Error(
          "Delivery was interrupted. Resume this submission to check its saved messages.",
        ),
      );
    const check = () => {
      const item = outbox.snapshot().find((entry) => entry.event.id === id);
      if (!item)
        return finish(
          new Error(
            "Reload this page to recover delivery from the shared outbox.",
          ),
        );
      if (item.delivery === "accepted" || item.delivery === "seen") finish();
      else if (item.delivery === "failed" || item.delivery === "unknown")
        finish(
          new Error(
            item.error ??
              "Delivery is unconfirmed. Resume to retry the same message.",
          ),
        );
    };
    stop = outbox.subscribe(check);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}

/** Explicit user action only. There is no background dispatcher or polling. */
export async function submitReview(
  session: RelaySession,
  channel: string,
  saved: SavedReviewConfig,
  input: string,
  reviewers: readonly string[],
  signal: AbortSignal,
  onProgress: (value: SavedSubmission) => void,
  resume = false,
  facts?: PullFacts,
) {
  const outbox = session.outbox;
  const read = session.snapshotRead;
  if (!outbox?.supports(9) || !read || !navigator.locks)
    throw new Error(
      "This client cannot submit reviews. Use a client with durable message delivery.",
    );
  if (!session.viewer) throw new Error("Sign in before submitting a review.");
  const viewer = session.viewer;
  const pr = pullRequest(input, saved.config.repository);
  const artifactId = await identity(channel, saved.config.repository, pr);
  return navigator.locks.request(
    `buzz.review.submit:${session.scope}`,
    { signal },
    async () => {
      const device = deviceId(session.scope);
      await outbox.ready();
      const events = await read(
        [
          {
            kinds: [ARTIFACT_KIND],
            "#h": [channel],
            "#d": [artifactId],
            artifact: "current",
            limit: 1,
          },
        ],
        { signal },
      );
      let record: SavedSubmission;
      const head = events[0];
      if (head) record = await decode(head, channel);
      else {
        if (
          facts &&
          (facts.repository !== saved.config.repository || facts.pr !== pr)
        )
          throw new Error("The loaded PR does not match this submission.");
        if (
          !facts &&
          saved.config.lanes.some((lane) => lane.routing?.rules.length)
        )
          throw new Error("Load PR details before routing this submission.");
        const matched = saved.config.lanes.flatMap((lane, i) =>
          !facts || laneMatches(lane.routing, facts) ? [{ lane, i }] : [],
        );
        if (!matched.length)
          throw new Error(
            "No lanes match this PR. No review requests were sent.",
          );
        const config = validateConfig({
          ...saved.config,
          lanes: matched.map(({ lane, i }) => {
            const reviewer = reviewers[i];
            if (!reviewer || !lane.reviewers.includes(reviewer))
              throw new Error(`Choose a configured reviewer for ${lane.name}.`);
            return { ...lane, reviewers: [reviewer] };
          }),
        });
        const value: Submission = {
          version: 2,
          pr,
          config,
          configRevision: saved.revision,
          submitter: viewer,
          device,
          threads: Array.from({ length: config.lanes.length }, () => ({})),
        };
        await eligible(session, value, signal);
        record = await write(session, channel, value, undefined, signal);
      }
      onProgress(record);
      // A duplicate opens the saved preview; only explicit Resume can dispatch it.
      if (head && !resume) return record;
      if (record.value.threads.every((thread) => thread.delivered)) {
        for (const thread of record.value.threads)
          if (thread.id) await outbox.acknowledge(thread.id);
        return record;
      }
      if (
        record.value.submitter !== session.viewer ||
        record.value.device !== device
      )
        throw new Error(
          "This PR is already submitted. Resume incomplete delivery from the original browser profile; existing threads remain available here.",
        );
      if (head) await eligible(session, record.value, signal);
      for (const [index, thread] of record.value.threads.entries()) {
        signal.throwIfAborted();
        const key = `${artifactId}:${index}`;
        if (thread.delivered) {
          if (thread.id) await outbox.acknowledge(thread.id);
          continue;
        }
        const recovery = await outbox.recovery(key);
        let id = thread.id ?? recovery?.event.id;
        if (thread.id && recovery && thread.id !== recovery.event.id)
          throw new Error(
            "Submission recovery does not match the saved thread. Delivery stopped.",
          );
        if (id && !recovery) {
          const messages = await read(
            [
              {
                ids: [id],
                kinds: [9],
                "#h": [channel],
                limit: 1,
                consistency: "strong",
              },
            ],
            { signal },
          );
          if (
            !messages.some(
              (event) => event.id === id && event.pubkey === session.viewer,
            )
          )
            throw new Error(
              "The saved message is unavailable and its local recovery is missing. Delivery stopped to avoid creating a duplicate thread.",
            );
        } else {
          const active = () => !signal.aborted;
          if (recovery) {
            if (!outbox.snapshot().some((item) => item.event.id === id))
              throw new Error(
                "Reload this page to recover the saved message from another window.",
              );
            if (
              recovery.delivery !== "accepted" &&
              recovery.delivery !== "seen" &&
              recovery.delivery !== "sending"
            )
              outbox.retry(recovery.event.id, active);
          } else {
            if (thread.started)
              throw new Error(
                "Delivery was started but its recovery journal is missing. Check the channel; no replacement thread was created.",
              );
            record = await write(
              session,
              channel,
              {
                ...record.value,
                threads: record.value.threads.map((item, i) =>
                  i === index ? { started: true } : item,
                ),
              },
              record,
              signal,
            );
            onProgress(record);
            signal.throwIfAborted();
            try {
              id = outbox.send(
                threadMessage(
                  record.value,
                  channel,
                  index,
                  session.agentChoices
                    .snapshot()
                    .selectable.find(
                      (choice) =>
                        choice.pubkey ===
                        submissionLane(record.value, index)?.reviewers[0],
                    )?.name,
                ),
                { key, value: artifactId },
                active,
              );
            } catch (reason) {
              // Admission can fail before enqueue (for example a full outbox).
              // Only this still-active invocation can prove nothing was queued.
              if (!signal.aborted && !(await outbox.recovery(key))) {
                record = await write(
                  session,
                  channel,
                  {
                    ...record.value,
                    threads: record.value.threads.map((item, i) =>
                      i === index ? {} : item,
                    ),
                  },
                  record,
                  signal,
                );
                onProgress(record);
              }
              throw reason;
            }
          }
          const sentId = id;
          if (!sentId)
            throw new Error("Message delivery did not return an identity.");
          if (!thread.id) {
            record = await write(
              session,
              channel,
              {
                ...record.value,
                threads: record.value.threads.map((item, i) =>
                  i === index ? { id: sentId } : item,
                ),
              },
              record,
              signal,
            );
            onProgress(record);
          }
          await delivered(outbox, sentId, signal);
        }
        const deliveredId = id;
        if (!deliveredId)
          throw new Error("Missing delivered message identity.");
        record = await write(
          session,
          channel,
          {
            ...record.value,
            threads: record.value.threads.map((item, i) =>
              i === index ? { id: deliveredId, delivered: true } : item,
            ),
          },
          record,
          signal,
        );
        onProgress(record);
        await outbox.acknowledge(deliveredId);
      }
      return record;
    },
  );
}
