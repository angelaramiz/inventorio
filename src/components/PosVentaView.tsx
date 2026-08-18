import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "sonner";
import {
  ShoppingCart, Scan, User, Trash2, Plus, Minus, QrCode,
  CreditCard, Wallet, Banknote, Check, Receipt, Loader2, RefreshCw
} from "lucide-react";

interface CartItem {
  sku: string;
  modelo: string;
  color?: string;
  talla?: string;
  precio: number;
  cantidad: number;
}

const waitForElement = (id: string, maxAttempts = 10, interval = 100): Promise<HTMLElement> => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const el = document.getElementById(id);
      if (el) {
        resolve(el);
      } else if (attempts >= maxAttempts) {
        reject(new Error(`Element with id=${id} not found`));
      } else {
        attempts++;
        setTimeout(check, interval);
      }
    };
    check();
  });
};

interface ClienteInfo {
  ref: string;
  nombre: string;
  correo?: string;
  telefono?: string;
  saldo_monedero: number;
}

interface CompraRespuesta {
  id: string;
  total: number;
  metodo_pago: string;
  cambio_monedero: number;
  descuento_aplicado: number;
}

export default function PosVentaView() {
  const serverUrl = localStorage.getItem("serverUrl") || window.location.origin;

  // ── Estado principal ──
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cliente, setCliente] = useState<ClienteInfo | null>(null);
  const [clienteLoaded, setClienteLoaded] = useState(false);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualSku, setManualSku] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "wallet" | "tarjeta">("efectivo");
  const [efectivoRecibido, setEfectivoRecibido] = useState("");
  const [lastCompra, setLastCompra] = useState<CompraRespuesta | null>(null);
  const [showComprobante, setShowComprobante] = useState(false);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [selectedCoupon, setSelectedCoupon] = useState<string>("");
  const [discount, setDiscount] = useState(0);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerRegionId = "pos-barcode-region";
  const lastLookupRef = useRef<{ query: string; ts: number }>({ query: "", ts: 0 });

  // ── Total del carrito ──
  const subtotal = cart.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const total = Math.max(0, subtotal - discount);

  // ── Escáner de código de barras (productos) ──
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

  const lookupProduct = useCallback(async (query: string, fromScanner = false) => {
    const clean = query.trim();
    if (!clean) return;
    // Deduplicación/cooldown: misma query en los últimos 2.5s (evita toasts apilados por frames)
    const now = Date.now();
    if (lastLookupRef.current.query === clean && now - lastLookupRef.current.ts < 2500) {
      console.log("[POS] Búsqueda duplicada ignorada:", clean);
      return;
    }
    lastLookupRef.current = { query: clean, ts: now };
    console.log("[POS] Buscando producto:", clean);
    try {
      const data = await api(`/api/consultar-producto/${encodeURIComponent(clean)}`);
      // El endpoint devuelve { product: {...}, boxes, variantes }
      const producto = data?.product ?? data;
      console.log("[POS] Respuesta producto:", producto?.sku || producto?.modelo_grupo || "sin datos");
      if (!producto || (!producto.sku && !producto.modelo_grupo)) {
        if (fromScanner) setManualSku(clean);
        toast.error(`Producto no encontrado: ${clean}`);
        return;
      }
      const sku = producto.sku || producto.ean_13 || clean;
      const existing = cart.find(c => c.sku === sku);
      if (existing) {
        setCart(cart.map(c => c.sku === sku ? { ...c, cantidad: c.cantidad + 1 } : c));
        toast.success(`+1 ${producto.modelo_grupo || sku} (${existing.cantidad + 1})`);
      } else {
        setCart([...cart, {
          sku,
          modelo: producto.modelo_grupo || sku,
          color: producto.codigo_color || undefined,
          talla: producto.talla || undefined,
          precio: producto.precio || 0,
          cantidad: 1,
        }]);
        toast.success(`Agregado: ${producto.modelo_grupo || sku} — captura el precio`);
      }
    } catch (e: any) {
      console.error("[POS] Error buscando:", clean, "→", e.message);
      if (fromScanner) setManualSku(clean);
      toast.error(`Error buscando: ${e.message}`);
    }
  }, [api, cart]);

  const startScanner = async () => {
    if (isScannerActive) return;
    try {
      setIsScannerActive(true);
      const scanner = new Html5Qrcode(scannerRegionId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 100 } },
        (decodedText) => {
          console.log("[POS] Código de barras detectado:", decodedText);
          scanner.pause(true);
          lookupProduct(decodedText, true).then(() => {
            scanner.resume();
          });
        },
        () => {}
      );
    } catch (e) {
      toast.error("No se pudo iniciar la cámara");
      setIsScannerActive(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch (_) {}
      scannerRef.current.clear();
      scannerRef.current = null;
    }
    setIsScannerActive(false);
  };

  // ── Escaneo QR del cliente ──
  const [clientScanState, setClientScanState] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [clientScanError, setClientScanError] = useState("");
  const [clientVerifying, setClientVerifying] = useState(false);
  const clientScannerRef = useRef<Html5Qrcode | null>(null);
  const clientRegionId = "pos-client-qr-region";
  const isClientScannerActive = clientScanState === "scanning" || clientScanState === "starting";

  const loadCliente = useCallback(async (ref: string) => {
    console.log("[POS] Verificando cliente:", ref);
    setClientVerifying(true);
    try {
      const data = await api(`/api/loyalty/cliente/${encodeURIComponent(ref)}`);
      console.log("[POS] Cliente encontrado:", data.nombre, "saldo:", data.saldo_monedero);
      setCliente(data);
      setClienteLoaded(true);
      toast.success(`Cliente: ${data.nombre} (saldo: $${data.saldo_monedero})`);

      // Cargar cupones del cliente
      const cups = await api(`/api/loyalty/cliente/${encodeURIComponent(ref)}/cupones`);
      setCoupons(cups || []);
    } catch (e: any) {
      console.error("[POS] Cliente no encontrado:", e.message);
      toast.error(`Cliente no encontrado: ${e.message}`);
    } finally {
      setClientVerifying(false);
    }
  }, [api]);

  const extractRef = (decodedText: string): string | null => {
    // El QR contiene el ref (FIEL-XXXXXX), un JSON con {ref} o una URL con ?ref=
    const m = decodedText.match(/FIEL-[A-Z0-9]+/i);
    if (m) return m[0].toUpperCase();
    try {
      const json = JSON.parse(decodedText);
      if (json.ref) return String(json.ref).toUpperCase();
    } catch (_) {}
    const urlMatch = decodedText.match(/[?&]ref=([A-Z0-9-]+)/i);
    if (urlMatch) return urlMatch[1].toUpperCase();
    return null;
  };

  const startClientScanner = async () => {
    if (clientScanState === "scanning" || clientScanState === "starting") return;
    console.log("[POS] Iniciando escáner de cliente...");
    setClientScanState("starting");
    setClientScanError("");
    try {
      // Dejar que el div del visor se monte y sea visible antes de attachar la cámara
      await new Promise(resolve => setTimeout(resolve, 100));
      await waitForElement(clientRegionId, 20, 50);
      const scanner = new Html5Qrcode(clientRegionId);
      clientScannerRef.current = scanner;
      const startPromise = scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          console.log("[POS] QR de cliente detectado:", decodedText);
          // Detener cámara y limpiar estado ANTES de verificar
          await stopClientScanner();
          const ref = extractRef(decodedText);
          if (!ref) {
            console.warn("[POS] QR sin ref válida:", decodedText);
            toast.error("QR inválido: no contiene una ref FIEL válida");
            return;
          }
          toast.info(`QR detectado — verificando ${ref}...`);
          await loadCliente(ref);
        },
        () => {}
      );
      const startTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Tiempo agotado al iniciar cámara — ¿permiso denegado?")), 15000)
      );
      await Promise.race([startPromise, startTimeout]);
      setClientScanState("scanning");
      toast.success("Escáner de cliente activo — apunta al QR de membresía");
      console.log("[POS] Escáner de cliente activo");
    } catch (e: any) {
      console.error("[POS] Error al iniciar escáner de cliente:", e);
      setClientScanState("error");
      setClientScanError(e?.message || String(e));
      toast.error(`No se pudo iniciar el escáner de cliente: ${e?.message || ""}`);
    }
  };

  const stopClientScanner = async () => {
    if (clientScannerRef.current) {
      try { await clientScannerRef.current.stop(); } catch (_) {}
      try { clientScannerRef.current.clear(); } catch (_) {}
      clientScannerRef.current = null;
    }
    setClientScanState("idle");
  };

  // Watchdog: si la cámara murió silenciosamente, volver a idle (evita estado "scanning" sin visor)
  useEffect(() => {
    if (clientScanState !== "scanning") return;
    const id = setInterval(() => {
      const sc = clientScannerRef.current;
      if (sc && !sc.isScanning) {
        console.warn("[POS] Watchdog: cámara de cliente perdió escaneo");
        clearInterval(id);
        setClientScanState("idle");
        toast.warning("La cámara se detuvo — vuelve a iniciar el escáner");
      }
    }, 2000);
    return () => clearInterval(id);
  }, [clientScanState]);

  // ── Aplicar cupón ──
  const applyCoupon = (cuponId: string) => {
    const cupon = coupons.find(c => c.id === cuponId);
    if (!cupon) return;
    if (cupon.tipo === "porcentaje") {
      setDiscount(subtotal * (cupon.valor / 100));
      toast.success(`Cupón aplicado: ${cupon.valor}% OFF`);
    } else if (cupon.tipo === "fijo") {
      setDiscount(Math.min(cupon.valor, subtotal));
      toast.success(`Cupón aplicado: -$${cupon.valor}`);
    } else {
      toast.success("Cupón de envío gratis aplicado");
    }
  };

  // ── Finalizar venta ──
  const refrescarCliente = async (ref: string) => {
    try {
      const data = await api(`/api/loyalty/cliente/${encodeURIComponent(ref)}`);
      setCliente(data);
      console.log("[POS] Saldo actualizado del cliente:", data.saldo_monedero);
    } catch (_) {}
  };

  const checkout = async () => {
    if (cart.length === 0) { toast.error("Carrito vacío"); return; }
    setIsProcessing(true);
    try {
      // 1. Si es pago con tarjeta → enviar solicitud de pago al cliente
      if (paymentMethod === "tarjeta") {
        if (!cliente) { toast.error("Escanea el QR del cliente primero"); setIsProcessing(false); return; }
        const sol = await api("/api/loyalty/solicitar-pago", {
          method: "POST",
          body: JSON.stringify({ cliente_ref: cliente.ref, monto: total, concepto: "Compra en AURA Boutique" }),
        });
        toast.info(`Solicitud de pago enviada al cliente. Esperando aprobación... (${sol.id.slice(0, 8)})`, { duration: 8000 });

        // 2. Poll hasta que el cliente apruebe (máx 3 min)
        const pollInterval = setInterval(async () => {
          try {
            const sols = await api(`/api/loyalty/cliente/${cliente.ref}/solicitudes-pago`);
            const completed = !sols.some((s: any) => s.id === sol.id);
            if (completed) {
              clearInterval(pollInterval);
              // 3. Registrar la compra
              const compra = await api("/api/loyalty/compras", {
                method: "POST",
                body: JSON.stringify({
                  cliente_ref: cliente.ref,
                  productos: cart.map(c => ({ sku: c.sku, modelo: c.modelo, talla: c.talla, cantidad: c.cantidad, precio: c.precio })),
                  metodo_pago: "tarjeta",
                  cupon_id: selectedCoupon || undefined,
                }),
              });
              setLastCompra(compra);
              setShowComprobante(true);
              setCart([]);
              setDiscount(0);
              setSelectedCoupon("");
              toast.success("Venta completada");
              if (cliente) refrescarCliente(cliente.ref);
              stopPolling(clearInterval, pollInterval);
            }
          } catch (_) {}
        }, 4000);

        // Timeout de 3 minutos
        setTimeout(() => {
          clearInterval(pollInterval);
          toast.error("Tiempo de espera agotado. El cliente no aprobó el pago.");
        }, 180000);

        setIsProcessing(false);
        return;
      }

      // 2. Efectivo con cambio → monedero
      if (paymentMethod === "efectivo" && cliente) {
        const recibido = parseFloat(efectivoRecibido) || 0;
        const cambio = recibido - total;
        if (cambio > 0) {
          // El cambio se va al monedero del cliente
          await api("/api/loyalty/recargar-monedero", {
            method: "POST",
            body: JSON.stringify({ cliente_ref: cliente.ref, monto: cambio }),
          });
          toast.info(`💰 Cambio de $${cambio.toFixed(2)} agregado al monedero del cliente`);
        }
      }

      // 3. Pago con monedero (wallet)
      if (paymentMethod === "wallet") {
        if (!cliente) { toast.error("Escanea el QR del cliente primero"); setIsProcessing(false); return; }
        if (cliente.saldo_monedero < total) { toast.error("Saldo insuficiente en monedero"); setIsProcessing(false); return; }
      }

      // 4. Registrar compra
      const compra = await api("/api/loyalty/compras", {
        method: "POST",
        body: JSON.stringify({
          cliente_ref: cliente?.ref,
          productos: cart.map(c => ({ sku: c.sku, modelo: c.modelo, talla: c.talla, cantidad: c.cantidad, precio: c.precio })),
          metodo_pago: paymentMethod,
          cupon_id: selectedCoupon || undefined,
        }),
      });

      setLastCompra(compra);
      setShowComprobante(true);
      setCart([]);
      setDiscount(0);
      setSelectedCoupon("");
      toast.success("Venta completada");
      if (cliente) refrescarCliente(cliente.ref);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const stopPolling = (clear: (id: any) => void, id: any) => clear(id);

  // Cleanup al desmontar
  useEffect(() => {
    return () => { stopScanner(); stopClientScanner(); };
  }, []);

  // ── UI ──
  return (
    <div className="max-w-7xl mx-auto px-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
            <ShoppingCart size={28} className="text-purple-600" />
            Punto de Venta
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Simulación de venta — no modifica stock
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setLastCompra(null); setShowComprobante(false); }}
            className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-sm font-bold hover:bg-neutral-800"
          >
            <RefreshCw size={14} className="inline mr-1" /> Nueva venta
          </button>
        </div>
      </div>

      {/* Comprobante */}
      {showComprobante && lastCompra && (
        <div className="mb-6 p-6 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <div className="flex items-center gap-3 mb-4">
            <Check size={24} className="text-emerald-600" />
            <div>
              <h2 className="font-black text-emerald-800">Venta completada</h2>
              <p className="text-xs text-emerald-600">Compra: {lastCompra.id}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-3 rounded-xl border border-emerald-200">
              <p className="text-[10px] text-neutral-500 uppercase">Total</p>
              <p className="font-black text-emerald-700">${lastCompra.total.toFixed(2)}</p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-emerald-200">
              <p className="text-[10px] text-neutral-500 uppercase">Método</p>
              <p className="font-bold text-neutral-800">{lastCompra.metodo_pago}</p>
            </div>
            {lastCompra.cambio_monedero > 0 && (
              <div className="bg-white p-3 rounded-xl border border-emerald-200">
                <p className="text-[10px] text-neutral-500 uppercase">Cambio a monedero</p>
                <p className="font-black text-purple-600">${lastCompra.cambio_monedero.toFixed(2)}</p>
              </div>
            )}
            {lastCompra.descuento_aplicado > 0 && (
              <div className="bg-white p-3 rounded-xl border border-emerald-200">
                <p className="text-[10px] text-neutral-500 uppercase">Descuento</p>
                <p className="font-black text-orange-500">-${lastCompra.descuento_aplicado.toFixed(2)}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-emerald-600 mt-4">
            La factura se generará automáticamente y estará disponible en la app del cliente (Historial → Facturas).
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Columna izquierda: escáner + cliente ── */}
        <div className="space-y-6">
          {/* Escáner de productos */}
          <div className="bg-white p-4 rounded-2xl border border-neutral-200">
            <h2 className="text-sm font-black text-neutral-900 mb-3 flex items-center gap-2">
              <Scan size={16} className="text-purple-600" />
              Escanear Producto
            </h2>
            <div id={scannerRegionId} className={isScannerActive ? "w-full rounded-xl overflow-hidden" : "hidden"} />
            <button
              onClick={isScannerActive ? stopScanner : startScanner}
              className={`w-full mt-2 py-3 rounded-xl text-sm font-bold transition-colors ${
                isScannerActive ? "bg-red-500 text-white hover:bg-red-600" : "bg-purple-600 text-white hover:bg-purple-700"
              }`}
            >
              {isScannerActive ? "Detener cámara" : "Iniciar escáner de productos"}
            </button>
            <div className="flex gap-2 mt-2">
              <input
                value={manualSku}
                onChange={e => setManualSku(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { lookupProduct(manualSku); setManualSku(""); } }}
                placeholder="SKU manual (Enter para buscar)"
                className="flex-1 px-3 py-2 rounded-lg border border-neutral-300 text-sm"
              />
              <button onClick={() => { lookupProduct(manualSku); setManualSku(""); }} className="px-3 py-2 bg-neutral-900 text-white rounded-lg text-xs font-bold">
                Buscar
              </button>
            </div>
          </div>

          {/* Cliente */}
          <div className="bg-white p-4 rounded-2xl border border-neutral-200">
            <h2 className="text-sm font-black text-neutral-900 mb-3 flex items-center gap-2">
              <User size={16} className="text-purple-600" />
              Cliente
            </h2>
            {clienteLoaded && cliente ? (
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                <p className="font-bold text-neutral-900">{cliente.nombre}</p>
                <p className="text-xs text-neutral-500">{cliente.ref}</p>
                <p className="text-sm font-black text-purple-700 mt-1">💰 ${cliente.saldo_monedero.toFixed(2)}</p>
                <button onClick={() => { setCliente(null); setClienteLoaded(false); setCoupons([]); }} className="text-[11px] text-red-500 mt-2 underline">
                  Quitar cliente
                </button>
              </div>
            ) : (
              <div>
                <div id={clientRegionId} className={isClientScannerActive ? "w-full rounded-xl overflow-hidden" : "hidden"} />

                {clientVerifying && (
                  <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl p-3 mb-2">
                    <Loader2 size={16} className="animate-spin text-purple-600" />
                    <p className="text-xs font-bold text-purple-700">Verificando cliente en la base de datos...</p>
                  </div>
                )}

                {clientScanState === "error" && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-2">
                    <p className="text-[11px] font-bold text-red-700">Error al iniciar la cámara</p>
                    <p className="text-[10px] text-red-500 mt-0.5 break-words">{clientScanError}</p>
                  </div>
                )}

                <button
                  onClick={clientScanState === "scanning" || clientScanState === "starting" ? stopClientScanner : startClientScanner}
                  disabled={clientScanState === "starting"}
                  className={`w-full py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-60 ${
                    clientScanState === "scanning" ? "bg-red-500 text-white hover:bg-red-600"
                    : clientScanState === "error" ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-neutral-900 text-white hover:bg-neutral-800"
                  }`}
                >
                  {clientScanState === "starting" ? (
                    <><Loader2 size={16} className="inline animate-spin mr-2" />Iniciando cámara...</>
                  ) : clientScanState === "scanning" ? (
                    <><QrCode size={16} className="inline mr-2" />Detener</>
                  ) : clientScanState === "error" ? (
                    <><QrCode size={16} className="inline mr-2" />Reintentar</>
                  ) : (
                    <><QrCode size={16} className="inline mr-2" />Escanear QR del cliente</>
                  )}
                </button>
                <p className="text-[11px] text-neutral-400 mt-2 text-center">
                  El cliente muestra su QR de membresía en la app AURA Club
                </p>
              </div>
            )}
          </div>

          {/* Cupones del cliente */}
          {cliente && coupons.length > 0 && (
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <h2 className="text-sm font-black text-neutral-900 mb-2">🎟️ Cupones del cliente</h2>
              <select
                value={selectedCoupon}
                onChange={e => { setSelectedCoupon(e.target.value); applyCoupon(e.target.value); }}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
              >
                <option value="">Sin cupón</option>
                {coupons.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.descripcion} ({c.tipo === "porcentaje" ? `${c.valor}%` : `$${c.valor}`})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Columna derecha: carrito + pago ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Carrito */}
          <div className="bg-white p-4 rounded-2xl border border-neutral-200">
            <h2 className="text-sm font-black text-neutral-900 mb-3 flex items-center gap-2">
              <ShoppingCart size={16} className="text-purple-600" />
              Carrito ({cart.length})
            </h2>
            {cart.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 text-sm">
                Escanea productos para agregarlos al carrito
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item, idx) => (
                  <div key={`${item.sku}-${idx}`} className="flex items-center gap-3 bg-neutral-50 rounded-xl p-3 border border-neutral-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{item.modelo}</p>
                      <p className="text-[11px] text-neutral-500">
                        {item.sku} {item.talla ? `· Talla ${item.talla}` : ""} {item.color ? `· ${item.color}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold text-neutral-400">$</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.precio}
                        onChange={e => setCart(cart.map(c => c.sku === item.sku ? { ...c, precio: parseFloat(e.target.value) || 0 } : c))}
                        className="w-20 px-2 py-1 rounded-lg border border-neutral-300 text-sm font-bold text-right outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCart(cart.map(c => c.sku === item.sku && c.cantidad > 1 ? { ...c, cantidad: c.cantidad - 1 } : c))} className="w-7 h-7 bg-white border rounded-lg flex items-center justify-center">
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center font-bold text-sm">{item.cantidad}</span>
                      <button onClick={() => setCart(cart.map(c => c.sku === item.sku ? { ...c, cantidad: c.cantidad + 1 } : c))} className="w-7 h-7 bg-white border rounded-lg flex items-center justify-center">
                        <Plus size={12} />
                      </button>
                    </div>
                    <button onClick={() => setCart(cart.filter(c => c.sku !== item.sku))} className="text-red-400 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pago */}
          <div className="bg-white p-4 rounded-2xl border border-neutral-200">
            <h2 className="text-sm font-black text-neutral-900 mb-3">💳 Método de pago</h2>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {([
                { key: "efectivo", label: "Efectivo", icon: Banknote },
                { key: "wallet", label: "Monedero", icon: Wallet },
                { key: "tarjeta", label: "Tarjeta", icon: CreditCard },
              ] as const).map(m => (
                <button
                  key={m.key}
                  onClick={() => setPaymentMethod(m.key)}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    paymentMethod === m.key ? "border-purple-500 bg-purple-50" : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <m.icon size={20} className={`mx-auto mb-1 ${paymentMethod === m.key ? "text-purple-600" : "text-neutral-400"}`} />
                  <p className="text-xs font-bold">{m.label}</p>
                </button>
              ))}
            </div>

            {paymentMethod === "efectivo" && (
              <div className="mb-4">
                <label className="text-xs font-bold text-neutral-600">Efectivo recibido</label>
                <input
                  type="number"
                  value={efectivoRecibido}
                  onChange={e => setEfectivoRecibido(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-neutral-300 text-lg font-black"
                />
                {parseFloat(efectivoRecibido) > total && (
                  <p className="text-xs text-purple-600 mt-1 font-bold">
                    Cambio: ${(parseFloat(efectivoRecibido) - total).toFixed(2)} — se agregará al monedero del cliente
                  </p>
                )}
              </div>
            )}

            {paymentMethod === "tarjeta" && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                Se enviará una solicitud de pago a la app del cliente. El cliente elegirá su tarjeta y aprobará el pago.
              </div>
            )}

            {paymentMethod === "wallet" && !cliente && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                Escanea el QR del cliente para pagar con monedero
              </div>
            )}

            {/* Totales */}
            <div className="border-t pt-4 space-y-1">
              <div className="flex justify-between text-sm text-neutral-500">
                <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-sm text-orange-500 font-bold">
                  <span>Descuento</span><span>-${discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-black">
                <span>Total</span><span>${total.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={checkout}
              disabled={isProcessing || cart.length === 0}
              className="w-full mt-4 py-4 rounded-xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {isProcessing ? "Procesando..." : `Cobrar $${total.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
