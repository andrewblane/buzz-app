# Review Configuration

An optional bundled plugin with a separate sidebar page for repository review
settings. Enable **Review Configuration** in Settings → Plugins → Manage plugins.
Choose a channel, register a GitHub repository, add named lanes, reviewer agents, and instructions,
and save. Open a repository row to manage its lanes. Saved cards show agents,
instructions, and routing rules. **Edit lane** opens one lane; **Save lane** persists
it before another can be added. **Back to lanes** cancels edits; **Back to repositories**
returns to the list. The main page has matching **Register repository**, **Submit PR**, and **Pull requests** actions above the **Repositories** section.

The **Submit PR** page has a full GitHub PR URL field and one
Submit button. It finds the saved repository in the selected channel, loads current
PR metadata, and assigns the first configured reviewer per matching lane. Missing
configuration, unavailable reviewers, and zero matching lanes produce an error
without starting threads. Results show assigned reviewers and thread buttons.
The separate **Pull requests** page shows previous submissions in a bordered table with delivery status, reviewer identities, and thread links. The table shows GitHub status (Open, Draft, Closed, or Merged); Reload refreshes it. Remind is disabled for closed, merged, loading, or unavailable PRs and rechecks GitHub before sending. The submitter can click **Remind** to notify saved reviewers in their current threads, with delivery feedback and retry on failure. Incomplete submissions must finish delivery through Submit PR first. The submitter can confirm **Delete** to remove a submission from the shared list. This does not stop active reviews, delete conversations, or close the GitHub PR. Submitting that URL again applies current routing and creates new reviewer threads.

Submitting an already-delivered PR sends a reviewer mention in each saved lane
thread. It preserves the saved reviewers and instructions and creates no new
threads. It resets each lane to Needs review. Incomplete original submissions resume delivery from
the original browser profile instead. These actions run only on Submit; opening
the page or a thread never dispatches messages.

All three pages use the shell's page navigation. Only Review Configuration appears in the sidebar; Submit PR has a Back button returning to it. Pull requests opens the existing All PRs page with Back navigation. Repository and lane editing
remain local sections; reloading returns Configuration to its repository list.
Restarted submissions use a versioned delivery generation; older plugin versions cannot read or resume them.
The channel selection is remembered per identity/community; one eligible channel
is selected automatically. Submit results can be recovered from the Pull requests table
following reload; navigation never replays Submit automatically.

## Getting started

Enable this plugin in **Settings → Plugins → Manage plugins**, then open its
sidebar entry. Choose a channel and register a repository. For each lane, select
reviewer agents, enter instructions, and configure at least one routing rule, then save. Open the repository to edit settings.
These selections do not start reviews or grant agents access to the channel.

---

## Storage and access

`configuration.ts` owns the save/load boundary. Each channel/repository pair has
one deterministic NIP-AR artifact of type `buzz.review.config` (kind 45010).
The signed event's `h` tag is its review channel. Its content is:

```json
{
  "version": 1,
  "repository": "example-org/project",
  "lanes": [
    {
      "id": "general",
      "name": "General",
      "instructions": "Check authorization, error handling, and tests.",
      "reviewers": []
    }
  ],
  "reminderMinutes": 15
}
```

The existing relay artifact writer persists the current head in `artifact_heads`,
the accepted revisions in `artifact_revisions`, and the signed payload in `events`.
There is no new SQL migration or local-only settings store. Ordinary channel
authorization applies: readers can see instructions, and members who can post
can edit them. Configuration is scoped to a channel, not globally unique across
the community. No GitHub credentials are stored or requested, and repository
existence/access is checked when loading PR details for submission.

Edits carry the revision that the form loaded in `prev`; the relay rejects a
stale edit atomically. A failed or uncertain save keeps the draft. Copy any
changes before Cancel → Reload, then inspect the saved version before retrying.
An unsupported or malformed row shows a warning without hiding valid rows.
Channel metadata reconfirmation disables Save while retaining an open draft.

Opening a channel or clicking Reload makes one bounded snapshot query. There
are no reconnect subscriptions or polling timers. The first version supports
100 configurations per channel, 12 lanes per repository, and a 32 KB payload.
Larger result sets are explicitly marked incomplete; use a separate channel.
The reminder interval is saved for the planned executor but has no effect yet.

## Try it

1. Enable the plugin and open **Review Configuration** in the Messages sidebar.
2. Choose a writable stream or forum channel and click **Register repository**.
3. Enter a repository, select lane reviewers, add instructions, then **Save settings**.
4. Reload the page, choose the same channel, and verify the repository row.
5. Edit the instructions, save, and use **Reload** to confirm the new version.
6. In two clients, edit the same version; the second save must fail without
   discarding its draft after the first client saves.

Use a test channel. Saving does not activate any review automation.

Reviewer choices come from the session’s shared agent inventory. Saved public keys
remain visible and removable if an agent disappears or is archived. Unassigned
lanes may be saved as drafts. Submission requires one available reviewer per matching lane,
verified ownership by the signed-in user, and existing channel membership. The
outbox rechecks membership before publishing mentions. Agent ownership is checked
from fresh signed profiles; archive evidence and shared agent choices must be
available. Run a connected agent in the desktop app to receive replies. A browser
lab with registered identities alone cannot execute a review.

## Submissions and recovery

One `buzz.review.submission` artifact per channel/repository/PR stores the selected
reviewers, instructions, configuration revision, and message IDs. New version-2
submissions store only matching lane threads. Earlier version-1 submissions retain
their overview and original lane IDs. Explicit resubmission notifies lane reviewers
only, never the overview. Reviewer ownership and availability are revalidated;
the outbox verifies channel membership before publishing mentions.

The URL identifies the repository. Each Submit reads saved configuration fresh.
For a new submission, the reader obtains complete and consistent GitHub title,
labels, file count, paths, and base/head commits before routing. Existing submissions
reuse their snapshot without requiring a GitHub read. Reviewers must verify the
current PR and report the commit they reviewed; this does not pin their checkout.

Artifact create/CAS prevents competing initial submissions. A Web Lock serializes
operations in the same profile. Original delivery belongs to the submitting profile;
other profiles may read its links but cannot take over incomplete initial delivery.
Dispatch intent is saved before enqueue, and the durable outbox retains message
identities through interrupted saves or uncertain receipts. Missing recovery data
stops delivery instead of creating replacement threads.

Explicit notifications use a recovery key per saved lane thread in the current
identity/community's outbox. Successful receipts remain until the batch succeeds,
so retrying a partial batch does not recreate its acknowledged messages. After
completion another explicit Submit starts another notification batch. These are
user-triggered follow-ups, not an exactly-once cross-device notification guarantee.
A failed notification leaves existing thread buttons available and reports failure.

Opening Submit PR reads the latest 100 submissions once, with truncation/error
feedback. Submit reads configurations and the current submission, then verifies
reviewer profiles and ownership before dispatch. No polling or reconnect reads
are added. No GitHub comments or scheduled reminders are added.

Try a fresh test PR URL → Submit PR → Open a lane thread. Check its URL, reviewer
mention, and complete instructions. Submit the same URL again: the same threads
must receive follow-ups. Check unknown repositories, zero matching lanes, and
interrupted delivery. Required channel membership and connected reviewer runtimes
are separate from configuration.

## Routing rules

New or edited lanes require 1–12 rules, combined with **Match all rules** or **Match any
rule**. Earlier rule-free lanes remain readable and match every PR until edited; editing one requires adding a rule. A PR can match several lanes; zero matches
prevents submission. Title contains/does-not-contain and exact label matching
ignore case. File counts support inclusive minimum and maximum values. Paths are
case-sensitive and relative to the repository: `*` and `?` match within a path
segment, while `**` matches zero or more complete segments. `src/**/*.tsx` matches
TSX files below `src`. A negative path rule matches only when no changed path
matches. Renames use the new path.

Desktop reads use the existing signed-in GitHub CLI. Browser reads use GitHub's
public API without credentials, so private PRs and rate-limited requests need the
desktop host. The reader rejects incomplete/changing metadata and supports at
most 3,000 changed files and 100 labels; it never routes on a truncated file list.
Metadata is fetched during new submission only; there is no poller.


## Internal review status (POC)

Each lane starts at **Needs review**. Its assigned reviewer calls the standard
Buzz tool `pr_review_status_update` with only `status: "done"` or
`status: "wait_author"`. The host supplies the review thread outside the model's
arguments; the tool resolves its current assignment and checks the reviewer.
One review is active per PR; re-reviews happen sequentially in the saved lane
threads. This POC does not bind a late call from an older turn to an older round.

**Remind** and resubmitting a listed PR reset its lanes to **Needs review** and
send updated requests in those same threads. Failed notification batches resume
from the original browser profile without replacing accepted messages. Older
submissions gain status reporting when reminded. Overall status is **Waiting on
author** if any lane needs changes, **Needs review** if any lane is pending, and
**Done** when all lanes are done. GitHub status remains separate.

Signed kind-9 status messages are both the durable report and the thread
notification. The tool and dashboard validate the assigned reviewer and current
request token. These are application checks; the generic relay enforces its
existing signature and channel-access rules. Report retries reuse the saved
status; sequential updates use a sequence number for ordering within a second.
The table applies incoming reports without polling. Reload reconciles shared
submission changes and missed reports. A full snapshot uses one artifact read
and up to twelve report reads, in batches of 100 current request tokens; capped
report pages fail visibly rather than supplying incomplete statuses.

The plugin obtains the tool's description and schema with
`agents.describeTool("pr_review_status_update")` when composing a request and
appends them after lane instructions. It maintains no copy of that documentation.

Native Codex thread sessions and the shared HarnessKit provide review context.
A standalone MCP host can set `BUZZ_CHANNEL` and `BUZZ_REVIEW_THREAD` when starting
a process dedicated to that thread. Never reuse that process across threads.
Channel-wide sessions, external MCP, and adapters without this host wiring refuse
status updates. Merely including a thread ID in the prompt does not enable it.
ACP hosts must pass those variables when creating each thread session and
recreate existing sessions after adding the wiring. Updating MCP alone does not
provide review context.
