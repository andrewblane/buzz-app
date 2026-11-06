import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ComposerSession } from "../messages/composer-session";

type Roles = NonNullable<ComposerSession["memberAdministration"]>;

const none: ReadonlySet<string> = new Set();
const refreshed = new WeakMap<Roles, Set<string>>();

/** The members the signed roster marks Guest ("Viewing only"). Presentation
 * only: the relay still decides who may post. Unknown roles give no guests. */
export function guestKeys(roles: Roles | undefined, channelId: string) {
  const known = roles?.snapshot(channelId).authority.roles ?? {};
  const keys = Object.entries(known).flatMap(([key, role]) =>
    role === "guest" ? [key] : [],
  );
  return keys.length ? new Set(keys) : none;
}

/** Reads each channel's roles once per session, then follows changes. */
export function useChannelGuests(
  session: ComposerSession,
  channelId: string | undefined,
  enabled = true,
) {
  const roles = session.memberAdministration;
  const subscribe = roles?.subscribe ?? (() => () => {});
  const revision = useSyncExternalStore(
    subscribe,
    () => (roles && channelId ? roles.snapshot(channelId) : undefined),
    () => (roles && channelId ? roles.snapshot(channelId) : undefined),
  );
  useEffect(() => {
    if (!roles || !channelId || !enabled) return;
    let asked = refreshed.get(roles);
    if (!asked) {
      asked = new Set();
      refreshed.set(roles, asked);
    }
    if (asked.has(channelId)) return;
    asked.add(channelId);
    void roles.refresh(channelId).catch(() => asked.delete(channelId));
  }, [roles, channelId, enabled]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is the revision.
  return useMemo(
    () => (channelId ? guestKeys(roles, channelId) : none),
    [roles, channelId, revision],
  );
}
