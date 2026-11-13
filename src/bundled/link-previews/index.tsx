import { isTauri } from "@tauri-apps/api/core";
import type { PluginModule } from "../../plugins/api";
import { LinkPreview } from "./LinkPreview";
import { createLoader } from "./loader";
import { previewable } from "./safety";
import {
  showGitHubCards,
  subscribeGitHubCards,
} from "../github/card-preference";

export const inject = ["conversation", "host"];
export const apply: PluginModule["apply"] = (ctx) => {
  const loader = createLoader(ctx.host);
  ctx.effect(() => () => loader.stop());
  if (!isTauri() || !loader.available) return;
  ctx.effect(() => {
    let registration: ReturnType<typeof ctx.inject> | undefined;
    const sync = () => {
      void registration?.dispose();
      const github = showGitHubCards();
      registration = ctx.inject(["conversation"], (scope) => {
        scope.conversation.registerLinkPreview({
          id: "web",
          title: "Web page preview",
          matches: (url) => {
            const target = previewable(url);
            return (
              !!target &&
              (github || target.hostname.replace(/\.+$/, "") !== "github.com")
            );
          },
          // The catch-all band: a plugin that previews its own sites claims them
          // at the default, 0.
          order: 100,
          component: (props) => <LinkPreview {...props} loader={loader} />,
        });
      });
    };
    const stop = subscribeGitHubCards(sync);
    sync();
    return () => {
      stop();
      void registration?.dispose();
    };
  });
};
