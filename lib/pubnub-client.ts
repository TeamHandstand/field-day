"use client";
import PubNub from "pubnub";
import { useEffect, useRef } from "react";

let cached: PubNub | null = null;

function getClient(): PubNub | null {
  const subscribeKey = process.env.NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY;
  if (!subscribeKey) return null;
  if (cached) return cached;
  cached = new PubNub({
    subscribeKey,
    uuid: `fieldday-client-${Math.random().toString(36).slice(2, 10)}`,
    ssl: true,
  });
  return cached;
}

export function useEventChannel(eventId: string | null, onMessage: (msg: unknown) => void) {
  const ref = useRef(onMessage);
  ref.current = onMessage;

  useEffect(() => {
    if (!eventId) return;
    const client = getClient();
    if (!client) return;
    const channel = `event-${eventId}`;
    const listener = {
      message: (e: { channel: string; message: unknown }) => {
        if (e.channel === channel) ref.current(e.message);
      },
    };
    client.addListener(listener);
    client.subscribe({ channels: [channel] });
    return () => {
      client.unsubscribe({ channels: [channel] });
      client.removeListener(listener);
    };
  }, [eventId]);
}
