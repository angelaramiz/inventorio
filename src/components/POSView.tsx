import { useState, useEffect, FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ShoppingCart, Package, Trash2, Search, CheckCircle2, 
  Loader2, CreditCard, Tag, AlertCircle, RefreshCw 
} from "lucide-react";
import { toast } from "sonner";

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
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(500); // Default price for fashion items, fully editable

  const [cart, setCart] = useState<CartItem[]>([]);
  const [vendedorId, setVendedorId] = useState("Vendedor 1");
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResult(null);
    setSelectedBox(null);
    setSellQty(1);

    try {
      const resp = await fetch(`/api/consultar-producto/${searchQuery.trim()}`);
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

  const handleAddToCart = () => {
    if (!searchResult || !searchResult.product) return;
    const product = searchResult.product;

    if (!selectedBox) {
      toast.error("Selecciona una caja/contenedor de origen");
      return;
    }

    if (sellQty <= 0 || sellQty > selectedBox.cantidad) {
      toast.error(`Cantidad inválida. Máximo disponible: ${selectedBox.cantidad}`);
      return;
    }

    // Check if item already in cart for this same origin box
    const existingIndex = cart.findIndex(
      item => item.producto_id === product.id_producto && item.caja_origen_id === selectedBox.cajas.id_caja
    );

    const newQty = existingIndex !== -1 ? cart[existingIndex].cantidad + sellQty : sellQty;

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
      cantidad: sellQty,
      precio_unitario: sellPrice,
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

    toast.success("Producto agregado al carrito de venta");
    setSearchResult(null);
    setSearchQuery("");
  };

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, idx) => idx !== index));
    toast.info("Producto eliminado del carrito");
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + (item.cantidad * item.precio_unitario), 0);
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
          vendedor_id: vendedorId
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        toast.success(`Venta procesada con éxito! ID Transacción: #${data.saleId}`);
        setCart([]);
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al realizar venta");
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
          <div>
            <h2 className="text-2xl font-black uppercase text-neutral-900 leading-none">PUNTO DE VENTA (POS)</h2>
            <p className="text-xs text-neutral-500 font-medium mt-1">Registra transacciones de salida a piso de venta</p>
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
          <CardContent className="pt-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input 
                placeholder="Escribe SKU o EAN-13 (ej: SKU-PANT-01)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="rounded-2xl h-11 border-neutral-200 focus-visible:ring-neutral-400"
                disabled={searching}
              />
              <Button type="submit" disabled={searching} className="rounded-2xl h-11 px-6 bg-neutral-900 text-white font-bold shrink-0">
                {searching ? <Loader2 className="animate-spin" size={18} /> : "Buscar"}
              </Button>
            </form>
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
                      {searchResult.boxes.map((b: any) => (
                        <option key={b.cajas.id_caja} value={JSON.stringify(b)}>
                          Caja {b.cajas.numero_caja} - Ubicación: {b.cajas.almacen_nombre || "Sin almacén"} {b.cajas.seccion_nombre ? `| ${b.cajas.seccion_nombre}` : ""} (Disponible: {b.cantidad})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-neutral-400 block">Precio Unitario ($)</label>
                      <Input 
                        type="number"
                        min={0}
                        value={sellPrice}
                        onChange={e => setSellPrice(parseFloat(e.target.value) || 0)}
                        className="rounded-xl h-11 text-center font-bold"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-neutral-400 block">Cantidad a Vender</label>
                      <Input 
                        type="number"
                        min={1}
                        max={selectedBox ? selectedBox.cantidad : 1}
                        value={sellQty}
                        onChange={e => setSellQty(parseInt(e.target.value) || 1)}
                        className="rounded-xl h-11 text-center font-bold"
                      />
                    </div>
                  </div>

                  <Button 
                    onClick={handleAddToCart}
                    className="w-full rounded-2xl h-12 bg-neutral-950 hover:bg-neutral-800 text-white font-bold text-sm gap-2"
                  >
                    <ShoppingCart size={18} /> Agregar a Ticket
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
              Ticket de Salida
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Resumen de prendas a retirar de inventario
            </CardDescription>
          </CardHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-20 text-neutral-500 text-center gap-3">
                <ShoppingCart size={40} className="opacity-25" />
                <p className="font-semibold text-sm">Carrito vacío</p>
                <p className="text-[11px] max-w-[200px]">Busca un producto y agrégalo para armar el ticket de venta</p>
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
                      <p className="text-xs text-neutral-400 font-bold">{item.cantidad} x ${item.precio_unitario}</p>
                      <p className="text-sm font-black text-emerald-400">${item.cantidad * item.precio_unitario}</p>
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
              <span className="text-neutral-400 font-bold text-xs uppercase">Total Venta:</span>
              <span className="text-2xl font-black text-emerald-400">${calculateSubtotal()}</span>
            </div>

            <Button
              disabled={cart.length === 0 || checkoutLoading}
              onClick={handleCheckout}
              className="w-full rounded-2xl h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm gap-2"
            >
              {checkoutLoading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <CreditCard size={18} /> Finalizar Salida
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
