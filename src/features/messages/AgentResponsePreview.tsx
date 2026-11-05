import type { ReactNode } from "react";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { RobotIcon } from "../../shared/design-system/icons";
import { useMessageDensity } from "../../shared/theme/message-density";
import { ProfilePeek } from "../profiles/ProfilePeek";
import { profileTarget } from "../profiles/target";
import type { RelaySession } from "../relay/session";
import { AuthorLink } from "./AuthorLink";
import styles from "./Messages.module.css";

/** Incoming message geometry for work that has not published a response yet. */
export function AgentResponsePreview({
  name,
  picture,
  participants = [],
  layout = "timeline",
  children,
  stackPrevious = false,
  bylineHint,
  profile,
}: {
  bylineHint?: ReactNode;
  stackPrevious?: boolean;
  name: string;
  picture?: string | undefined;
  participants?: readonly {
    id: string;
    name: string;
    picture?: string | undefined;
  }[];
  layout?: "timeline" | "thread" | "continuation" | undefined;
  children: ReactNode;
  /** The named agent: its avatar and name open its profile, as a message
   * author's do. */
  profile?:
    | Readonly<{
        pubkey: string;
        session: RelaySession | undefined;
        channelId: string;
        canOpen(target: string): boolean;
        open(target: string): boolean;
      }>
    | undefined;
}) {
  // A flat list's group avatar is on its first row; a continuation keeps only
  // the label, which names the row while its byline is omitted.
  const flat = useMessageDensity() === "compact";
  const hiddenAvatar = stackPrevious && flat;
  const avatars: typeof participants = participants.length
    ? participants.slice(0, 3)
    : [{ id: "primary", name, picture }];
  const target = profile && profileTarget(profile.pubkey, { agent: true });
  const opener =
    profile && target && profile.canOpen(target)
      ? { ...profile, target }
      : undefined;
  // A lone avatar is the named agent's; a group stays one labelled image.
  const peek = avatars.length === 1 ? opener : undefined;
  const byline = (
    <>
      <RobotIcon aria-hidden="true" className={styles.authorAgentIcon} />
      {name}
    </>
  );
  return (
    <div
      className={styles.message}
      data-stack-previous={stackPrevious || undefined}
      data-layout={layout}
      data-agent-response-preview=""
    >
      <span className={styles.messageGutter} />
      <div className={styles.messageBody}>
        <div className={styles.messageContent}>
          <div className={hiddenAvatar ? "sr-only" : styles.messageAvatar}>
            <span
              className={styles.agentAvatarGroup}
              data-count={Math.max(1, Math.min(participants.length, 3))}
              {...(peek
                ? {}
                : {
                    role: "img",
                    "aria-label": participants.length
                      ? participants.map((agent) => agent.name).join(", ")
                      : name,
                  })}
            >
              {avatars.map((agent) => {
                const avatar = (
                  <Avatar
                    src={agent.picture}
                    alt=""
                    fallback={agent.name}
                    shape="squircle"
                    size="fill"
                  />
                );
                return (
                  <span
                    key={agent.id}
                    className={styles.agentAvatarGroupItem}
                    title={peek ? undefined : agent.name}
                  >
                    {peek ? (
                      <ProfilePeek
                        viewer={peek.session?.viewer}
                        name={name}
                        picture={picture}
                        pubkey={peek.pubkey}
                        agent
                        session={peek.session}
                        channelId={peek.channelId}
                        target={peek.target}
                        onOpen={peek.open}
                        trigger={
                          <IconButton
                            size={layout === "timeline" ? "md" : "sm"}
                            shape="round"
                            aria-label={`View ${name} profile`}
                            icon={avatar}
                          />
                        }
                      />
                    ) : (
                      avatar
                    )}
                  </span>
                );
              })}
            </span>
          </div>
          {!stackPrevious && (
            <div className={styles.messageHeader}>
              <div className={styles.byline}>
                <strong className={styles.author}>
                  {opener ? (
                    <AuthorLink onOpen={() => opener.open(opener.target)}>
                      {byline}
                    </AuthorLink>
                  ) : (
                    byline
                  )}
                </strong>
                {bylineHint}
              </div>
            </div>
          )}
          <div className={styles.messageBubble}>{children}</div>
        </div>
      </div>
    </div>
  );
}
