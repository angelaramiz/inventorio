import React, { useState, useEffect, FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Box, Package, Image as ImageIcon, Loader2, Plus, Edit2, Barcode, ArrowLeftRight, Trash2, Calendar, ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { Caja, CajaProducto } from "../types";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import { fetchCatalogWithCache } from "../utils/pwaDb";

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
  const [qtyInput, setQtyInput] = useState<number | "">(1);
  const [editingQty, setEditingQty] = useState<Record<number, string>>({});
  const [cajaTemporada, setCajaTemporada] = useState(caja.temporada_default || "");
  const [isSavingTemporada, setIsSavingTemporada] = useState(false);
  const [temporadasOpts, setTemporadasOpts] = useState<string[]>([]);
  const [tiposOpts, setTiposOpts] = useState<string[]>([]);
  const [boxTags, setBoxTags] = useState(() => {
    const defaultTags = { tipo_producto: "todos", tipo_producto_exacto: "todos", genero: "todos", marca: "todos" };
    return { ...defaultTags, ...(caja as any).tags };
  });
  const [isSavingTags, setIsSavingTags] = useState(false);
  
  // Collapsible section states (retracted by default)
  const [isSection1Expanded, setIsSection1Expanded] = useState(false);
  const [isSection3Expanded, setIsSection3Expanded] = useState(false);

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
  const [transferQty, setTransferQty] = useState<number | "">(1);
  const [isTransferring, setIsTransferring] = useState(false);
  const [allBoxes, setAllBoxes] = useState<Caja[]>([]);
  const [allLevels, setAllLevels] = useState<any[]>([]);
  const [pasillos, setPasillos] = useState<any[]>([]);

  // Transfer all states
  const [showTransferAllModal, setShowTransferAllModal] = useState(false);
  const [isTransferringAll, setIsTransferringAll] = useState(false);

  // Hierarchical destination states
  const [transferType, setTransferType] = useState<"caja" | "seccion" | "nivel" | "">("");
  const [transAlmacenId, setTransAlmacenId] = useState("");
  const [transPasilloId, setTransPasilloId] = useState("");
  const [transSeccionId, setTransSeccionId] = useState("");
  const [transNivelId, setTransNivelId] = useState("");
  const [transCajaId, setTransCajaId] = useState("");

  const resetTransferSelection = () => {
    setTransAlmacenId("");
    setTransPasilloId("");
    setTransSeccionId("");
    setTransNivelId("");
    setTransCajaId("");
  };

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
      const [boxesResp, levelsResp, pasillosResp] = await Promise.all([
        fetch("/api/cajas"),
        fetch("/api/almacen/niveles"),
        fetch("/api/almacen/pasillos")
      ]);
      if (boxesResp.ok) {
        const data = await boxesResp.json();
        setAllBoxes(data.filter((b: any) => b.id_caja !== caja.id_caja));
      }
      if (levelsResp.ok) {
        const data = await levelsResp.json();
        setAllLevels(data.filter((l: any) => l.id_zona_nivel !== (caja as any).id_zona_nivel));
      }
      if (pasillosResp.ok) {
        const data = await pasillosResp.json();
        setPasillos(data);
      }
    } catch (e) {
      console.error("Error fetching destinations for transfer:", e);
    }
  };

  const startTransfer = (item: CajaProducto) => {
    setTransferringItem(item);
    setTransferQty(1);
    setTransferType("");
    resetTransferSelection();
    fetchBoxesForTransfer();
  };

  const startTransferAll = () => {
    setTransferType("");
    resetTransferSelection();
    setShowTransferAllModal(true);
    fetchBoxesForTransfer();
  };

  const getOrCreateTargetCajaId = async (
    type: "caja" | "seccion" | "nivel",
    cajaId: string,
    seccionId: string,
    nivelId: string
  ): Promise<number> => {
    if (type === "caja") {
      return parseInt(cajaId);
    }
    
    if (type === "nivel") {
      const lvlId = parseInt(nivelId);
      const lvl = allLevels.find(l => l.id_zona_nivel === lvlId);
      if (!lvl) throw new Error("Nivel no encontrado");
      
      const nameToMatch = `NIVEL: ${lvl.nombre.toUpperCase()}`;
      const existing = allBoxes.find(b => b.id_zona_nivel === lvlId && b.numero_caja === nameToMatch);
      if (existing) {
        return existing.id_caja;
      }
      
      const resp = await fetch("/api/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_caja: nameToMatch,
          id_zona_nivel: lvlId,
          id_zona_seccion: lvl.id_zona_seccion,
          tags: { tipo_producto: "todos", genero: "todos", marca: "todos" }
        })
      });
      if (resp.ok) {
        const newBox = await resp.json();
        return newBox.id_caja;
      } else {
        const err = await resp.json();
        throw new Error(err.error || "No se pudo crear la caja virtual para el nivel");
      }
    }
    
    if (type === "seccion") {
      const secId = parseInt(seccionId);
      const sec = sections.find(s => s.id_zona_seccion === secId);
      if (!sec) throw new Error("Sección no encontrada");
      
      const nameToMatch = `SECCIÓN: ${sec.nombre.toUpperCase()}`;
      const existing = allBoxes.find(b => b.id_zona_seccion === secId && b.numero_caja === nameToMatch);
      if (existing) {
        return existing.id_caja;
      }
      
      const resp = await fetch("/api/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_caja: nameToMatch,
          id_zona_seccion: secId,
          id_zona_almacen: null,
          tags: { tipo_producto: "todos", genero: "todos", marca: "todos" }
        })
      });
      if (resp.ok) {
        const newBox = await resp.json();
        return newBox.id_caja;
      } else {
        const err = await resp.json();
        throw new Error(err.error || "No se pudo crear la caja virtual para la sección");
      }
    }
    
    throw new Error("Tipo de destino no soportado");
  };

  const handleExecuteTransfer = async (e: FormEvent) => {
    e.preventDefault();
    if (!transferringItem || !transferType || (transferType === "caja" && !transCajaId) || (transferType === "seccion" && !transSeccionId) || (transferType === "nivel" && !transNivelId) || transferQty <= 0) return;
    
    setIsTransferring(true);
    try {
      const targetCajaId = await getOrCreateTargetCajaId(transferType, transCajaId, transSeccionId, transNivelId);
      
      const resp = await fetch("/api/transferir-producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_caja_origen: caja.id_caja,
          id_caja_destino: targetCajaId,
          id_producto: transferringItem.id_producto,
          cantidad: transferQty === "" ? 1 : transferQty
        })
      });
      if (resp.ok) {
        toast.success("Producto transferido con éxito");
        setTransferringItem(null);
        resetTransferSelection();
        setTransferType("");
        fetchProductos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al transferir");
      }
    } catch (e: any) {
      toast.error(e.message || "Error al transferir");
    } finally {
      setIsTransferring(false);
    }
  };

  const handleExecuteTransferAll = async (e: FormEvent) => {
    e.preventDefault();
    if (!transferType || (transferType === "caja" && !transCajaId) || (transferType === "seccion" && !transSeccionId) || (transferType === "nivel" && !transNivelId)) return;
    
    setIsTransferringAll(true);
    try {
      const targetCajaId = await getOrCreateTargetCajaId(transferType, transCajaId, transSeccionId, transNivelId);
      
      const resp = await fetch("/api/cajas/transferir-todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_caja_origen: caja.id_caja,
          id_caja_destino: targetCajaId
        })
      });
      if (resp.ok) {
        toast.success("Todos los productos han sido transferidos");
        setShowTransferAllModal(false);
        resetTransferSelection();
        setTransferType("");
        fetchProductos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al transferir todo");
      }
    } catch (e: any) {
      toast.error(e.message || "Error al transferir todo");
    } finally {
      setIsTransferringAll(false);
    }
  };

  const handleUpdateTagField = async (field: string, value: string) => {
    const updatedTags = { ...boxTags, [field]: value };
    // If tipo_producto changes to something other than calzado, clear the brand tag to "todos"
    if (field === "tipo_producto" && value !== "calzado") {
      updatedTags.marca = "todos";
    }
    // If tipo_producto changes to something other than ropa, clear the tipo_producto_exacto tag to "todos"
    if (field === "tipo_producto" && value !== "ropa") {
      updatedTags.tipo_producto_exacto = "todos";
    }
    
    setIsSavingTags(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: updatedTags })
      });
      if (resp.ok) {
        toast.success("Etiquetas actualizadas");
        (caja as any).tags = updatedTags;
        setBoxTags(updatedTags);
        fetchProductos(false); // Reload products in the background to show new inherited tipo

        // Sync tags with the physical level if this box represents a level
        if ((caja as any).id_zona_nivel) {
          await fetch(`/api/almacen/niveles/${(caja as any).id_zona_nivel}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tags: updatedTags })
          }).catch(e => console.error("Error syncing level tags:", e));
        }
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar etiquetas");
      }
    } catch (e) {
      toast.error("Error de conexión al guardar etiquetas");
    } finally {
      setIsSavingTags(false);
    }
  };

  useRealtimeSync((event) => {
    if (event.type === "caja:updated") {
      const boxId = event.id_caja || event.id_caja_origen || event.id_caja_destino;
      if (boxId && boxId === caja.id_caja) {
        if (event.action === "eliminar") {
          toast.warning("Esta caja ha sido eliminada por otro usuario.");
          onClose();
        } else {
          fetchProductos(false);
        }
      }
    }
  }, ["caja:updated"]);

  useEffect(() => {
    fetchProductos();
    fetchLocations();
    fetchTemporadas();
    fetchTipos();

    const handleSyncSuccess = () => {
      fetchProductos(false);
    };
    window.addEventListener("pwa-sync-success", handleSyncSuccess);

    return () => {
      window.removeEventListener("pwa-sync-success", handleSyncSuccess);
    };
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
      const data = await fetchCatalogWithCache("/api/conceptos/temporadas", "temporadas");
      setTemporadasOpts(data.map((v: any) => typeof v === 'object' ? v.nombre : v));
    } catch (err) {
      console.error("Error fetching temporadas:", err);
    }
  };

  const fetchTipos = async () => {
    try {
      const data = await fetchCatalogWithCache("/api/conceptos/tipos", "tipos");
      setTiposOpts(data.map((v: any) => typeof v === 'object' ? v.nombre : v));
    } catch (err) {
      console.error("Error fetching product types:", err);
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

  const fetchProductos = async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}/productos`);
      const data = await resp.json();
      setProductos(data);
    } catch (err) {
      toast.error("Error al cargar productos de la caja");
    } finally {
      if (showLoader) setLoading(false);
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
        body: JSON.stringify({ id_producto, force, cantidad: qtyInput === "" ? 1 : qtyInput })
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
    
    // Optimistic UI state update
    setProductos(prev => prev.map(p => p.id_producto === id_producto ? { ...p, cantidad: newQty } : p));
    
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}/productos/${id_producto}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad: newQty })
      });
      if (resp.ok) {
        toast.success(newQty === 0 ? "Producto removido" : "Cantidad actualizada");
        fetchProductos(false); // Background update
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar cantidad");
        fetchProductos(true); // Full reload to sync state on error
      }
    } catch (e) {
      toast.error("Error al actualizar cantidad");
      fetchProductos(true); // Full reload to sync state on error
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
                <DialogTitle className="text-2xl font-black tracking-tight">
                  {caja.numero_caja.toUpperCase().startsWith("NIVEL:") ? "" : "CAJA "}{caja.numero_caja}
                </DialogTitle>
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
            
            <div className="flex items-center gap-2 mr-8">
              {totalUnidades > 0 && (
                <Button
                  onClick={startTransferAll}
                  className="h-9 text-xs rounded-xl font-bold bg-amber-500 hover:bg-amber-600 text-neutral-900 flex items-center gap-1.5"
                >
                  <ArrowLeftRight size={14} />
                  Transferir Todo
                </Button>
              )}
              {!caja.numero_caja?.toUpperCase().startsWith("NIVEL:") && (
                <Button
                  onClick={handleDeleteCaja}
                  variant="destructive"
                  className="h-9 text-xs rounded-xl font-bold bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5"
                >
                  <Trash2 size={14} />
                  Eliminar Caja
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col md:grid md:grid-cols-3 overflow-hidden bg-white min-h-0">
          {/* COLUMNA IZQUIERDA: Detalles (1) y Asociación (3) */}
          <div className="md:col-span-1 border-b md:border-b-0 md:border-r bg-neutral-50/50 p-5 flex flex-col gap-5 overflow-y-auto shrink-0 md:shrink min-h-0">
            
            {/* SECCIÓN 1: DETALLES DEL CONTENEDOR */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
              <div 
                onClick={() => setIsSection1Expanded(prev => !prev)}
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-neutral-50/50 transition-colors select-none border-b border-neutral-100"
              >
                <h3 className="font-black text-neutral-800 text-xs uppercase tracking-wider flex items-center gap-2">
                  <Box size={14} className="text-neutral-500" />
                  1. Detalles del Contenedor
                </h3>
                {isSection1Expanded ? <ChevronDown size={16} className="text-neutral-550" /> : <ChevronRight size={16} className="text-neutral-550" />}
              </div>
              
              {isSection1Expanded && (
                <div className="p-5 space-y-4">
                  {/* SKU Field */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                        <Barcode size={14} className="text-neutral-500" /> SKU de la Caja
                      </h4>
                    </div>
                    {isEditingSku ? (
                      <form onSubmit={handleSaveBoxSku} className="flex gap-2">
                        <Input 
                          placeholder="Escribe SKU de la caja" 
                          value={boxSku}
                          onChange={(e) => setBoxSku(e.target.value)}
                          className="bg-white rounded-xl text-xs h-9 w-full focus-visible:ring-neutral-400"
                          disabled={isSavingSku}
                        />
                        <Button type="submit" disabled={isSavingSku} className="rounded-xl h-9 bg-neutral-900 text-xs px-3 text-white font-semibold">
                          {isSavingSku ? <Loader2 className="animate-spin" size={14} /> : "Ok"}
                        </Button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2 justify-between bg-neutral-50 px-3 py-1.5 rounded-xl border border-neutral-200/60">
                        <span className="font-mono text-xs font-bold text-neutral-900">{boxSku || "Sin SKU"}</span>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => setIsEditingSku(true)}
                          className="h-7 w-7 rounded-lg hover:bg-neutral-100"
                        >
                          <Edit2 size={12} className="text-neutral-600" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Location Field */}
                  <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                    <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                      📍 Ubicación Física
                    </h4>
                    <select
                      value={selectedValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        handleSaveLocation(val);
                      }}
                      className="rounded-xl h-9 px-2.5 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 w-full"
                    >
                      <option value="">Sin ubicación física</option>
                      {zones.map((zone) => {
                        const zoneSections = sections.filter(s => s.id_zona_almacen === zone.id_zona_almacen);
                        return (
                          <React.Fragment key={zone.id_zona_almacen}>
                            <option value={`zone_${zone.id_zona_almacen}`} className="font-extrabold bg-neutral-100 text-neutral-955">
                              {zone.nombre.toUpperCase()} (SOLO ALMACÉN)
                            </option>
                            {zoneSections.map((sec) => (
                              <option key={sec.id_zona_seccion} value={`section_${sec.id_zona_seccion}`}>
                                &nbsp;&nbsp;↳ {sec.pasillo_nombre && sec.pasillo_nombre !== "Sin pasillo" ? `${sec.pasillo_nombre.toUpperCase()} > ` : ""}{sec.nombre.toUpperCase()}
                              </option>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </select>
                  </div>

                  {/* Temporada Default Field */}
                  <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                    <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                      <Calendar size={14} className="text-neutral-500" /> Temporada Default
                    </h4>
                    <div className="flex gap-2">
                      <select
                        value={cajaTemporada}
                        onChange={e => setCajaTemporada(e.target.value)}
                        className="flex-1 rounded-xl h-9 px-2.5 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
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
                        className="rounded-xl h-9 bg-neutral-900 text-xs px-3 text-white font-semibold shrink-0"
                      >
                        {isSavingTemporada ? <Loader2 className="animate-spin" size={14} /> : "Ok"}
                      </Button>
                    </div>
                    {cajaTemporada && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full mt-1 w-fit">
                        🗓 {cajaTemporada}
                      </span>
                    )}
                  </div>

                  {/* Tipo de Producto Tag */}
                  <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                    <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                      🏷️ Tipo de Producto
                    </h4>
                    <select
                      value={boxTags.tipo_producto || "todos"}
                      disabled={isSavingTags}
                      onChange={(e) => handleUpdateTagField("tipo_producto", e.target.value)}
                      className="rounded-xl h-9 px-2.5 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 w-full disabled:opacity-55"
                    >
                      <option value="todos">TODOS / AMBOS</option>
                      <option value="ropa">ROPA</option>
                      <option value="calzado">CALZADO</option>
                    </select>
                  </div>

                  {/* Tipo de Producto Exacto (Specific Type) Tag (Conditional) */}
                  {boxTags.tipo_producto === "ropa" && (
                    <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                      <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                        👕 Tipo Específico
                      </h4>
                      <select
                        value={boxTags.tipo_producto_exacto || "todos"}
                        disabled={isSavingTags}
                        onChange={(e) => handleUpdateTagField("tipo_producto_exacto", e.target.value)}
                        className="rounded-xl h-9 px-2.5 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 w-full disabled:opacity-55"
                      >
                        <option value="todos">TODOS</option>
                        {tiposOpts.map((t) => (
                          <option key={t} value={t}>
                            {t.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Género Destinado Tag */}
                  <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                    <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                      👥 Género Destinado
                    </h4>
                    <select
                      value={boxTags.genero || "todos"}
                      disabled={isSavingTags}
                      onChange={(e) => handleUpdateTagField("genero", e.target.value)}
                      className="rounded-xl h-9 px-2.5 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 w-full disabled:opacity-55"
                    >
                      <option value="todos">UNISEX / TODOS</option>
                      <option value="H">HOMBRE (H)</option>
                      <option value="M">MUJER (M)</option>
                    </select>
                  </div>

                  {/* Marca de Calzado Tag (Conditional) */}
                  {boxTags.tipo_producto === "calzado" && (
                    <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                      <h4 className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                        👟 Marca de Calzado
                      </h4>
                      <select
                        value={boxTags.marca || "todos"}
                        disabled={isSavingTags}
                        onChange={(e) => handleUpdateTagField("marca", e.target.value)}
                        className="rounded-xl h-9 px-2.5 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 w-full disabled:opacity-55"
                      >
                        <option value="todos">TODAS / AMBAS</option>
                        <option value="Marciano">MARCIANO (M)</option>
                        <option value="Guess">GUESS (G)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECCIÓN 3: ASOCIAR PRODUCTOS */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
              <div 
                onClick={() => setIsSection3Expanded(prev => !prev)}
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-neutral-50/50 transition-colors select-none border-b border-neutral-100"
              >
                <h3 className="font-black text-neutral-800 text-xs uppercase tracking-wider flex items-center gap-2">
                  <Plus size={14} className="text-neutral-500" />
                  3. Asociar Producto
                </h3>
                {isSection3Expanded ? <ChevronDown size={16} className="text-neutral-550" /> : <ChevronRight size={16} className="text-neutral-550" />}
              </div>
              
              {isSection3Expanded && (
                <div className="p-5 space-y-4">
                  <p className="text-[10px] text-neutral-500">Agrega un artículo existente por su código</p>
                  <form onSubmit={handleAddProductBySku} className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-black text-neutral-400 block">SKU o EAN-13</label>
                      <Input 
                        placeholder="SKU o EAN-13" 
                        value={skuInput}
                        onChange={(e) => setSkuInput(e.target.value)}
                        className="bg-white rounded-xl text-xs h-9 focus-visible:ring-neutral-400"
                        disabled={isAdding}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-black text-neutral-400 block">Cantidad</label>
                      <Input 
                        type="number"
                        min={1}
                        value={qtyInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQtyInput(val === "" ? "" : (parseInt(val) || 1));
                        }}
                        className="bg-white rounded-xl text-xs h-9 text-center font-bold focus-visible:ring-neutral-400"
                        disabled={isAdding}
                      />
                    </div>
                    <Button type="submit" disabled={isAdding || !skuInput.trim()} className="w-full rounded-xl h-9 bg-neutral-900 text-xs px-4 text-white font-semibold">
                      {isAdding ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} className="inline mr-1" />}
                      Asociar a Caja
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </div>

          {/* COLUMNA DERECHA: Tabla de Productos (2) */}
          <div className="md:col-span-2 flex flex-col overflow-hidden p-5 gap-3 min-h-0">
            <h3 className="font-black text-neutral-400 text-[10px] uppercase tracking-wider">2. Productos en Contenedor</h3>
            
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-400 py-12">
                  <Loader2 className="animate-spin mb-2" size={32} />
                  <p className="text-sm font-medium">Cargando inventario de caja...</p>
                </div>
              ) : productos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-400 border-2 border-dashed rounded-3xl p-8 py-16">
                  <Package size={48} strokeWidth={1} className="mb-4 opacity-20" />
                  <p className="font-semibold text-sm">Esta caja está vacía</p>
                  <p className="text-xs text-center max-w-[250px] mt-1 text-neutral-500">Asocia productos en el formulario de la izquierda o utiliza el Escáner para empezar a llenarla.</p>
                </div>
              ) : (
                <div className="rounded-xl border overflow-hidden overflow-x-auto w-full">
                  <Table>
                    <TableHeader className="bg-neutral-50/50">
                      <TableRow>
                        <TableHead className="w-[60px]">Foto</TableHead>
                        <TableHead>Producto (SKU)</TableHead>
                        <TableHead>Detalles</TableHead>
                        <TableHead className="text-right w-[110px]">Cant.</TableHead>
                        <TableHead className="w-[100px] text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productos.map((item) => (
                        <TableRow key={item.id_producto} className="group hover:bg-neutral-50/50">
                          <TableCell className="py-2">
                            {item.productos.has_foto ? (
                              <img 
                                src={`/api/productos/${item.id_producto}/image`}
                                alt="Producto" 
                                loading="lazy"
                                className="w-10 h-10 object-cover rounded-lg shadow-sm border" 
                              />
                            ) : (
                              <div className="w-10 h-10 bg-neutral-100 flex items-center justify-center rounded-lg border text-neutral-400">
                                <ImageIcon size={16} />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex flex-col">
                              <span className="font-bold text-neutral-900 text-xs">{item.productos.sku}</span>
                              <span className="text-[10px] text-neutral-550 font-mono leading-none">{item.productos.ean_13}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex gap-1 flex-wrap">
                              <Badge variant="secondary" className="text-[9px] uppercase font-bold px-1.5 py-0.5">{item.productos.tipo}</Badge>
                              <Badge variant="outline" className="text-[9px] uppercase font-bold bg-white px-1.5 py-0.5">{item.productos.talla}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const newQty = item.cantidad - 1;
                                  handleUpdateQty(item.id_producto, newQty);
                                  setEditingQty(prev => {
                                    const updated = { ...prev };
                                    delete updated[item.id_producto];
                                    return updated;
                                  });
                                }}
                                className="w-6 h-6 flex items-center justify-center rounded-md border bg-white hover:bg-neutral-100 active:scale-95 transition-all text-neutral-600 font-bold text-xs select-none"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                value={editingQty[item.id_producto] !== undefined ? editingQty[item.id_producto] : item.cantidad.toString()}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditingQty(prev => ({
                                    ...prev,
                                    [item.id_producto]: val
                                  }));
                                }}
                                onBlur={() => {
                                  const valStr = editingQty[item.id_producto];
                                  if (valStr !== undefined) {
                                    const val = parseInt(valStr);
                                    if (!isNaN(val) && val >= 0) {
                                      if (val !== item.cantidad) {
                                        handleUpdateQty(item.id_producto, val);
                                      }
                                    }
                                    setEditingQty(prev => {
                                      const updated = { ...prev };
                                      delete updated[item.id_producto];
                                      return updated;
                                    });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.currentTarget.blur();
                                  }
                                }}
                                className="w-10 h-6 text-center font-black text-xs bg-neutral-55 border rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const newQty = item.cantidad + 1;
                                  handleUpdateQty(item.id_producto, newQty);
                                  setEditingQty(prev => {
                                    const updated = { ...prev };
                                    delete updated[item.id_producto];
                                    return updated;
                                  });
                                }}
                                className="w-6 h-6 flex items-center justify-center rounded-md border bg-white hover:bg-neutral-100 active:scale-95 transition-all text-neutral-600 font-bold text-xs select-none"
                              >
                                +
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => startTransfer(item)}
                              className="h-8 rounded-lg hover:bg-neutral-100 font-bold text-[10px] flex gap-1 items-center justify-end w-full"
                            >
                              <ArrowLeftRight size={10} /> Transferir
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      {transferringItem && (
        <Dialog open={true} onOpenChange={() => { setTransferringItem(null); setTransferType(""); resetTransferSelection(); }}>
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

              {/* Selector Jerárquico de Destino */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-neutral-700 block">Destino (Caja, Sección o Nivel)</label>
                <div className="space-y-3 bg-neutral-50 p-4 rounded-xl border">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-neutral-400 block">Tipo de Destino</label>
                    <select
                      value={transferType}
                      onChange={(e) => {
                        setTransferType(e.target.value as any);
                        resetTransferSelection();
                      }}
                      required
                      className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      <option value="">Selecciona tipo...</option>
                      <option value="caja">Caja Estándar</option>
                      <option value="seccion">Sección Física</option>
                      <option value="nivel">Nivel de Almacenamiento</option>
                    </select>
                  </div>

                  {transferType === "caja" && (
                    <div className="space-y-1 animate-in fade-in duration-200">
                      <label className="text-[10px] uppercase font-black text-neutral-400 block">Caja Destino</label>
                      <select
                        value={transCajaId}
                        onChange={(e) => setTransCajaId(e.target.value)}
                        required
                        className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                      >
                        <option value="">Selecciona una caja...</option>
                        {allBoxes
                          .filter((b) => !b.numero_caja?.toUpperCase().startsWith("NIVEL:") && !b.numero_caja?.toUpperCase().startsWith("SECCIÓN:"))
                          .map((b) => (
                            <option key={b.id_caja} value={String(b.id_caja)}>
                              CAJA {b.numero_caja} {b.sku ? `(SKU: ${b.sku})` : ""} - {b.estado.toUpperCase()}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {(transferType === "seccion" || transferType === "nivel") && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                      {!transAlmacenId ? (
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-black text-neutral-400 block">1. Almacén</label>
                          <select
                            value={transAlmacenId}
                            onChange={(e) => setTransAlmacenId(e.target.value)}
                            required
                            className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                          >
                            <option value="">Selecciona Almacén...</option>
                            {zones.map((z) => (
                              <option key={z.id_zona_almacen} value={String(z.id_zona_almacen)}>
                                {z.nombre.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : !transPasilloId ? (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] uppercase font-black text-neutral-400 block">2. Pasillo / Subzona</label>
                            <span className="text-[9px] text-neutral-500 font-bold truncate max-w-[150px]">
                              📍 {zones.find(z => String(z.id_zona_almacen) === transAlmacenId)?.nombre.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setTransAlmacenId("");
                                setTransPasilloId("");
                              }}
                              className="h-11 w-11 rounded-2xl shrink-0 p-0 border-neutral-200 hover:bg-neutral-100 flex items-center justify-center"
                            >
                              <ArrowLeft size={16} />
                            </Button>
                            <select
                              value={transPasilloId}
                              onChange={(e) => setTransPasilloId(e.target.value)}
                              required
                              className="flex-1 rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                            >
                              <option value="">Selecciona Pasillo...</option>
                              {Array.from(
                                new Map<string, string>(
                                  sections
                                    .filter((s) => s.id_zona_almacen === parseInt(transAlmacenId))
                                    .map((s) => [String(s.id_zona_pasillo || "null"), String(s.pasillo_nombre || "Sin Pasillo")])
                                ).entries()
                              ).map(([id, name]) => (
                                <option key={id} value={id}>
                                  {name.toUpperCase()}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (transferType === "seccion" && !transSeccionId) || (transferType === "nivel" && !transSeccionId) ? (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] uppercase font-black text-neutral-400 block">
                              {transferType === "seccion" ? "3. Sección (Receptora)" : "3. Sección Física"}
                            </label>
                            <span className="text-[9px] text-neutral-500 font-bold truncate max-w-[150px]">
                              📍 {pasillos.find(p => String(p.id_zona_pasillo || "null") === transPasilloId)?.nombre?.toUpperCase() || "SIN PASILLO"}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setTransPasilloId("");
                                setTransSeccionId("");
                              }}
                              className="h-11 w-11 rounded-2xl shrink-0 p-0 border-neutral-200 hover:bg-neutral-100 flex items-center justify-center"
                            >
                              <ArrowLeft size={16} />
                            </Button>
                            <select
                              value={transSeccionId}
                              onChange={(e) => setTransSeccionId(e.target.value)}
                              required
                              className="flex-1 rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                            >
                              <option value="">Selecciona Sección...</option>
                              {sections
                                .filter(
                                  (s) =>
                                    s.id_zona_almacen === parseInt(transAlmacenId) &&
                                    String(s.id_zona_pasillo || "null") === transPasilloId
                                )
                                .map((s) => (
                                  <option key={s.id_zona_seccion} value={String(s.id_zona_seccion)}>
                                    {s.nombre.toUpperCase()}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      ) : transferType === "nivel" && !transNivelId ? (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] uppercase font-black text-neutral-400 block">4. Nivel (Receptor)</label>
                            <span className="text-[9px] text-neutral-500 font-bold truncate max-w-[150px]">
                              📍 {sections.find(s => String(s.id_zona_seccion) === transSeccionId)?.nombre?.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setTransSeccionId("");
                                setTransNivelId("");
                              }}
                              className="h-11 w-11 rounded-2xl shrink-0 p-0 border-neutral-200 hover:bg-neutral-100 flex items-center justify-center"
                            >
                              <ArrowLeft size={16} />
                            </Button>
                            <select
                              value={transNivelId}
                              onChange={(e) => setTransNivelId(e.target.value)}
                              required
                              className="flex-1 rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                            >
                              <option value="">Selecciona Nivel...</option>
                              {allLevels
                                .filter((n) => n.id_zona_seccion === parseInt(transSeccionId))
                                .map((n) => (
                                  <option key={n.id_zona_nivel} value={String(n.id_zona_nivel)}>
                                    {n.nombre.toUpperCase()}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-neutral-100 rounded-xl border space-y-2">
                          <p className="text-[10px] uppercase font-black text-neutral-400">Destino Seleccionado</p>
                          <div className="text-sm font-extrabold text-neutral-900">
                            {transferType === "seccion" ? (
                              <span>SECCIÓN: {sections.find(s => String(s.id_zona_seccion) === transSeccionId)?.nombre.toUpperCase()}</span>
                            ) : (
                              <span>NIVEL: {allLevels.find(n => String(n.id_zona_nivel) === transNivelId)?.nombre.toUpperCase()}</span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              if (transferType === "seccion") {
                                setTransSeccionId("");
                              } else {
                                setTransNivelId("");
                              }
                            }}
                            className="h-8 text-[10px] font-bold text-neutral-600 hover:bg-neutral-200/50"
                          >
                            Cambiar Destino
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-700 block">Cantidad a Transferir</label>
                <Input
                  type="number"
                  min={1}
                  max={transferringItem.cantidad}
                  required
                  value={transferQty}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTransferQty(val === "" ? "" : (parseInt(val) || 1));
                  }}
                  className="rounded-xl h-11 bg-white border-neutral-200 text-sm font-semibold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => { setTransferringItem(null); setTransferType(""); resetTransferSelection(); }} 
                  className="flex-1 rounded-xl h-11 font-bold text-xs"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={
                    isTransferring || 
                    transferQty <= 0 || 
                    transferQty > transferringItem.cantidad ||
                    !(transferType === "caja" ? !!transCajaId : transferType === "seccion" ? !!transSeccionId : transferType === "nivel" ? !!transNivelId : false)
                  }
                  className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs"
                >
                  {isTransferring ? <Loader2 className="animate-spin" size={16} /> : "Transferir"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {showTransferAllModal && (
        <Dialog open={true} onOpenChange={() => { setShowTransferAllModal(false); setTransferType(""); resetTransferSelection(); }}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black flex items-center gap-2">
                <ArrowLeftRight className="text-amber-500" size={20} />
                Transferir Todos los Productos
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleExecuteTransferAll} className="space-y-4 mt-2">
              <div className="bg-neutral-50 p-4 rounded-xl border space-y-2 max-h-48 overflow-y-auto">
                <p className="text-xs text-neutral-400 font-bold uppercase">Resumen de Inventario a Mover</p>
                <div className="space-y-1.5">
                  {productos.map((item) => (
                    <div key={item.id_producto} className="flex justify-between text-xs font-semibold text-neutral-750">
                      <span>{item.productos.sku} (Talla: {item.productos.talla})</span>
                      <span className="font-bold text-neutral-900">x{item.cantidad}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-2 flex justify-between text-xs font-black text-neutral-900 uppercase">
                  <span>Total Prendas</span>
                  <span>{totalUnidades} uds</span>
                </div>
              </div>

              {/* Selector Jerárquico de Destino */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-neutral-700 block">Destino (Caja, Sección o Nivel)</label>
                <div className="space-y-3 bg-neutral-50 p-4 rounded-xl border">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-neutral-400 block">Tipo de Destino</label>
                    <select
                      value={transferType}
                      onChange={(e) => {
                        setTransferType(e.target.value as any);
                        resetTransferSelection();
                      }}
                      required
                      className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      <option value="">Selecciona tipo...</option>
                      <option value="caja">Caja Estándar</option>
                      <option value="seccion">Sección Física</option>
                      <option value="nivel">Nivel de Almacenamiento</option>
                    </select>
                  </div>

                  {transferType === "caja" && (
                    <div className="space-y-1 animate-in fade-in duration-200">
                      <label className="text-[10px] uppercase font-black text-neutral-400 block">Caja Destino</label>
                      <select
                        value={transCajaId}
                        onChange={(e) => setTransCajaId(e.target.value)}
                        required
                        className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                      >
                        <option value="">Selecciona una caja...</option>
                        {allBoxes
                          .filter((b) => !b.numero_caja?.toUpperCase().startsWith("NIVEL:") && !b.numero_caja?.toUpperCase().startsWith("SECCIÓN:"))
                          .map((b) => (
                            <option key={b.id_caja} value={String(b.id_caja)}>
                              CAJA {b.numero_caja} {b.sku ? `(SKU: ${b.sku})` : ""} - {b.estado.toUpperCase()}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {(transferType === "seccion" || transferType === "nivel") && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                      {!transAlmacenId ? (
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-black text-neutral-400 block">1. Almacén</label>
                          <select
                            value={transAlmacenId}
                            onChange={(e) => setTransAlmacenId(e.target.value)}
                            required
                            className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                          >
                            <option value="">Selecciona Almacén...</option>
                            {zones.map((z) => (
                              <option key={z.id_zona_almacen} value={String(z.id_zona_almacen)}>
                                {z.nombre.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : !transPasilloId ? (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] uppercase font-black text-neutral-400 block">2. Pasillo / Subzona</label>
                            <span className="text-[9px] text-neutral-500 font-bold truncate max-w-[150px]">
                              📍 {zones.find(z => String(z.id_zona_almacen) === transAlmacenId)?.nombre.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setTransAlmacenId("");
                                setTransPasilloId("");
                              }}
                              className="h-11 w-11 rounded-2xl shrink-0 p-0 border-neutral-200 hover:bg-neutral-100 flex items-center justify-center"
                            >
                              <ArrowLeft size={16} />
                            </Button>
                            <select
                              value={transPasilloId}
                              onChange={(e) => setTransPasilloId(e.target.value)}
                              required
                              className="flex-1 rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                            >
                              <option value="">Selecciona Pasillo...</option>
                              {Array.from(
                                new Map<string, string>(
                                  sections
                                    .filter((s) => s.id_zona_almacen === parseInt(transAlmacenId))
                                    .map((s) => [String(s.id_zona_pasillo || "null"), String(s.pasillo_nombre || "Sin Pasillo")])
                                ).entries()
                              ).map(([id, name]) => (
                                <option key={id} value={id}>
                                  {name.toUpperCase()}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (transferType === "seccion" && !transSeccionId) || (transferType === "nivel" && !transSeccionId) ? (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] uppercase font-black text-neutral-400 block">
                              {transferType === "seccion" ? "3. Sección (Receptora)" : "3. Sección Física"}
                            </label>
                            <span className="text-[9px] text-neutral-500 font-bold truncate max-w-[150px]">
                              📍 {pasillos.find(p => String(p.id_zona_pasillo || "null") === transPasilloId)?.nombre?.toUpperCase() || "SIN PASILLO"}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setTransPasilloId("");
                                setTransSeccionId("");
                              }}
                              className="h-11 w-11 rounded-2xl shrink-0 p-0 border-neutral-200 hover:bg-neutral-100 flex items-center justify-center"
                            >
                              <ArrowLeft size={16} />
                            </Button>
                            <select
                              value={transSeccionId}
                              onChange={(e) => setTransSeccionId(e.target.value)}
                              required
                              className="flex-1 rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                            >
                              <option value="">Selecciona Sección...</option>
                              {sections
                                .filter(
                                  (s) =>
                                    s.id_zona_almacen === parseInt(transAlmacenId) &&
                                    String(s.id_zona_pasillo || "null") === transPasilloId
                                )
                                .map((s) => (
                                  <option key={s.id_zona_seccion} value={String(s.id_zona_seccion)}>
                                    {s.nombre.toUpperCase()}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      ) : transferType === "nivel" && !transNivelId ? (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] uppercase font-black text-neutral-400 block">4. Nivel (Receptor)</label>
                            <span className="text-[9px] text-neutral-500 font-bold truncate max-w-[150px]">
                              📍 {sections.find(s => String(s.id_zona_seccion) === transSeccionId)?.nombre?.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setTransSeccionId("");
                                setTransNivelId("");
                              }}
                              className="h-11 w-11 rounded-2xl shrink-0 p-0 border-neutral-200 hover:bg-neutral-100 flex items-center justify-center"
                            >
                              <ArrowLeft size={16} />
                            </Button>
                            <select
                              value={transNivelId}
                              onChange={(e) => setTransNivelId(e.target.value)}
                              required
                              className="flex-1 rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                            >
                              <option value="">Selecciona Nivel...</option>
                              {allLevels
                                .filter((n) => n.id_zona_seccion === parseInt(transSeccionId))
                                .map((n) => (
                                  <option key={n.id_zona_nivel} value={String(n.id_zona_nivel)}>
                                    {n.nombre.toUpperCase()}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-neutral-100 rounded-xl border space-y-2">
                          <p className="text-[10px] uppercase font-black text-neutral-400">Destino Seleccionado</p>
                          <div className="text-sm font-extrabold text-neutral-900">
                            {transferType === "seccion" ? (
                              <span>SECCIÓN: {sections.find(s => String(s.id_zona_seccion) === transSeccionId)?.nombre.toUpperCase()}</span>
                            ) : (
                              <span>NIVEL: {allLevels.find(n => String(n.id_zona_nivel) === transNivelId)?.nombre.toUpperCase()}</span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              if (transferType === "seccion") {
                                setTransSeccionId("");
                              } else {
                                setTransNivelId("");
                              }
                            }}
                            className="h-8 text-[10px] font-bold text-neutral-600 hover:bg-neutral-200/50"
                          >
                            Cambiar Destino
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => { setShowTransferAllModal(false); setTransferType(""); resetTransferSelection(); }} 
                  className="flex-1 rounded-xl h-11 font-bold text-xs"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={
                    isTransferringAll || 
                    !(transferType === "caja" ? !!transCajaId : transferType === "seccion" ? !!transSeccionId : transferType === "nivel" ? !!transNivelId : false)
                  }
                  className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs"
                >
                  {isTransferringAll ? <Loader2 className="animate-spin" size={16} /> : "Confirmar Transferencia"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
