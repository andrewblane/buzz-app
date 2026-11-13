import { expect, it, vi } from "vitest";
import { updateReviewStatus } from "./pr-review";
import type { BuzzClient, Template } from "./client";
import { keypair, signed } from "../features/relay/testing";
import { uuidv5 } from "../features/agents/agent-config-artifacts";
import {
  overallReviewStatus,
  reportStatus,
  reviewTarget,
  type ReviewState,
} from "../features/agents/pr-review";

it.each([undefined, false, true])(
  "permits an approved report only for an opted-in lane (%s)",
  async (autoApprove) => {
    const owner = keypair(),
      agent = keypair();
    const channel = "11111111-1111-4111-8111-111111111111",
      root = "a".repeat(64);
    const artifact = await uuidv5(
      channel,
      "buzz.review.submission:example-org/project:1",
    );
    const head = signed(owner, {
      kind: 45010,
      tags: [
        ["h", channel],
        ["type", "buzz.review.submission"],
        ["d", artifact],
      ],
      content: JSON.stringify({
        version: 2,
        pr: 1,
        submitter: owner.pubkey,
        config: {
          repository: "example-org/project",
          lanes: [{ reviewers: [agent.pubkey], autoApprove }],
        },
        threads: [
          { id: root, request: "22222222-2222-4222-8222-222222222222" },
        ],
      }),
    });
    const publish = vi.fn(async (template: Template) =>
      signed(agent, {
        ...template,
        tags: template.tags.map((tag) => [...tag]),
      }),
    );
    const client = {
      pubkey: agent.pubkey,
      query: vi.fn(async (filters) => (filters[0].artifact ? [head] : [])),
      publish,
    } as unknown as BuzzClient;
    if (autoApprove) {
      await expect(
        updateReviewStatus(
          client,
          { review: { channel, root } },
          { status: "approved" },
        ),
      ).resolves.toContain("saved: approved");
      const event = await publish.mock.results[0]?.value;
      expect(
        reportStatus(
          event,
          await reviewTarget(head, channel, root, agent.pubkey),
        ),
      ).toBe("approved");
    } else {
      await expect(
        updateReviewStatus(
          client,
          { review: { channel, root } },
          { status: "approved" },
        ),
      ).rejects.toThrow("Automatic approval is disabled");
      expect(publish).not.toHaveBeenCalled();
      const forged = signed(agent, {
        kind: 9,
        content: "Approved",
        tags: [
          ["h", channel],
          ["e", root, "", "reply"],
          ["t", "buzz.review.status"],
          ["r", "22222222-2222-4222-8222-222222222222"],
          ["review", artifact, "0"],
          ["review-sequence", "1"],
          ["status", "approved"],
        ],
      });
      expect(
        reportStatus(
          forged,
          await reviewTarget(head, channel, root, agent.pubkey),
        ),
      ).toBeUndefined();
    }
  },
);

it.each<[ReviewState[], ReviewState]>([
  [[], "need_review"],
  [["approved", "need_review"], "need_review"],
  [["approved", "request_changes"], "request_changes"],
  [["approved", "lgtm_not_approved"], "lgtm_not_approved"],
  [["approved", "approved"], "approved"],
  [["approved", "done"], "done"],
  [["approved", "wait_author"], "wait_author"],
])(
  "aggregates %j as %s without treating completion as approval",
  (states, expected) => {
    expect(overallReviewStatus(states)).toBe(expected);
  },
);
