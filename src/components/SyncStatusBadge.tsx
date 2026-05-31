import { useState, useEffect } from "react";
import { useRealtimeSync, isSseConnected } from "../hooks/useRealtimeSync";
import { Wifi, WifiOff } from "lucide-react";

/**
 * SyncStatusBadge
 * 
 * Small indicator shown in the app nav/header showing the real-time
 * SSE connection status. Green dot + "En Vivo" when connected,
 * red when disconnected.
 */
export default function SyncStatusBadge() {
  const [connected, setConnected] = useState(false);
  const [clients, setClients] = useState<number | null>(null);

  useRealtimeSync((event) => {
    if (event.type === "connected") {
      setConnected(true);
      setClients(event.clients ?? null);
    }
  }, ["connected"]);

  // Periodically check the raw readyState
  useEffect(() => {
    const id = setInterval(() => {
      setConnected(isSseConnected());
    }, 3000);
    return () => clearInterval(id);
  }, []);

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
