import { gitHubCli } from "../github/gh";
import { createPullReader } from "./pull-facts";
import type { PluginModule } from "../../plugins/api";
import { ReviewConfigurationPage } from "./ReviewConfigurationPage";

export const inject = ["pages", "relay", "navigation", "host"];
export const apply: PluginModule["apply"] = (ctx) => {
  const { relay, navigation: navigator } = ctx;
  const readPull = createPullReader(gitHubCli(ctx.host));
  ctx.pages.register({
    id: "configuration",
    title: "Review Configuration",
    layout: "workspace",
    primary: true,
    placement: "sidebar",
    component: () => (
      <ReviewConfigurationPage
        relay={relay}
        navigator={navigator}
        readPull={readPull}
      />
    ),
  });
};
