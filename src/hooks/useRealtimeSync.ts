import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

export type DomainEventType =
  | "connected"
  | "producto:deleted"
  | "caja:updated";

export interface DomainEvent {
  type: DomainEventType;
  ts: number;
  [key: string]: any;
}

export type EventHandler = (event: DomainEvent) => void;

// ── Global subscriber registry ───────────────────────────────────────────────
// Allows any component to subscribe/unsubscribe without restarting the connection.

type Subscriber = { id: string; handler: EventHandler };
const subscribers: Subscriber[] = [];

let sseInstance: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isConnecting = false;

const broadcast = (event: DomainEvent) => {
  for (const sub of subscribers) {
    try { sub.handler(event); } catch (_) {}
  }
};

const connect = () => {
  if (sseInstance || isConnecting) return;
  isConnecting = true;

  const es = new EventSource("/api/events/stream");
  sseInstance = es;

  es.onopen = () => {
    isConnecting = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  es.onmessage = (e) => {
    try {
      const event: DomainEvent = JSON.parse(e.data);
      broadcast(event);
    } catch (_) {}
  };

  es.onerror = () => {
    es.close();
    sseInstance = null;
    isConnecting = false;
    // Exponential back-off reconnect
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 5000);
    }
  };
};

const disconnect = () => {
  if (sseInstance) { sseInstance.close(); sseInstance = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  isConnecting = false;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * useRealtimeSync
 *
 * Subscribe to real-time domain events from the server SSE bus.
 * All subscribers share a SINGLE persistent connection.
 *
 * @param handler   Called whenever a domain event arrives.
 * @param filterTypes  Optional list of event types to react to (undefined = all).
 */
export function useRealtimeSync(
  handler: EventHandler,
  filterTypes?: DomainEventType[]
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((event: DomainEvent) => {
    if (!filterTypes || filterTypes.includes(event.type)) {
      handlerRef.current(event);
    }
  }, [filterTypes?.join(",")]); // eslint-disable-line

  useEffect(() => {
    const id = `sub-${++_idCounter}`;
    subscribers.push({ id, handler: stableHandler });

    // Start the shared connection if not already active
    connect();

    return () => {
      const idx = subscribers.findIndex((s) => s.id === id);
      if (idx !== -1) subscribers.splice(idx, 1);

      // Tear down SSE only when there are no remaining subscribers
      if (subscribers.length === 0) disconnect();
    };
  }, [stableHandler]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the SSE connection is currently active.
 */
export const isSseConnected = () =>
  sseInstance !== null && sseInstance.readyState === EventSource.OPEN;

/**
 * showConflictToast — generic conflict warning helper.
 */
export const showConflictToast = (message: string) =>
  toast.warning(message, { duration: 6000, id: "sync-conflict" });
