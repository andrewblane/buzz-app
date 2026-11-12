import { gitHubCli } from "../github/gh";
import { createPullReader } from "./pull-facts";
import type { PluginModule } from "../../plugins/api";
import { ReviewConfigurationPage } from "./ReviewConfigurationPage";

export const inject = ["pages", "relay", "navigation", "host"];
export const apply: PluginModule["apply"] = (ctx) => {
  const { relay, navigation: navigator } = ctx;
  const readPull = createPullReader(gitHubCli(ctx.host));
  for (const submit of [false, true])
    ctx.pages.register({
      id: submit ? "submit" : "configuration",
      title: submit ? "Submit PR" : "Review Configuration",
      layout: "workspace",
      primary: true,
      placement: "sidebar",
      component: () => (
        <ReviewConfigurationPage
          submit={submit}
          relay={relay}
          navigator={navigator}
          readPull={readPull}
        />
      ),
    });
};
