import { useState, useEffect } from "react";
import { useRealtimeSync, isSseConnected } from "../hooks/useRealtimeSync";
import { getOfflineQueue } from "../utils/pwaDb";
import { Wifi, WifiOff, CloudLightning } from "lucide-react";

/**
 * SyncStatusBadge
 * 
 * Small indicator shown in the app nav/header showing the real-time
 * SSE connection status and PWA offline queue status.
 */
export default function SyncStatusBadge() {
  const [connected, setConnected] = useState(false);
  const [clients, setClients] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);

  useRealtimeSync((event) => {
    if (event.type === "connected") {
      setConnected(true);
      setClients(event.clients ?? null);
    }
  }, ["connected"]);

  const updatePendingCount = async () => {
    const queue = await getOfflineQueue();
    setPendingCount(queue.length);
  };

  // Periodically check the raw readyState and manage online listeners
  useEffect(() => {
    const checkStatus = () => {
      setConnected(isSseConnected());
    };

    const handleOnline = () => {
      setIsOnline(true);
      checkStatus();
      updatePendingCount();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setConnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pwa-offline-queue-changed", updatePendingCount);

    const id = setInterval(checkStatus, 3000);
    updatePendingCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pwa-offline-queue-changed", updatePendingCount);
      clearInterval(id);
    };
  }, []);

  if (!isOnline) {
    return (
      <div
        title={pendingCount > 0 ? `${pendingCount} operación(es) pendiente(s) de sincronizar` : "Trabajando sin conexión"}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all duration-500 ${
          pendingCount > 0
            ? "bg-amber-50 text-amber-700 border border-amber-250 animate-pulse"
            : "bg-neutral-100 text-neutral-400 border border-neutral-200"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pendingCount > 0 ? "bg-amber-500 animate-ping" : "bg-neutral-400"}`} />
        <CloudLightning size={10} />
        <span>Sin Red {pendingCount > 0 ? `(${pendingCount})` : ""}</span>
      </div>
    );
  }

  return (
    <div
      title={connected ? `Sincronización en tiempo real activa${clients ? ` · ${clients} dispositivo(s) conectado(s)` : ""}` : "Sin conexión en tiempo real"}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all duration-500 ${
        connected
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-neutral-100 text-neutral-400 border border-neutral-200"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? "bg-emerald-500 animate-pulse" : "bg-neutral-300"}`} />
      {connected ? (
        <>
          <Wifi size={10} />
          <span className="hidden sm:inline">En Vivo</span>
          {clients && clients > 1 && (
            <span className="bg-emerald-100 text-emerald-800 px-1 rounded-full">{clients}</span>
          )}
        </>
      ) : (
        <>
          <WifiOff size={10} />
          <span className="hidden sm:inline">Desconectado</span>
        </>
      )}
    </div>
  );
}

