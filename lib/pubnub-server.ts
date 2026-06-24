// Server-only PubNub publisher. Never import this from a client component.
import "server-only";
import PubNub from "pubnub";

export type EventChannelMessage = {
  type:
    | "score_updated"
    | "score_deleted"
    | "event_finalized"
    | "event_unlocked"
    | "team_changed"
    | "activity_changed"
    | "timer_updated";
  eventId: string;
  payload?: Record<string, unknown>;
  ts: number;
};

let cached: PubNub | null = null;

function getClient(): PubNub | null {
  const publishKey = process.env.PUBNUB_PUBLISH_KEY;
  const subscribeKey = process.env.NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY;
  if (!publishKey || !subscribeKey) return null;
  if (cached) return cached;
  cached = new PubNub({
    publishKey,
    subscribeKey,
    secretKey: process.env.PUBNUB_SECRET_KEY,
    uuid: "fieldday-server",
    ssl: true,
  });
  return cached;
}

export function eventChannel(eventId: string): string {
  return `event-${eventId}`;
}

export async function publishEvent(message: EventChannelMessage): Promise<void> {
  const client = getClient();
  if (!client) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[pubnub] (no keys configured) would publish:", message);
    }
    return;
  }
  try {
    // PubNub's Payload type is finicky; the runtime accepts any JSON-serializable value.
    await client.publish({
      channel: eventChannel(message.eventId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: message as any,
    });
  } catch (err) {
    console.error("[pubnub] publish failed", err);
  }
}
