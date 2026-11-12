import type { PluginModule } from "../../plugins/api";
import { ReviewConfigurationPage } from "./ReviewConfigurationPage";

export const inject = ["pages", "relay", "navigation"];
export const apply: PluginModule["apply"] = (ctx) => {
  const { relay, navigation: navigator } = ctx;
  ctx.pages.register({
    id: "configuration",
    title: "Review Configuration",
    layout: "workspace",
    primary: true,
    placement: "sidebar",
    component: () => (
      <ReviewConfigurationPage relay={relay} navigator={navigator} />
    ),
  });
};
