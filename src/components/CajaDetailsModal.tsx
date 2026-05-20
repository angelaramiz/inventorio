import React, { useState, useEffect, FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Box, Package, Image as ImageIcon, Loader2, Plus, Edit2, Barcode, ArrowLeftRight, Trash2, Calendar } from "lucide-react";
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
  const [qtyInput, setQtyInput] = useState(1);
  const [cajaTemporada, setCajaTemporada] = useState(caja.temporada_default || "");
  const [isSavingTemporada, setIsSavingTemporada] = useState(false);
  const [temporadasOpts, setTemporadasOpts] = useState<string[]>([]);

  // Locations states
  const [zones, setZones] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  
  const getInitialLocationValue = () => {
    if ((caja as any).id_zona_seccion) {
      return `section_${(caja as any).id_zona_seccion}`;
    }
    if ((caja as any).id_zona_almacen) {
      return `zone_${(caja as any).id_zona_almacen}`;
    }
    return "";
  };

  const [selectedValue, setSelectedValue] = useState<string>(getInitialLocationValue());

  // Product transfer states
  const [transferringItem, setTransferringItem] = useState<CajaProducto | null>(null);
  const [transferTargetBoxId, setTransferTargetBoxId] = useState<string>("");
  const [transferQty, setTransferQty] = useState<number>(1);
  const [isTransferring, setIsTransferring] = useState(false);
  const [allBoxes, setAllBoxes] = useState<Caja[]>([]);

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

  const handleSaveLocation = async (val: string) => {
    let id_zona_seccion = null;
    let id_zona_almacen = null;
    if (val.startsWith("section_")) {
      id_zona_seccion = parseInt(val.replace("section_", ""));
    } else if (val.startsWith("zone_")) {
      id_zona_almacen = parseInt(val.replace("zone_", ""));
    }

    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_zona_seccion, id_zona_almacen })
      });
      if (resp.ok) {
        toast.success("Ubicación física actualizada");
        (caja as any).id_zona_seccion = id_zona_seccion;
        (caja as any).id_zona_almacen = id_zona_almacen;
        
        // Update local object text representation
        if (id_zona_seccion) {
          const sec = sections.find(s => s.id_zona_seccion === id_zona_seccion);
          (caja as any).seccion_nombre = sec ? sec.nombre : "";
          (caja as any).almacen_nombre = sec ? sec.almacen_nombre : "";
        } else if (id_zona_almacen) {
          const zo = zones.find(z => z.id_zona_almacen === id_zona_almacen);
          (caja as any).seccion_nombre = "";
          (caja as any).almacen_nombre = zo ? zo.nombre : "";
        } else {
          (caja as any).seccion_nombre = "";
          (caja as any).almacen_nombre = "";
        }

        setSelectedValue(val);
      } else {
        toast.error("Error al actualizar la ubicación");
      }
    } catch (e) {
      toast.error("Error al conectar con el servidor");
    }
  };

  const fetchBoxesForTransfer = async () => {
    try {
      const resp = await fetch("/api/cajas");
      if (resp.ok) {
        const data = await resp.json();
        setAllBoxes(data.filter((b: any) => b.id_caja !== caja.id_caja));
      }
    } catch (e) {}
  };

  const startTransfer = (item: CajaProducto) => {
    setTransferringItem(item);
    setTransferTargetBoxId("");
    setTransferQty(1);
    fetchBoxesForTransfer();
  };

  const handleExecuteTransfer = async (e: FormEvent) => {
    e.preventDefault();
    if (!transferringItem || !transferTargetBoxId || transferQty <= 0) return;
    
    setIsTransferring(true);
    try {
      const resp = await fetch("/api/transferir-producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_caja_origen: caja.id_caja,
          id_caja_destino: parseInt(transferTargetBoxId),
          id_producto: transferringItem.id_producto,
          cantidad: transferQty
        })
      });
      if (resp.ok) {
        toast.success("Producto transferido con éxito");
        setTransferringItem(null);
        fetchProductos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al transferir");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setIsTransferring(false);
    }
  };

  useEffect(() => {
    fetchProductos();
    fetchLocations();
    fetchTemporadas();
  }, [caja.id_caja]);

  const fetchLocations = async () => {
    try {
      const [zonesResp, sectionsResp] = await Promise.all([
        fetch("/api/almacen/zonas"),
        fetch("/api/almacen/secciones")
      ]);
      if (zonesResp.ok && sectionsResp.ok) {
        const [zonesData, sectionsData] = await Promise.all([
          zonesResp.json(),
          sectionsResp.json()
        ]);
        setZones(zonesData);
        setSections(sectionsData);
      }
    } catch (err) {
      console.error("Error fetching locations:", err);
    }
  };

  const fetchTemporadas = async () => {
    try {
      const resp = await fetch("/api/conceptos/temporadas");
      if (resp.ok) {
        const data = await resp.json();
        setTemporadasOpts(data.map((v: any) => typeof v === 'object' ? v.nombre : v));
      }
    } catch (err) {
      console.error("Error fetching temporadas:", err);
    }
  };

  const handleSaveTemporada = async () => {
    setIsSavingTemporada(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temporada_default: cajaTemporada || null })
      });
      if (resp.ok) {
        toast.success(cajaTemporada ? `Temporada "${cajaTemporada}" asignada a la caja` : "Temporada por defecto eliminada");
        caja.temporada_default = cajaTemporada || null;
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar la temporada");
      }
    } catch (err) {
      toast.error("Error al conectar con el servidor");
    } finally {
      setIsSavingTemporada(false);
    }
  };

  const handleDeleteCaja = async () => {
    const confirmMsg = `¿Estás seguro de que deseas eliminar la caja "${caja.numero_caja}"? Se desvincularán todos sus productos.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        toast.success(`Caja "${caja.numero_caja}" eliminada con éxito`);
        const saved = localStorage.getItem("activeCaja");
        if (saved) {
          const activeCaja = JSON.parse(saved);
          if (activeCaja.id_caja === caja.id_caja) {
            localStorage.removeItem("activeCaja");
          }
        }
        onClose();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al eliminar la caja");
      }
    } catch (err) {
      toast.error("Error de conexión al eliminar la caja");
    }
  };

  const fetchProductos = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}/productos`);
      const data = await resp.json();
      setProductos(data);
    } catch (err) {
      toast.error("Error al cargar productos de la caja");
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
        body: JSON.stringify({ id_producto, force, cantidad: qtyInput })
      });

      if (assignResp.ok) {
        toast.success("Producto asociado con éxito");
        setSkuInput("");
        setQtyInput(1);
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

  const handleUpdateQty = async (id_producto: number, newQty: number) => {
    if (newQty < 0) return;
    
    if (newQty === 0) {
      const confirmDelete = window.confirm("¿Seguro que deseas eliminar este producto de la caja?");
      if (!confirmDelete) return;
    }
    
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}/productos/${id_producto}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad: newQty })
      });
      if (resp.ok) {
        toast.success(newQty === 0 ? "Producto removido" : "Cantidad actualizada");
        fetchProductos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar cantidad");
      }
    } catch (e) {
      toast.error("Error al actualizar cantidad");
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
                  {caja.temporada_default && (
                    <span className="text-[10px] font-black uppercase bg-amber-400/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                      🗓 {caja.temporada_default}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <Button
              onClick={handleDeleteCaja}
              variant="destructive"
              className="mr-8 h-9 text-xs rounded-xl font-bold bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              Eliminar Caja
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Formulario de SKU, Ubicación y Temporada de la Caja Contenedora (al tope de la modal) */}
          <div className="p-6 pb-4 border-b bg-neutral-50 grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
            {/* SKU Field */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-neutral-900 flex items-center gap-2 text-sm">
                  <Barcode size={16} className="text-neutral-500" /> SKU de la Caja
                </h3>
                <p className="text-[11px] text-neutral-500">Asocia el código de barras físico</p>
              </div>
              
              {isEditingSku ? (
                <form onSubmit={handleSaveBoxSku} className="flex gap-2 w-full sm:w-auto">
                  <Input 
                    placeholder="Escribe SKU de la caja" 
                    value={boxSku}
                    onChange={(e) => setBoxSku(e.target.value)}
                    className="bg-white rounded-xl text-sm h-10 w-full sm:w-40 focus-visible:ring-neutral-400"
                    disabled={isSavingSku}
                  />
                  <Button type="submit" disabled={isSavingSku} className="rounded-xl h-10 bg-neutral-900 text-xs px-3 text-white font-semibold">
                    {isSavingSku ? <Loader2 className="animate-spin" size={16} /> : "Ok"}
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end bg-white px-4 py-1.5 rounded-xl border">
                  <span className="font-mono text-sm font-bold text-neutral-900">{boxSku || "Sin SKU"}</span>
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

            {/* Location Field */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 md:border-l md:pl-6">
              <div>
                <h3 className="font-bold text-neutral-900 flex items-center gap-2 text-sm">
                  📍 Ubicación Física
                </h3>
                <p className="text-[11px] text-neutral-500">Asocia a una sección de almacén</p>
              </div>

              <div className="w-full sm:w-auto">
                <select
                  value={selectedValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleSaveLocation(val);
                  }}
                  className="rounded-xl h-10 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 w-full sm:w-48"
                >
                  <option value="">Sin ubicación física</option>
                  {zones.map((zone) => {
                    const zoneSections = sections.filter(s => s.id_zona_almacen === zone.id_zona_almacen);
                    return (
                      <React.Fragment key={zone.id_zona_almacen}>
                        <option value={`zone_${zone.id_zona_almacen}`} className="font-extrabold bg-neutral-100 text-neutral-950">
                          {zone.nombre.toUpperCase()} (SOLO ALMACÉN)
                        </option>
                        {zoneSections.map((sec) => (
                          <option key={sec.id_zona_seccion} value={`section_${sec.id_zona_seccion}`}>
                            &nbsp;&nbsp;↳ {sec.nombre.toUpperCase()}
                          </option>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Temporada Default Field */}
            <div className="flex flex-col justify-between gap-3 md:border-l md:pl-4">
              <div>
                <h3 className="font-bold text-neutral-900 flex items-center gap-2 text-sm">
                  <Calendar size={16} className="text-neutral-500" /> Temporada Default
                </h3>
                <p className="text-[11px] text-neutral-500">Los nuevos productos heredan esta temporada</p>
              </div>
              <div className="flex gap-2 items-center">
                <select
                  value={cajaTemporada}
                  onChange={e => setCajaTemporada(e.target.value)}
                  className="flex-1 rounded-xl h-10 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                >
                  <option value="">Sin temporada</option>
                  {temporadasOpts.map(t => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={handleSaveTemporada}
                  disabled={isSavingTemporada}
                  className="rounded-xl h-10 bg-neutral-900 text-xs px-3 text-white font-semibold shrink-0"
                >
                  {isSavingTemporada ? <Loader2 className="animate-spin" size={14} /> : "Ok"}
                </Button>
              </div>
              {cajaTemporada && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full w-fit">
                  🗓 {cajaTemporada}
                </span>
              )}
            </div>
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
                      <TableHead className="w-[120px] text-right">Acciones</TableHead>
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
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(item.id_producto, item.cantidad - 1)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg border bg-white hover:bg-neutral-100 active:scale-95 transition-all text-neutral-600 font-bold text-xs select-none"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              value={item.cantidad}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val >= 0) {
                                  handleUpdateQty(item.id_producto, val);
                                }
                              }}
                              className="w-12 h-7 text-center font-black text-sm bg-neutral-50 border rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-900 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(item.id_producto, item.cantidad + 1)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg border bg-white hover:bg-neutral-100 active:scale-95 transition-all text-neutral-600 font-bold text-xs select-none"
                            >
                              +
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => startTransfer(item)}
                            className="h-8 rounded-lg hover:bg-neutral-100 font-bold text-xs flex gap-1 items-center justify-end w-full"
                          >
                            <ArrowLeftRight size={12} className="mr-1" /> Transferir
                          </Button>
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
            <form onSubmit={handleAddProductBySku} className="flex gap-2 w-full sm:w-auto items-center">
              <Input 
                placeholder="SKU o EAN-13" 
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                className="bg-white rounded-xl text-sm h-10 w-full sm:w-48 focus-visible:ring-neutral-400"
                disabled={isAdding}
              />
              <Input 
                type="number"
                min={1}
                value={qtyInput}
                onChange={(e) => setQtyInput(parseInt(e.target.value) || 1)}
                className="bg-white rounded-xl text-sm h-10 w-16 text-center font-bold focus-visible:ring-neutral-400"
                disabled={isAdding}
                title="Cantidad a asociar"
              />
              <Button type="submit" disabled={isAdding || !skuInput.trim()} className="rounded-xl h-10 bg-neutral-900 text-sm whitespace-nowrap px-4 text-white font-semibold">
                {isAdding ? <Loader2 className="animate-spin" size={16} /> : "Agregar"}
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>

      {transferringItem && (
        <Dialog open={true} onOpenChange={() => setTransferringItem(null)}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black flex items-center gap-2">
                <ArrowLeftRight className="text-amber-500" size={20} />
                Transferir Producto
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleExecuteTransfer} className="space-y-4 mt-2">
              <div className="bg-neutral-50 p-4 rounded-xl border space-y-1">
                <p className="text-xs text-neutral-400 font-bold uppercase">Prenda</p>
                <p className="text-sm font-extrabold text-neutral-900">{transferringItem.productos.sku}</p>
                <p className="text-[11px] text-neutral-500 font-mono">Cantidad disponible: {transferringItem.cantidad}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-700 block">Caja de Destino</label>
                <select
                  required
                  value={transferTargetBoxId}
                  onChange={(e) => setTransferTargetBoxId(e.target.value)}
                  className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                >
                  <option value="">Selecciona la caja destino</option>
                  {allBoxes.map((b) => (
                    <option key={b.id_caja} value={b.id_caja}>
                      CAJA {b.numero_caja} {b.sku ? `(SKU: ${b.sku})` : ""} - {b.estado.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-700 block">Cantidad a Transferir</label>
                <Input
                  type="number"
                  min={1}
                  max={transferringItem.cantidad}
                  required
                  value={transferQty}
                  onChange={(e) => setTransferQty(parseInt(e.target.value) || 1)}
                  className="rounded-xl h-11 bg-white border-neutral-200 text-sm font-semibold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setTransferringItem(null)} 
                  className="flex-1 rounded-xl h-11 font-bold text-xs"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={isTransferring || !transferTargetBoxId || transferQty <= 0 || transferQty > transferringItem.cantidad}
                  className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs"
                >
                  {isTransferring ? <Loader2 className="animate-spin" size={16} /> : "Transferir"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
