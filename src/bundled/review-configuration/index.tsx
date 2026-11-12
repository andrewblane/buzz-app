import { gitHubCli } from "../github/gh";
import { createPullReader, createPullStatusReader } from "./pull-facts";
import type { PluginModule } from "../../plugins/api";
import {
  ReviewConfigurationPage,
  reviewPageTitle,
  type ReviewPage,
} from "./ReviewConfigurationPage";

export const inject = ["pages", "relay", "navigation", "host"];
export const apply: PluginModule["apply"] = (ctx) => {
  const { relay, navigation: navigator } = ctx;
  const gh = gitHubCli(ctx.host);
  const readPull = createPullReader(gh);
  const readStatus = createPullStatusReader(gh);
  for (const page of ["configuration", "submit", "all"] satisfies ReviewPage[])
    ctx.pages.register({
      id: page,
      title: reviewPageTitle(page),
      layout: "workspace",
      primary: page === "configuration",
      placement: "sidebar",
      component: () => (
        <ReviewConfigurationPage
          page={page}
          relay={relay}
          navigator={navigator}
          readPull={readPull}
          readStatus={readStatus}
        />
      ),
    });
};
