# Review Configuration

An optional bundled plugin with a separate sidebar page for repository review
settings. Enable **Review Configuration** in Settings → Plugins → Manage plugins.
Choose a channel, register a GitHub repository, add named lanes, reviewer agents, and instructions,
and save. The repository table supports editing and an explicit reload.

Use **Submit PR** to select a saved repository, enter a PR number or URL, and
choose one configured reviewer per lane. **Start review threads** saves the
instruction snapshot, creates an overview and one thread per lane, and mentions
each selected reviewer with the complete lane instructions. The list retains
thread links and delivery status. Sending does not prove that an agent is running
or reviewing. No model process or reminder timer is started by this plugin.

## Getting started

Enable this plugin in **Settings → Plugins → Manage plugins**, then open its
sidebar entry. Choose a channel and register a repository. For each lane, select
reviewer agents and enter instructions, then save. Use the table to edit settings.
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
existence/access is not checked in this first slice.

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
lanes may be saved as drafts. Submission requires one available reviewer per lane,
verified ownership by the signed-in user, and existing channel membership. The
outbox rechecks membership before publishing mentions. Agent ownership is checked
from fresh signed profiles; archive evidence and shared agent choices must be
available. Run a connected agent in the desktop app to receive replies. A browser
lab with registered identities alone cannot execute a review.

## Submissions and recovery

One `buzz.review.submission` artifact per channel/repository/PR stores the selected
reviewers, instructions, configuration revision, and message IDs. Repeating a PR
returns that record; resubmission rounds are not implemented. The PR URL is
validated against the repository, but GitHub existence, permissions, title and
commit are not fetched. Reviewers are asked to verify the PR and report the exact
commit they reviewed. This does not post a GitHub review or claim an approval.

Artifact create/CAS prevents competing submissions. A local profile identifier
and Web Lock serialize delivery in the submitting profile; outbox recovery keeps
the exact messages through lost receipts or interrupted artifact saves.
**Resume submission** explicitly retries saved messages. A duplicate submission
first returns the saved preview; it never silently dispatches an older selection. Other profiles can read
the links but cannot take over incomplete delivery. If the original profile's
recovery storage is lost, delivery stops instead of risking duplicate threads.
Dispatch intent is saved before enqueueing. If that intent survives but both the
message ID and recovery journal are missing, the row shows unconfirmed delivery
and stops. A proven rejection before enqueue clears that intent for a later retry.
A missing outbox message with a known ID is checked against the relay before
recording delivery.
No background retries, polling, or model runtime are added.

Opening a channel adds one bounded submissions read (latest 100, with truncation
notice). Submission explicitly reads the current record and reviewer profiles,
refreshes agent choices, and uses the outbox's per-message membership preflight.
Reconnect introduces no new plugin reads.

Try Submit PR → Start review threads → reload → Open a lane thread. Check that
the PR, reviewer mention and complete instructions are present. Submit the same
PR again: it must reuse the saved threads. Test interrupted delivery with Resume
from the same browser profile. Reminders, review verdict tracking, GitHub status
synchronization, and new review rounds remain future work.
