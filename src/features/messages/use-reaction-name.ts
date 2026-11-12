import { useEffect, useState } from "react";

let loaded: ((content: string) => string) | undefined;

/** The reaction name lookup, or undefined until its emoji table has loaded.
 * The table is large, so it loads once, on first use, never with first paint. */
export function useReactionName(load = true) {
  const [, setLoaded] = useState(!!loaded);
  useEffect(() => {
    if (!load) return;
    let live = true;
    // A failed load (a navigation cancelled the chunk, or it is gone) leaves
    // the name unresolved; the next mount tries again.
    void import("./reaction-name").then(
      ({ reactionName }) => {
        loaded = reactionName;
        if (live) setLoaded(true);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [load]);
  return loaded;
}
