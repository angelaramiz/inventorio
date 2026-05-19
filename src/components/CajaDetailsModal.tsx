import { useState, useEffect, FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Box, Package, Image as ImageIcon, Loader2, Plus, Edit2, Barcode } from "lucide-react";
import { Caja, CajaProducto } from "../types";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  caja: Caja;
  onClose: () => void;
}

export default function CajaDetailsModal({ caja, onClose }: Props) {
  const [productos, setProductos] = useState<CajaProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [skuInput, setSkuInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [boxSku, setBoxSku] = useState(caja.sku || "");
  const [isEditingSku, setIsEditingSku] = useState(!caja.sku);
  const [isSavingSku, setIsSavingSku] = useState(false);

  const handleSaveBoxSku = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingSku(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: boxSku })
      });
      if (resp.ok) {
        toast.success("SKU de la caja actualizado");
        caja.sku = boxSku.trim() === "" ? undefined : boxSku.trim();
        setIsEditingSku(false);
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar SKU de la caja");
      }
    } catch (err) {
      toast.error("Error al actualizar SKU");
    } finally {
      setIsSavingSku(false);
    }
  };

  useEffect(() => {
    fetchProductos();
  }, [caja.id_caja]);

  const fetchProductos = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}/productos`);
      const data = await resp.json();
      setProductos(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProductBySku = async (e: FormEvent) => {
    e.preventDefault();
    if (!skuInput.trim()) return;

    setIsAdding(true);
    const query = skuInput.trim();
    try {
      // 1. Verificar si el producto existe
      const verifyResp = await fetch(`/api/verificar/${query}`);
      const verifyData = await verifyResp.json();

      if (!verifyData.exists) {
        toast.error("Producto no encontrado. Regístralo primero en la sección de Productos.");
        setIsAdding(false);
        return;
      }

      const id_producto = verifyData.product.id_producto;

      // 2. Si ya está en otra caja activa, advertir al usuario y confirmar traslado
      let force = false;
      if (verifyData.ubicacion && verifyData.ubicacion.id_caja !== caja.id_caja && verifyData.ubicacion.estado !== "vacia") {
        const confirmMove = window.confirm(
          `El producto ya está en la Caja ${verifyData.ubicacion.numero_caja} (${verifyData.ubicacion.estado}). ¿Deseas moverlo a esta caja?`
        );
        if (!confirmMove) {
          setIsAdding(false);
          return;
        }
        force = true;
      }

      // 3. Asignar el producto a la caja
      const assignResp = await fetch(`/api/cajas/${caja.id_caja}/asignar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_producto, force })
      });

      if (assignResp.ok) {
        toast.success("Producto asociado con éxito");
        setSkuInput("");
        fetchProductos(); // Recargar la lista
      } else {
        const errData = await assignResp.json();
        toast.error(errData.error || "Error al asociar producto");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    } finally {
      setIsAdding(false);
    }
  };

  const totalUnidades = loading ? (caja.total_unidades || 0) : productos.reduce((sum, item) => sum + item.cantidad, 0);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl sm:max-w-3xl gap-0 h-[80vh] flex flex-col p-0 border-none rounded-2xl overflow-hidden shadow-2xl">
        <DialogHeader className="bg-neutral-900 text-white p-6 shrink-0">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="bg-white/10 p-3 rounded-xl">
                <Box size={32} />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black tracking-tight">CAJA {caja.numero_caja}</DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 border-none uppercase text-[10px]">{caja.estado}</Badge>
                  <span className="text-neutral-400 text-xs">{totalUnidades} unidades totales</span>
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Formulario de SKU de la Caja Contenedora (al tope de la modal) */}
          <div className="p-6 pb-4 border-b bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div>
              <h3 className="font-bold text-neutral-900 flex items-center gap-2 text-sm">
                <Barcode size={16} className="text-neutral-500" /> Código SKU de la Caja
              </h3>
              <p className="text-[11px] text-neutral-500">Asocia el código de barras físico del contenedor</p>
            </div>
            
            {isEditingSku ? (
              <form onSubmit={handleSaveBoxSku} className="flex gap-2 w-full sm:w-auto">
                <Input 
                  placeholder="Escanea o escribe SKU de la caja" 
                  value={boxSku}
                  onChange={(e) => setBoxSku(e.target.value)}
                  className="bg-white rounded-xl text-sm h-10 w-full sm:w-60 focus-visible:ring-neutral-400"
                  disabled={isSavingSku}
                />
                <Button type="submit" disabled={isSavingSku} className="rounded-xl h-10 bg-neutral-900 text-sm whitespace-nowrap px-4 text-white font-semibold">
                  {isSavingSku ? <Loader2 className="animate-spin" size={16} /> : "Guardar"}
                </Button>
                {caja.sku && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setBoxSku(caja.sku || "");
                      setIsEditingSku(false);
                    }}
                    className="rounded-xl h-10 text-sm"
                  >
                    Cancelar
                  </Button>
                )}
              </form>
            ) : (
              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end bg-white px-4 py-1.5 rounded-xl border">
                <span className="font-mono text-sm font-bold text-neutral-900">{boxSku}</span>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => setIsEditingSku(true)}
                  className="h-8 w-8 rounded-lg hover:bg-neutral-100"
                >
                  <Edit2 size={14} className="text-neutral-600" />
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-400">
                <Loader2 className="animate-spin mb-2" size={32} />
                <p className="font-medium">Cargando inventario de caja...</p>
              </div>
            ) : productos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-400 border-2 border-dashed rounded-3xl p-8">
                <Package size={48} strokeWidth={1} className="mb-4 opacity-20" />
                <p className="font-semibold">Esta caja está vacía</p>
                <p className="text-sm">Asocia productos arriba o usa el Escáner para empezar a llenarla</p>
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden overflow-x-auto w-full">
                <Table>
                  <TableHeader className="bg-neutral-50/50">
                    <TableRow>
                      <TableHead className="w-[80px]">Foto</TableHead>
                      <TableHead>Producto (SKU)</TableHead>
                      <TableHead>Detalles</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productos.map((item) => (
                      <TableRow key={item.id_producto} className="group hover:bg-neutral-50/50">
                        <TableCell>
                          {item.productos.has_foto ? (
                            <img 
                              src={`/api/productos/${item.id_producto}/image`}
                              alt="Producto" 
                              loading="lazy"
                              className="w-12 h-12 object-cover rounded-lg shadow-sm border" 
                            />
                          ) : (
                            <div className="w-12 h-12 bg-neutral-100 flex items-center justify-center rounded-lg border text-neutral-400">
                              <ImageIcon size={18} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-neutral-900">{item.productos.sku}</span>
                            <span className="text-xs text-neutral-500 font-mono">{item.productos.ean_13}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1.5 flex-wrap">
                            <Badge variant="secondary" className="text-[10px] uppercase font-bold">{item.productos.tipo}</Badge>
                            <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">{item.productos.talla}</Badge>
                            <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">{item.productos.temporada}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-black text-lg">
                          <span className="bg-neutral-100 px-3 py-1 rounded-lg border">{item.cantidad}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Formulario de Asociación Manual de Productos (al fondo de la modal) */}
          <div className="p-6 pt-4 pb-6 border-t bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div>
              <h3 className="font-bold text-neutral-900 flex items-center gap-2 text-sm">
                <Plus size={16} /> Asociar Producto Existente
              </h3>
              <p className="text-[11px] text-neutral-500">Ingresa el SKU o EAN-13 para agregarlo a esta caja</p>
            </div>
            <form onSubmit={handleAddProductBySku} className="flex gap-2 w-full sm:w-auto">
              <Input 
                placeholder="SKU o EAN-13" 
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                className="bg-white rounded-xl text-sm h-10 w-full sm:w-60 focus-visible:ring-neutral-400"
                disabled={isAdding}
              />
              <Button type="submit" disabled={isAdding || !skuInput.trim()} className="rounded-xl h-10 bg-neutral-900 text-sm whitespace-nowrap px-4 text-white font-semibold">
                {isAdding ? <Loader2 className="animate-spin" size={16} /> : "Agregar"}
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
