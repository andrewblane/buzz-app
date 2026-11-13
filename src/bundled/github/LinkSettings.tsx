import { useState } from "react";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { SwitchPreferenceRow } from "../../shared/design-system/ui/SwitchPreferenceRow";
import { setShowGitHubCards, useShowGitHubCards } from "./card-preference";
import {
  setOpenGitHubLinksInBuzz,
  useOpenGitHubLinksInBuzz,
} from "./link-preference";

export function LinkSettings({ active }: { active(): boolean }) {
  const enabled = useOpenGitHubLinksInBuzz();
  const cards = useShowGitHubCards();
  const [error, setError] = useState(false);
  return (
    <section aria-label="GitHub link settings">
      <InlineHeader title="Links" />
      <SettingsGroup>
        <SwitchPreferenceRow
          label="Show GitHub cards"
          description="Show preview cards below messages with GitHub links. This applies to your viewing in all communities on this device."
          checked={cards}
          onCheckedChange={(next) => {
            if (!active()) return;
            try {
              setShowGitHubCards(next);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        />
        <SwitchPreferenceRow
          label="Open GitHub links in Buzz"
          description="Open supported GitHub links in a side panel. Turn off to use your browser. This applies to all communities on this device."
          checked={enabled}
          onCheckedChange={(next) => {
            if (!active()) return;
            try {
              setOpenGitHubLinksInBuzz(next);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        />
      </SettingsGroup>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          Your choice could not be saved. Try changing it again.
        </p>
      )}
    </section>
  );
}
