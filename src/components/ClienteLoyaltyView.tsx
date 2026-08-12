import { useCallback, useEffect, useState, type ElementType, type ReactNode } from "react";
import * as QRCode from "qrcode";
import { toast } from "sonner";
import {
  Home, QrCode, Settings, Plus, Wallet, Share2, Copy, User,
  ArrowUpRight, RefreshCw, Sparkles, BadgeCheck, AlertCircle
} from "lucide-react";

interface ClienteInfo {
  id?: number;
  ref: string;
  nombre: string;
  correo?: string;
  telefono?: string;
  cumple?: string;
  saldo_monedero: number;
  created_at?: string;
  updated_at?: string;
}

interface CompraProducto {
  sku: string;
  modelo?: string;
  cantidad?: number;
  precio?: number;
}

interface Compra {
  id: number;
  total: number;
  metodo_pago: string;
  estado: string;
  productos?: CompraProducto[];
  created_at: string;
  descuento_aplicado?: number;
}

const STORAGE_KEY = "aura_cliente_ref";
const DEFAULT_REF = "FIEL-DEMO001";

const DEMO_CLIENTE: ClienteInfo = {
  ref: "FIEL-DEMO01",
  nombre: "Socio Demo",
  correo: "demo@aura.mx",
  saldo_monedero: 500,
};

const DEMO_COMPRAS: Compra[] = [
  { id: 1, total: 799, metodo_pago: "monedero", estado: "completada", productos: [{ sku: "SKU-DEMO-1", modelo: "Blazer Slim Gris", cantidad: 1, precio: 799 }], created_at: "2026-08-10T18:30:00Z" },
  { id: 2, total: 1299, metodo_pago: "tarjeta", estado: "completada", productos: [{ sku: "SKU-DEMO-2", modelo: "Vestido Midi Negro", cantidad: 1, precio: 1299 }], created_at: "2026-08-05T20:15:00Z" },
  { id: 3, total: 549, metodo_pago: "efectivo", estado: "completada", productos: [{ sku: "SKU-DEMO-3", modelo: "Camisa Oxford Blanca", cantidad: 2, precio: 549 }], created_at: "2026-07-28T16:45:00Z" },
];

export default function ClienteLoyaltyView() {
  const serverUrl = localStorage.getItem("serverUrl") || window.location.origin;

  const [activeTab, setActiveTab] = useState<"inicio" | "qr" | "ajustes">("inicio");
  const [clienteRef, setClienteRef] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_REF;
  });
  const [cliente, setCliente] = useState<ClienteInfo | null>(null);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loading, setLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string>("");
  const [recargaInput, setRecargaInput] = useState("");
  const [showRecarga, setShowRecarga] = useState(false);
  const [refInput, setRefInput] = useState(clienteRef);
  const [demoMode, setDemoMode] = useState(false);
  const [demoSaldo, setDemoSaldo] = useState(DEMO_CLIENTE.saldo_monedero);

  const clienteActual = cliente ?? (demoMode ? DEMO_CLIENTE : null);
  const saldoActual = cliente ? cliente.saldo_monedero : (demoMode ? demoSaldo : 0);
  const comprasActuales = demoMode && !cliente ? DEMO_COMPRAS : compras;
  const refActual = clienteActual?.ref || clienteRef;

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const base = serverUrl || window.location.origin;
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Error ${res.status}`);
    }
    return res.json();
  }, [serverUrl]);

  const loadCliente = useCallback(async () => {
    if (!clienteRef) return;
    setLoading(true);
    try {
      const data: ClienteInfo = await api(`/api/loyalty/cliente/${encodeURIComponent(clienteRef)}`);
      setCliente(data);
      localStorage.setItem(STORAGE_KEY, data.ref);
      const qr = await QRCode.toDataURL(data.ref, {
        width: 280,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setQrUrl(qr);
    } catch (e: any) {
      toast.error(`No se pudo cargar el cliente: ${e.message}`);
      setCliente(null);
    } finally {
      setLoading(false);
    }
  }, [api, clienteRef]);

  const loadCompras = useCallback(async () => {
    if (!clienteRef) return;
    try {
      const data: Compra[] = await api(`/api/loyalty/cliente/${encodeURIComponent(clienteRef)}/compras`);
      setCompras(data || []);
    } catch (e: any) {
      setCompras([]);
    }
  }, [api, clienteRef]);

  useEffect(() => {
    loadCliente();
    loadCompras();
  }, [loadCliente, loadCompras]);

  useEffect(() => {
    if (demoMode && !cliente) {
      QRCode.toDataURL(DEMO_CLIENTE.ref, {
        width: 280,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).then(setQrUrl).catch(() => {});
    }
  }, [demoMode, cliente]);

  useEffect(() => {
    setRefInput(clienteRef);
  }, [clienteRef]);

  const recargar = async (monto: number) => {
    if (monto <= 0) return;
    if (demoMode && !cliente) {
      setDemoSaldo(s => s + monto);
      setShowRecarga(false);
      setRecargaInput("");
      toast.success(`Recarga de $${monto.toFixed(2)} exitosa (demo)`);
      return;
    }
    if (!clienteRef) return;
    try {
      const res = await api("/api/loyalty/recargar-monedero", {
        method: "POST",
        body: JSON.stringify({ cliente_ref: clienteRef, monto }),
      });
      toast.success(`Recarga de $${monto.toFixed(2)} exitosa`);
      setCliente(prev => prev ? { ...prev, saldo_monedero: res.nuevo_saldo } : null);
      setShowRecarga(false);
      setRecargaInput("");
    } catch (e: any) {
      toast.error(`Error al recargar: ${e.message}`);
    }
  };

  const simular = async () => {
    await recargar(500);
    toast.info("Simulación: se agregaron $500 de prueba");
  };

  const invitar = async () => {
    const url = `${window.location.origin}/cliente`;
    const text = `Únete a AURA Club y empieza a acumular beneficios: ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "AURA Club", text, url });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("Link copiado al portapapeles");
      }
    } catch (_) {
      // El usuario canceló o no hay soporte
    }
  };

  const guardarRef = () => {
    const clean = refInput.trim().toUpperCase();
    if (!clean) return;
    setClienteRef(clean);
    localStorage.setItem(STORAGE_KEY, clean);
    setDemoMode(false);
    toast.success("Referencia actualizada");
  };

  const formatearFecha = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  };

  const renderInicio = () => (
    <div className="space-y-6 pb-28">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/80">
            Bienvenido de vuelta
          </p>
          <h1 className="text-2xl font-black text-white mt-0.5">
            ¡Hola, {clienteActual?.nombre || "Socio"}!
          </h1>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-black uppercase tracking-wider border border-amber-500/30">
            <Sparkles size={10} /> Nivel Oro
          </span>
          <p className="text-[10px] text-emerald-200/60 mt-1 font-mono">
            Ref: {refActual}
          </p>
        </div>
      </div>

      {/* Wallet card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900 to-slate-900 border border-emerald-500/20 p-5 shadow-2xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-emerald-400" />
              <span className="text-xs font-black uppercase tracking-wider text-emerald-100">
                Dinero Electrónico
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Activo
            </span>
          </div>

          <p className="text-xs text-emerald-200/60 mb-1">Saldo disponible en caja</p>
          <p className="text-4xl font-black text-white tracking-tight">
            ${saldoActual.toFixed(2)}
          </p>

          <div className="mt-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-emerald-200/50 uppercase tracking-wider">Socio</p>
              <p className="text-sm font-bold text-emerald-100">{refActual}</p>
            </div>
            <p className="text-[10px] text-amber-300/80 font-medium text-right max-w-[120px]">
              Aceptado en todas las sucursales
            </p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        <ActionButton icon={QrCode} label="Mi QR" onClick={() => setActiveTab("qr")} />
        <ActionButton icon={Plus} label="Recargar" onClick={() => setShowRecarga(true)} />
        <ActionButton icon={RefreshCw} label="Simular" onClick={simular} />
        <ActionButton icon={Share2} label="Invitar" onClick={invitar} />
      </div>

      {/* Recarga panel */}
      {showRecarga && (
        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-black text-white uppercase tracking-wider">Recargar monedero</p>
          <div className="flex gap-2">
            {[200, 500, 1000].map(m => (
              <button
                key={m}
                onClick={() => recargar(m)}
                className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 transition-colors"
              >
                +${m}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={recargaInput}
              onChange={e => setRecargaInput(e.target.value)}
              placeholder="Otro monto"
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-emerald-500"
            />
            <button
              onClick={() => recargar(parseFloat(recargaInput) || 0)}
              className="px-4 py-2 rounded-xl bg-neutral-800 text-white text-xs font-black hover:bg-neutral-700"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Historial */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <ArrowUpRight size={16} className="text-emerald-400" />
            Historial de Movimientos
          </h2>
          <span className="text-[10px] text-slate-400 font-bold">{comprasActuales.length} registros</span>
        </div>

        {comprasActuales.length === 0 ? (
          <div className="text-center py-10 bg-slate-900/50 rounded-2xl border border-slate-800">
            <p className="text-xs text-slate-400">Aún no tienes movimientos</p>
          </div>
        ) : (
          <div className="space-y-3">
            {comprasActuales.map((c) => {
              const productos = c.productos || [];
              const label = productos.length > 0
                ? productos.map(p => p.modelo || p.sku).join(", ")
                : "Compra en AURA";
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-3"
                >
                  <div className="h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                    <ArrowUpRight size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{label}</p>
                    <p className="text-[10px] text-slate-400">
                      {formatearFecha(c.created_at)} · {productos.length || 1}{" "}
                      {productos.length === 1 ? "prenda" : "prendas"} · Ticket {c.metodo_pago}
                    </p>
                  </div>
                  <p className="text-sm font-black text-white shrink-0">-${c.total.toFixed(2)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderQR = () => (
    <div className="flex flex-col items-center justify-center min-h-[70vh] pb-28 text-center space-y-6">
      <div>
        <h2 className="text-lg font-black text-white">Código de membresía</h2>
        <p className="text-xs text-slate-400 mt-1">Escanea este código en el POS para identificarte</p>
      </div>

      <div className="bg-white p-5 rounded-3xl shadow-2xl">
        {qrUrl ? (
          <img src={qrUrl} alt="QR de membresía" className="w-64 h-64" />
        ) : (
          <div className="w-64 h-64 bg-neutral-100 animate-pulse rounded-xl" />
        )}
      </div>

      <div>
        <p className="text-xl font-black text-white tracking-widest">{refActual}</p>
        {clienteActual && (
          <p className="text-xs text-emerald-300 mt-1">{clienteActual.nombre}</p>
        )}
      </div>

      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(refActual);
            toast.success("Referencia copiada");
          } catch (_) {
            toast.error("No se pudo copiar");
          }
        }}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700"
      >
        <Copy size={14} /> Copiar referencia
      </button>
    </div>
  );

  const renderAjustes = () => (
    <div className="space-y-6 pb-28">
      <h2 className="text-lg font-black text-white">Ajustes</h2>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
        <label className="text-xs font-black text-slate-300 uppercase tracking-wider">
          Referencia del socio
        </label>
        <p className="text-[10px] text-slate-500">
          Ingresa tu código FIEL para vincular esta app con tu cuenta.
        </p>
        <input
          value={refInput}
          onChange={e => setRefInput(e.target.value)}
          placeholder="FIEL-XXXXXX"
          className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-emerald-500 font-mono uppercase"
        />
        <button
          onClick={guardarRef}
          className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 transition-colors"
        >
          Guardar referencia
        </button>
      </div>

      {clienteActual && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-white">
            <User size={16} className="text-emerald-400" />
            <span className="text-sm font-bold">{clienteActual.nombre}</span>
          </div>
          {clienteActual.correo && <p className="text-xs text-slate-400">{clienteActual.correo}</p>}
          {clienteActual.telefono && <p className="text-xs text-slate-400">{clienteActual.telefono}</p>}
          <div className="pt-2 flex items-center gap-1 text-[10px] text-emerald-400 font-black uppercase">
            <BadgeCheck size={12} /> Cuenta verificada
          </div>
        </div>
      )}

      <button
        onClick={() => setDemoMode(m => !m)}
        className={`w-full py-2.5 rounded-xl text-xs font-black transition-colors ${
          demoMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-900 text-emerald-400 border border-slate-800 hover:bg-slate-800"
        }`}
      >
        {demoMode ? "Salir del modo demo" : "Ver datos de demostración"}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-slate-950 to-slate-950 text-white">
      <div className="max-w-md mx-auto px-4 pt-6 pb-28">
        {loading && !cliente ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
          </div>
        ) : !clienteActual && activeTab !== "ajustes" ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
            <AlertCircle size={48} className="text-amber-400" />
            <h2 className="text-lg font-black text-white">No se encontró el socio</h2>
            <p className="text-xs text-slate-400">
              Verifica tu referencia en Ajustes o crea tu cuenta en el POS.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[240px]">
              <button
                onClick={() => setActiveTab("ajustes")}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black"
              >
                Ir a Ajustes
              </button>
              <button
                onClick={() => setDemoMode(true)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 text-emerald-400 text-xs font-black border border-slate-700"
              >
                Ver demo
              </button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "inicio" && renderInicio()}
            {activeTab === "qr" && renderQR()}
            {activeTab === "ajustes" && renderAjustes()}
          </>
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-around px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] z-50">
        <NavButton
          active={activeTab === "inicio"}
          onClick={() => setActiveTab("inicio")}
          icon={<Home size={22} />}
          label="Inicio"
        />
        <button
          onClick={() => setActiveTab("qr")}
          className="relative -top-6 flex flex-col items-center justify-center w-16 h-16 rounded-full bg-emerald-500 text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.45)] border-4 border-slate-950 transition-transform active:scale-95"
        >
          <QrCode size={28} strokeWidth={2.5} />
          <span className="absolute -bottom-5 text-[8px] font-black uppercase tracking-wider text-emerald-400">
            QR
          </span>
        </button>
        <NavButton
          active={activeTab === "ajustes"}
          onClick={() => setActiveTab("ajustes")}
          icon={<Settings size={22} />}
          label="Ajustes"
        />
      </nav>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: ElementType; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-slate-900/60 border border-slate-800 hover:bg-slate-800 transition-colors active:scale-95"
    >
      <div className="h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400">
        <Icon size={20} />
      </div>
      <span className="text-[10px] font-black text-slate-300">{label}</span>
    </button>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 min-w-[64px] ${active ? "text-emerald-400" : "text-slate-400"}`}
    >
      {icon}
      <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
    </button>
  );
}
