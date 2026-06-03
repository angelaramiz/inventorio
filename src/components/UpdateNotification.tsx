import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

/**
 * UpdateNotification
 *
 * Checks for PWA updates (new service worker waiting) and displays a
 * premium glassmorphic toast notification prompting the user to update.
 */
export default function UpdateNotification() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log("Service Worker registrado con éxito");
      // Periodically check for updates (every 30 minutes)
      if (r) {
        setInterval(() => {
          r.update().catch(err => console.debug("Error checking SW update:", err));
        }, 30 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error("Error al registrar el Service Worker:", error);
    },
  });

  // Listen for the controllerchange event to reload the page when the new Service Worker takes control
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      const handleControllerChange = () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      };
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      return () => {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      };
    }
  }, []);

  const handleUpdate = async () => {
    try {
      // Trigger service worker activation
      await updateServiceWorker(true);
      // Fallback reload if controllerchange event doesn't fire after 1.5 seconds
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error("Error updating Service Worker, forcing reload:", err);
      window.location.reload();
    }
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-[100] max-w-sm w-[calc(100%-2rem)] md:w-full bg-white/90 backdrop-blur-md border border-neutral-200/80 rounded-3xl p-5 shadow-2xl animate-in fade-in slide-in-from-bottom-5 duration-350 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="bg-neutral-900 text-white p-2.5 rounded-2xl flex items-center justify-center shrink-0">
            <RefreshCw size={18} className="animate-spin-slow" />
          </div>
          <div>
            <h4 className="text-sm font-black text-neutral-900 uppercase tracking-tight">Actualización Disponible</h4>
            <p className="text-xs text-neutral-500 font-medium mt-0.5 leading-relaxed">
              Hay una nueva versión del sistema disponible con mejoras y correcciones.
            </p>
          </div>
        </div>
        <button
          onClick={() => setNeedRefresh(false)}
          className="text-neutral-450 hover:text-neutral-800 transition-colors p-1 rounded-lg hover:bg-neutral-100/50"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={() => setNeedRefresh(false)}
          className="px-3.5 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:text-neutral-900 transition-colors hover:bg-neutral-100/60"
        >
          Ignorar
        </button>
        <button
          onClick={handleUpdate}
          className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-neutral-800 transition-all flex items-center gap-1.5 shadow-md shadow-neutral-900/10"
        >
          <RefreshCw size={12} />
          Actualizar
        </button>
      </div>
    </div>
  );
}
