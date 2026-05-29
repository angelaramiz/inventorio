import { useState, useEffect, useRef, FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ShoppingCart, Package, Trash2, Search, CheckCircle2, 
  Loader2, CreditCard, Tag, AlertCircle, RefreshCw, Scan, Camera, Power
} from "lucide-react";
import { toast } from "sonner";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

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

interface CartItem {
  producto_id: number;
  sku: string;
  talla: string;
  tipo: string;
  marca_sub: string;
  cantidad: number;
  precio_unitario: number;
  caja_origen_id?: number;
  caja_origen_nombre?: string;
  disponible: number;
}

export default function POSView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<any | null>(null);
  
  const [selectedBox, setSelectedBox] = useState<any | null>(null);
  const [sellQty, setSellQty] = useState<number | "">(1);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [vendedorId, setVendedorId] = useState("Vendedor 1");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [tipoSalida, setTipoSalida] = useState<"venta en pos" | "transferencia de tienda" | "transferencia a pdv">("venta en pos");

  // Camera scanner states
  const [isScannerActive, setIsScannerActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop();
          }
        } catch (e) {}
      }
    };
  }, []);

  const startScanner = async () => {
    try {
      setIsScannerActive(true);
      // Wait for DOM to update and render the #pos-reader element using waitForElement
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
        await waitForElement("pos-reader", 20, 50);
        const html5QrCode = new Html5Qrcode("pos-reader");
        scannerRef.current = html5QrCode;
        
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.CODE_128
            ]
          } as any,
          (decodedText) => {
            stopScanner();
            setSearchQuery(decodedText);
            triggerSearch(decodedText);
          },
          () => {}
        );
        toast.success("Escáner de POS activado");
      } catch (err) {
        toast.error("Error al iniciar cámara o elemento no renderizado");
        setIsScannerActive(false);
      }
    } catch (e) {
      setIsScannerActive(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        console.error("Failed to stop scanner in POS", err);
      }
      scannerRef.current = null;
    }
    setIsScannerActive(false);
  };

  const triggerSearch = async (query: string) => {
    setSearching(true);
    setSearchResult(null);
    setSelectedBox(null);
    setSellQty(1);

    try {
      const resp = await fetch(`/api/consultar-producto/${query}`);
      if (resp.ok) {
        const data = await resp.json();
        setSearchResult(data);
        if (data.boxes && data.boxes.length > 0) {
          setSelectedBox(data.boxes[0]);
        }
      } else {
        toast.error("Producto no encontrado en el inventario");
      }
    } catch (err) {
      toast.error("Error de conexión al buscar producto");
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    triggerSearch(searchQuery.trim());
  };

  const handleAddToCart = () => {
    if (!searchResult || !searchResult.product) return;
    const product = searchResult.product;

    if (!selectedBox) {
      toast.error("Selecciona una caja/contenedor de origen");
      return;
    }

    const finalQty = sellQty === "" ? 1 : sellQty;

    if (finalQty <= 0 || finalQty > selectedBox.cantidad) {
      toast.error(`Cantidad inválida. Máximo disponible: ${selectedBox.cantidad}`);
      return;
    }

    // Check if item already in cart for this same origin box
    const existingIndex = cart.findIndex(
      item => item.producto_id === product.id_producto && item.caja_origen_id === selectedBox.cajas.id_caja
    );

    const newQty = existingIndex !== -1 ? cart[existingIndex].cantidad + finalQty : finalQty;

    if (newQty > selectedBox.cantidad) {
      toast.error(`No puedes agregar más de la cantidad disponible en esta caja (${selectedBox.cantidad})`);
      return;
    }

    const cartItem: CartItem = {
      producto_id: product.id_producto,
      sku: product.sku,
      talla: product.talla,
      tipo: product.tipo,
      marca_sub: product.marca_sub,
      cantidad: finalQty,
      precio_unitario: 0,
      caja_origen_id: selectedBox.cajas.id_caja,
      caja_origen_nombre: selectedBox.cajas.numero_caja,
      disponible: selectedBox.cantidad
    };

    if (existingIndex !== -1) {
      setCart(prevCart => 
        prevCart.map((item, idx) => idx === existingIndex ? { ...item, cantidad: newQty } : item)
      );
    } else {
      setCart(prev => [...prev, cartItem]);
    }

    toast.success("Producto agregado a la salida");
    setSearchResult(null);
    setSearchQuery("");
  };

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, idx) => idx !== index));
    toast.info("Producto eliminado de la lista");
  };

  const calculateTotalUnits = () => {
    return cart.reduce((sum, item) => sum + item.cantidad, 0);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckoutLoading(true);

    try {
      const resp = await fetch("/api/pos/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart,
          vendedor_id: vendedorId,
          tipo_salida: tipoSalida
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        toast.success(`${tipoSalida === "venta en pos" ? "Venta" : tipoSalida === "transferencia a pdv" ? "Transferencia a PDV" : "Transferencia"} procesada con éxito! ID Registro: #${data.saleId}`);
        setCart([]);
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al realizar salida");
      }
    } catch (e) {
      toast.error("Error de conexión con el servidor");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Selector/Buscador y Formulario */}
      <div className="lg:col-span-3 space-y-6">
        <div className="bg-white p-5 md:p-6 rounded-3xl border border-neutral-100 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black uppercase text-neutral-900 leading-none">REGISTRO DE SALIDAS (POS)</h2>
              <p className="text-xs text-neutral-500 font-medium mt-1">Registra la salida física de prendas del almacén al piso de venta</p>
            </div>

            <div className="flex bg-neutral-100 p-1 rounded-2xl w-full sm:w-auto self-start sm:self-center">
              <button
                type="button"
                onClick={() => setTipoSalida("venta en pos")}
                className={`flex-1 sm:flex-initial text-center px-4 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 cursor-pointer ${
                  tipoSalida === "venta en pos"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                Venta en POS
              </button>
              <button
                type="button"
                onClick={() => setTipoSalida("transferencia de tienda")}
                className={`flex-1 sm:flex-initial text-center px-4 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 cursor-pointer ${
                  tipoSalida === "transferencia de tienda"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                Transferencia
              </button>
              <button
                type="button"
                onClick={() => setTipoSalida("transferencia a pdv")}
                className={`flex-1 sm:flex-initial text-center px-4 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 cursor-pointer ${
                  tipoSalida === "transferencia a pdv"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                Transferencia a PDV
              </button>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <span className="text-xs font-bold text-neutral-500 whitespace-nowrap">Vendedor Activo:</span>
            <select 
              value={vendedorId}
              onChange={e => setVendedorId(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 text-xs font-bold rounded-xl px-3 py-1 outline-none"
            >
              <option value="Vendedor 1">Vendedor 1 (Piso A)</option>
              <option value="Vendedor 2">Vendedor 2 (Piso B)</option>
              <option value="Administrador POS">Administrador POS</option>
            </select>
          </div>
        </div>

        {/* Buscador de SKU/EAN */}
        <Card className="border-none shadow-lg rounded-3xl overflow-hidden bg-white">
          <CardHeader className="bg-neutral-50 border-b pb-4">
            <CardTitle className="text-lg flex items-center gap-2 font-bold text-neutral-900">
              <Search size={18} className="text-neutral-500" />
              Buscador de Producto para Salida
            </CardTitle>
            <CardDescription className="text-neutral-500">
              Busca por SKU o EAN-13 para ubicar en qué cajas o estantes se encuentra stock
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input 
                placeholder="Escribe SKU o EAN-13 (ej: SKU-PANT-01)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="rounded-2xl h-11 border-neutral-200 focus-visible:ring-neutral-400"
                disabled={searching}
              />
              <Button 
                type="button"
                variant="outline"
                onClick={isScannerActive ? stopScanner : startScanner}
                className="rounded-2xl h-11 px-3 border-neutral-200 text-neutral-600 hover:text-neutral-900 shrink-0"
                title="Escanear producto con cámara"
              >
                <Scan size={18} />
              </Button>
              <Button type="submit" disabled={searching} className="rounded-2xl h-11 px-6 bg-neutral-900 text-white font-bold shrink-0">
                {searching ? <Loader2 className="animate-spin" size={18} /> : "Buscar"}
              </Button>
            </form>

            {isScannerActive && (
              <div className="relative rounded-2xl overflow-hidden border bg-neutral-900 aspect-[4/3] w-full flex flex-col shadow-inner justify-center items-center">
                <div id="pos-reader" className="w-full h-full object-cover" />
                <Button 
                  onClick={stopScanner}
                  variant="destructive"
                  size="sm"
                  className="absolute bottom-3 right-3 rounded-xl text-xs font-bold shadow-lg"
                >
                  Apagar Cámara
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detalles de Detección e Inventario por Caja */}
        {searchResult && (
          <Card className="border-none shadow-lg rounded-3xl overflow-hidden bg-white">
            <CardContent className="p-6 space-y-6">
              <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-neutral-100">
                {searchResult.product.has_foto ? (
                  <img 
                    src={`/api/productos/${searchResult.product.id_producto}/image`}
                    alt="Foto producto" 
                    className="w-24 h-24 object-cover rounded-2xl shadow-md border"
                  />
                ) : (
                  <div className="w-24 h-24 bg-neutral-50 border border-dashed rounded-2xl flex items-center justify-center text-neutral-400">
                    <Package size={36} />
                  </div>
                )}
                
                <div className="text-center sm:text-left space-y-1">
                  <h3 className="text-xl font-black text-neutral-900 uppercase tracking-tight">{searchResult.product.sku}</h3>
                  <p className="text-xs text-neutral-500 font-mono">EAN: {searchResult.product.ean_13 || "---"}</p>
                  <div className="flex gap-1.5 flex-wrap justify-center sm:justify-start pt-1">
                    <Badge variant="secondary" className="text-[10px] uppercase font-bold">{searchResult.product.tipo}</Badge>
                    <Badge variant="outline" className="text-[10px] uppercase font-bold">{searchResult.product.talla}</Badge>
                    <Badge variant="outline" className="text-[10px] uppercase font-bold">{searchResult.product.marca_sub}</Badge>
                  </div>
                </div>
              </div>

              {searchResult.boxes && searchResult.boxes.length > 0 ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-700 block">
                      Seleccionar Origen del Stock:
                    </label>
                    <select
                      value={selectedBox ? JSON.stringify(selectedBox) : ""}
                      onChange={e => setSelectedBox(e.target.value ? JSON.parse(e.target.value) : null)}
                      className="w-full rounded-2xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      {searchResult.boxes.map((b: any) => {
                        const pathText = `${b.cajas.almacen_nombre || "Sin almacén"}${b.cajas.pasillo_nombre && b.cajas.pasillo_nombre !== "Sin pasillo" ? ` > ${b.cajas.pasillo_nombre}` : ""}${b.cajas.seccion_nombre ? ` > ${b.cajas.seccion_nombre}` : ""}`;
                        return (
                          <option key={b.cajas.id_caja} value={JSON.stringify(b)}>
                            Caja {b.cajas.numero_caja} - Ubicación: {pathText} (Disponible: {b.cantidad})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-neutral-400 block">Cantidad a Retirar</label>
                    <Input 
                      type="number"
                      min={1}
                      max={selectedBox ? selectedBox.cantidad : 1}
                      value={sellQty}
                      onChange={e => {
                        const val = e.target.value;
                        setSellQty(val === "" ? "" : (parseInt(val) || 1));
                      }}
                      className="rounded-xl h-11 text-center font-bold"
                    />
                  </div>

                  <Button 
                    onClick={handleAddToCart}
                    className="w-full rounded-2xl h-12 bg-neutral-950 hover:bg-neutral-800 text-white font-bold text-sm gap-2"
                  >
                    <ShoppingCart size={18} /> Agregar a Lista de Salida
                  </Button>
                </div>
              ) : (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-center flex flex-col items-center justify-center text-amber-700 gap-2">
                  <AlertCircle size={32} />
                  <p className="font-semibold text-sm">Este producto no cuenta con stock físico en ninguna caja activa.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Ticket de Compra / Carrito */}
      <div className="lg:col-span-2">
        <Card className="border-none shadow-lg rounded-3xl overflow-hidden bg-neutral-900 text-white h-full flex flex-col min-h-[450px]">
          <CardHeader className="bg-neutral-950 border-b border-neutral-800 pb-4 shrink-0">
            <CardTitle className="text-lg flex items-center gap-2 font-bold uppercase">
              <ShoppingCart size={20} className="text-amber-400" />
              Salida de Inventario
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Resumen de prendas a retirar de inventario
            </CardDescription>
          </CardHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-20 text-neutral-500 text-center gap-3">
                <ShoppingCart size={40} className="opacity-25" />
                <p className="font-semibold text-sm">Lista de salida vacía</p>
                <p className="text-[11px] max-w-[200px]">Busca un producto y agrégalo para armar el registro de salida</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="bg-neutral-850 p-4 rounded-2xl border border-neutral-800 flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-black text-sm text-neutral-100 uppercase tracking-tight">{item.sku}</p>
                    <div className="flex gap-1 text-[9px] font-black uppercase text-neutral-400">
                      <span>{item.talla}</span> • <span>{item.marca_sub}</span>
                    </div>
                    {item.caja_origen_nombre && (
                      <span className="inline-block text-[9px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full mt-1">
                        Caja: {item.caja_origen_nombre}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right shrink-0">
                      <Badge className="bg-amber-400/10 text-amber-400 border border-amber-400/20 font-black text-xs px-2.5 py-1 rounded-lg">
                        {item.cantidad} {item.cantidad === 1 ? "unidad" : "unidades"}
                      </Badge>
                    </div>

                    <button 
                      onClick={() => removeFromCart(idx)}
                      className="text-rose-400 hover:text-rose-500 p-1 hover:bg-neutral-800 rounded-lg"
                      title="Eliminar ítem"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer del Ticket */}
          <div className="bg-neutral-950 border-t border-neutral-800 p-5 space-y-4 shrink-0">
            <div className="flex justify-between items-center">
              <span className="text-neutral-400 font-bold text-xs uppercase">Total Unidades:</span>
              <span className="text-2xl font-black text-amber-400">{calculateTotalUnits()} {calculateTotalUnits() === 1 ? "prenda" : "prendas"}</span>
            </div>

            <Button
              disabled={cart.length === 0 || checkoutLoading}
              onClick={handleCheckout}
              className="w-full rounded-2xl h-12 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black text-sm gap-2 shadow-lg shadow-amber-500/10"
            >
              {checkoutLoading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <CheckCircle2 size={18} /> {tipoSalida === "venta en pos" ? "Finalizar Venta (POS)" : tipoSalida === "transferencia a pdv" ? "Finalizar Transferencia a PDV" : "Finalizar Transferencia"}
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
