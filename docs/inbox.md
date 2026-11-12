# Inbox evidence: unread inbox projection and addressed feed

`session.unread.inbox()` and `session.inboxFeed` are the relay-session owners
behind Team's list views (`src/features/conversation/ConversationList.tsx`):
Threads, Direct and Reactions read them, and All uses them to rank channels.
They keep the Inbox name from the retired Activity page (`buzz.inbox`), which
was their first consumer; that page and its plugin are gone. Ordinary channel
and thread readers, read-state storage and outbox retain their existing
ownership.

## Ownership and limits

`session.unread.inbox()` / `subscribeInbox()` own retained verified unread
evidence and read actions. `session.inboxFeed` owns finite, verified addressed
history demand and exact incomplete-target metadata, not a row cache. Finite
results and live arrivals, edits and deletions use the existing session admission
and shared unread fold, so own/deleted messages stay absent and unresolved roots
never become duplicate conversations. Current membership gates the feed's
completeness targets and unread's rows; joining alone does not materialize
pre-membership history without fresh shared admission. Consumers render those
shared rows directly; there is no second row merge or feed-owned reconciliation
buffer.

Channel-archived rooms are excluded from the shared inbox projection. Signed
archive/unarchive metadata invalidates that projection even when membership and
channel type stay unchanged. Archiving removes their rows without clearing
retained evidence or read/local-unread intent. Unarchiving makes retained
conversations eligible again. Ordinary Channels/search retain member history
access and archived posting restrictions. This is inbox eligibility, not access
revocation or notification policy.

DM read clears the channel through its newest retained evidence. Thread read
advances the thread prefix, including earlier unshown replies, plus individually
represented top-level mentions and local message marks, but not unrelated
messages. Participation follows the shared unread owner's direct-parent policy,
including its existing bounded lookups for replies whose membership is undecided.
Fetched roots and participation witnesses remain structural, never extra rows.
A lookup-only root uses the existing exact-message manual-unread target until counted
root evidence arrives; its known root still supplies grouping and read-through.
Relevant replies remain thread activity even when the root cannot be fetched.
Multiple steps are not atomic: failures leave remaining evidence retryable. Manual unread is local to this device. Hosts without frontier-sync
disable read mutations. Saved frontiers are not proof of remote reconciliation.

This is **bounded recent evidence**, not a complete historical inbox. Unread
retains at most 4,096 events / 8 MiB, observing up to 500 recent events per
128-channel roster batch. A lazy addressed query returns up to 50 kind-9/40002
messages. For those exact IDs and unresolved failed targets, general `#e`
queries page signed kind-40003 edits and kind-5/9005 deletions, then deletions
of the edits; `include_aux` on an ordinary `#p` query is not a supported relay
contract. Both auxiliary stages must finish before the feed is ready. Retained
unread evidence can be provisionally admitted between queries, but exact target
IDs are marked incomplete **before** unread subscribers are notified. The
consumer must not show their body as current while incomplete; failures retain
that metadata until a later `refresh()`. This is a completeness signal, not atomic content
admission or a second message fold. A target outside the latest 50 addressed
rows is not discovered; if a failed target falls outside a later page its
bounded auxiliary check still runs before its incomplete flag is cleared.
Incomplete obligations survive disconnect and unrelated access revocation while
the corresponding readable unread evidence survives; full cache/session retirement
clears both. Tombstone checks include retained author edits even if a later relay
query omits their soft-deleted rows. If reference visibility withholds an auxiliary
event, the finite attempt stays failed/incomplete rather than treating the filtered
page as exhausted history. An explicit `refresh()` can settle it once existing shared
readers have admitted the missing reference; there is no reference-resolution loop.
Auxiliary reads cap retained results at 2,000 events / 4 MiB per stage; the shared reader
keeps its existing per-request deadline and cancellation. Missing roots,
participation or older activity can omit rows; an empty list does not prove
complete history. No polling, independent row source or channel window is
opened for the feed. Access/cache/disconnect/disposal fence pending reads; local
read intent remains with unread.

## Reaction activity

`session.inboxFeed.reactions` owns a separate bounded projection of recipient-tagged
kind-7 events. App and MCP writers add the target author's `p` tag. It recovers
50 recent addressed events and retains up to 100 candidates, including live arrivals;
it does not backfill legacy tagless reactions. Exact target ownership, current channel
eligibility and edit/deletion closure are checked before displaying any preview.
Incomplete settlement withholds rows rather than showing stale text.

Team's Reactions view (`reactionRows` in `src/features/conversation/reaction-rows.ts`)
groups emoji used by multiple people into one row per emoji and target (custom
emoji include their URL). Emoji used by only one person fold into that person's
row for the target. Each row uses its newest active reaction for time and
ordering. Reactions have no unread state, mark-read actions or badge
contribution, and the view's Unread only choice does not hide them. Selecting a
row opens that message through the existing conversation navigator, in its
thread when it is a reply.

## Verification status

`inbox-feed.test.ts` exercises the real session reader/visibility/unread owners
with signed ephemeral events, including the first-admission subscriber ordering,
held edit and tombstone reads, failure/retry, reentrant access removal and cache
reset, root regrouping, and an edited addressed target older than 500 ordinary
messages. `unread.test.ts` retains the main read/catch-up behavior and inbox
projection/read-state cases, and `inbox-reactions.test.ts` covers the reaction
projection. None of these establishes browser paint, real relay persistence or
packaged/native acceptance.
