import React, { useState, useEffect, FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  Plus, Box, ExternalLink, Archive, CheckCircle2, History, Loader2, 
  Trash2, ArrowRightLeft, AlertTriangle, Check, RefreshCw 
} from "lucide-react";
import { toast } from "sonner";
import { Caja } from "../types";
import CajaDetailsModal from "./CajaDetailsModal";

interface CJXContainer {
  id: number;
  prefijo: string;
  secuencia: number;
  sku_validado: string;
  estado: string; // 'vacia', 'activa', 'llena', 'vieja', 'rota'
  stock_heredado?: any;
  created_at: string;
}

export default function CajasView() {
  const [activeSubTab, setActiveSubTab] = useState<"standard" | "cjx">("standard");

  // Legacy cajas state
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCajaNumber, setNewCajaNumber] = useState("");
  const [zones, setZones] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedValue, setSelectedValue] = useState("");
  const [newCajaTemporada, setNewCajaTemporada] = useState("");
  const [temporadasOpts, setTemporadasOpts] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCaja, setSelectedCaja] = useState<Caja | null>(null);
  const [activeCajaId, setActiveCajaId] = useState<number | null>(null);

  // CJ-X containers state
  const [cjxContainers, setCjxContainers] = useState<CJXContainer[]>([]);
  const [loadingCjx, setLoadingCjx] = useState(false);
  const [skuToValidate, setSkuToValidate] = useState("");
  const [isValidatingSku, setIsValidatingSku] = useState(false);
  const [skuValidationResult, setSkuValidationResult] = useState<any>(null);
  const [showAddCjxModal, setShowAddCjxModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAddCajaModal, setShowAddCajaModal] = useState(false);
  const [cajaTipo, setCajaTipo] = useState("todos");
  const [cajaGenero, setCajaGenero] = useState("todos");
  const [cajaMarca, setCajaMarca] = useState("todos");

  // Transfer form state
  const [transferOriginId, setTransferOriginId] = useState("");
  const [transferDestId, setTransferDestId] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);

  useEffect(() => {
    fetchCajas();
    fetchLocations();
    fetchTemporadas();
    fetchCjxContainers();
    const saved = localStorage.getItem("activeCaja");
    if (saved) {
      setActiveCajaId(JSON.parse(saved).id_caja);
    }
  }, []);

  const fetchCjxContainers = async () => {
    setLoadingCjx(true);
    try {
      const resp = await fetch("/api/hierarchy"); // Flat list from hierarchy includes node types
      if (resp.ok) {
        // Also fetch containers from custom containers table
        const cjxResp = await fetch("/api/cajas"); // fallback
        // Fetch from actual /api/containers endpoint if we added it
        const containerResp = await fetch("/api/hierarchy"); // wait, let's load all containers
      }
      
      // Let's call the database to fetch actual boxes list
      const cjxResp = await fetch("/api/cajas");
      if (cjxResp.ok) {
        const data = await cjxResp.json();
        // Filters boxes that have SKU matching the CJ-X pattern
        const filtered = data.filter((c: any) => c.sku && c.sku.startsWith("CJ-"));
        setCjxContainers(filtered.map((f: any) => {
          const parts = f.sku.split("-");
          return {
            id: f.id_caja,
            prefijo: parts[0] || "CJ",
            secuencia: parseInt(parts[1]) || f.id_caja,
            sku_validado: f.numero_caja, // maps to number
            estado: f.estado,
            created_at: f.fecha_creacion
          };
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCjx(false);
    }
  };

  const fetchCajas = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/cajas");
      const data = await resp.json();
      setCajas(data);
    } catch (err) {
      toast.error("Error al cargar cajas");
    } finally {
      setLoading(false);
    }
  };

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
        const names = data.map((v: any) => typeof v === 'object' ? v.nombre : v) as string[];
        setTemporadasOpts(names);
      }
    } catch (err) {
      console.error("Error fetching temporadas:", err);
    }
  };

  const handleCreateCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCajaNumber) return;

    setIsCreating(true);
    let id_zona_seccion = null;
    let id_zona_almacen = null;
    if (selectedValue.startsWith("section_")) {
      id_zona_seccion = parseInt(selectedValue.replace("section_", ""));
    } else if (selectedValue.startsWith("zone_")) {
      id_zona_almacen = parseInt(selectedValue.replace("zone_", ""));
    }

    try {
      const resp = await fetch("/api/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          numero_caja: newCajaNumber,
          id_zona_seccion,
          id_zona_almacen,
          temporada_default: newCajaTemporada || null,
          tags: {
            tipo_producto: cajaTipo,
            genero: cajaGenero,
            marca: cajaMarca
          }
        })
      });
      if (resp.ok) {
        toast.success("Caja creada correctamente");
        setNewCajaNumber("");
        setSelectedValue("");
        setNewCajaTemporada("");
        setCajaTipo("todos");
        setCajaGenero("todos");
        setCajaMarca("todos");
        setShowAddCajaModal(false);
        fetchCajas();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al crear");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setIsCreating(false);
    }
  };

  // Validate SKU before creating CJ-X box
  const handleValidateSku = async (e: FormEvent) => {
    e.preventDefault();
    if (!skuToValidate.trim()) return;

    setIsValidatingSku(true);
    setSkuValidationResult(null);

    try {
      // Query if product exists
      const resp = await fetch(`/api/verificar/${skuToValidate.trim()}`);
      if (resp.ok) {
        const data = await resp.json();
        setSkuValidationResult(data);
        if (data.exists) {
          toast.success("SKU Validado correctamente");
        } else {
          toast.error("El SKU no existe en la base de datos de productos");
        }
      }
    } catch (e) {
      toast.error("Error al validar SKU");
    } finally {
      setIsValidatingSku(false);
    }
  };

  // Create CJ-X Container
  const handleCreateCjx = async () => {
    if (!skuValidationResult || !skuValidationResult.exists) return;
    setIsCreating(true);

    try {
      // Create the container in the database via the backend endpoint
      const resp = await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_validado: skuValidationResult.product.sku
        })
      });

      if (resp.ok) {
        const newCont = await resp.json();
        const code = `CJ-${newCont.secuencia}`;
        
        // Also register it inside Cajas table so it's fully integrated and searchable!
        const registerCaja = await fetch("/api/cajas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numero_caja: `Caja ${code}`,
            sku: code,
            estado: "vacia",
            temporada_default: skuValidationResult.product.temporada
          })
        });

        if (registerCaja.ok) {
          toast.success(`Caja Especial ${code} creada y asignada al SKU ${skuValidationResult.product.sku}`);
          setShowAddCjxModal(false);
          setSkuToValidate("");
          setSkuValidationResult(null);
          fetchCjxContainers();
          fetchCajas();
        }
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al crear contenedor CJ-X");
      }
    } catch (e) {
      toast.error("Error al conectar con servidor");
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Box Transfer Flow
  const handleTransferBox = async (e: FormEvent) => {
    e.preventDefault();
    if (!transferOriginId || !transferDestId) return;

    setTransferLoading(true);
    try {
      const resp = await fetch("/api/containers/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_caja_origen: parseInt(transferOriginId),
          id_caja_destino: parseInt(transferDestId)
        })
      });

      if (resp.ok) {
        toast.success("Transferencia completada. Stock y códigos heredados correctamente.");
        setShowTransferModal(false);
        setTransferOriginId("");
        setTransferDestId("");
        fetchCajas();
        fetchCjxContainers();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al transferir caja");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setTransferLoading(false);
    }
  };

  const selectCaja = (caja: Caja) => {
    localStorage.setItem("activeCaja", JSON.stringify(caja));
    setActiveCajaId(caja.id_caja);
    toast.success(`Caja ${caja.numero_caja} seleccionada para escaneo`);
  };

  const updateEstado = async (id: number, nuevoEstado: string) => {
    try {
      const resp = await fetch(`/api/cajas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado })
      });
      if (resp.ok) {
        toast.success("Estado actualizado");
        fetchCajas();
      }
    } catch (err) {
      toast.error("Error al actualizar");
    }
  };

  const handleDeleteCaja = async (caja: Caja) => {
    const confirmMsg = `¿Estás seguro de que deseas eliminar la caja "${caja.numero_caja}"? Se desvincularán todos sus productos.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        toast.success(`Caja "${caja.numero_caja}" eliminada con éxito`);
        if (activeCajaId === caja.id_caja) {
          localStorage.removeItem("activeCaja");
          setActiveCajaId(null);
        }
        fetchCajas();
        fetchCjxContainers();
      }
    } catch (err) {
      toast.error("Error de conexión");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "vacia": return "bg-neutral-100 text-neutral-500 border-neutral-200";
      case "activa": return "bg-blue-50 text-blue-600 border-blue-100";
      case "llena": return "bg-emerald-50 text-emerald-600 border-emerald-100";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-neutral-100 shadow-sm">
        <div>
          <h2 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Archive size={32} className="text-neutral-400" /> GESTIÓN DE CAJAS
          </h2>
          <p className="text-sm text-neutral-500 font-medium">Administra contenedores, estados y transferencias de stock</p>
        </div>

        <div className="flex bg-neutral-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveSubTab("standard")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeSubTab === "standard" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            Cajas Estándar
          </button>
          <button
            onClick={() => setActiveSubTab("cjx")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeSubTab === "cjx" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            Cajas Especiales CJ-X
          </button>
        </div>
      </div>

      {activeSubTab === "standard" ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
            <span className="font-extrabold text-sm text-neutral-700">Gestión de Cajas del Inventario</span>
            <Button onClick={() => setShowAddCajaModal(true)} className="rounded-xl h-10 bg-neutral-900 hover:bg-neutral-850 text-white font-bold text-xs shadow-md">
              <Plus className="mr-1.5" size={16} /> Nueva Caja Estándar
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-48 bg-neutral-100 animate-pulse rounded-2xl border" />
              ))
            ) : cajas.length === 0 ? (
              <div className="col-span-full py-20 text-center text-neutral-400">
                <Box size={48} className="mx-auto mb-4 opacity-20" />
                <p>No hay cajas registradas aún.</p>
              </div>
            ) : cajas.map((caja) => (
              <Card 
                key={caja.id_caja} 
                className={`group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 rounded-2xl border-2 ${
                  activeCajaId === caja.id_caja ? "border-blue-500 shadow-blue-100 shadow-lg" : "border-neutral-100"
                }`}
              >
                <div className="absolute top-0 right-0 p-3 flex gap-1 items-center z-10">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="rounded-full bg-white/85 backdrop-blur-sm h-8 w-8 hover:bg-neutral-900 hover:text-white border"
                    onClick={() => setSelectedCaja(caja)}
                    title="Detalles de Caja"
                  >
                    <ExternalLink size={14} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="rounded-full bg-white/85 backdrop-blur-sm h-8 w-8 hover:bg-rose-600 hover:text-white text-rose-600 border"
                    onClick={() => handleDeleteCaja(caja)}
                    title="Eliminar Caja"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className={`${activeCajaId === caja.id_caja ? "bg-blue-600" : "bg-neutral-900"} p-2.5 rounded-xl text-white shadow-lg`}>
                      <Box size={24} />
                    </div>
                    <Badge variant="outline" className={`capitalize border font-bold ${getStatusColor(caja.estado)}`}>
                      {caja.estado}
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl pt-4 font-black tracking-tight">{caja.numero_caja}</CardTitle>
                  {caja.sku && (
                    <span className="text-xs text-neutral-400 font-mono mt-1 block">SKU/Etiqueta: {caja.sku}</span>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="pb-3 flex">
                    {(caja as any).almacen_nombre ? (
                      <span className="font-extrabold text-neutral-700 bg-neutral-100 px-2.5 py-1 rounded-lg text-[9px] uppercase tracking-wider border">
                        📍 {((caja as any).almacen_nombre || "")} {((caja as any).pasillo_nombre && (caja as any).pasillo_nombre !== "Sin pasillo") ? `| ${((caja as any).pasillo_nombre)}` : ""} {((caja as any).seccion_nombre) ? `| ${((caja as any).seccion_nombre)}` : ""}
                      </span>
                    ) : (
                      <span className="italic text-neutral-400 bg-neutral-50 px-2.5 py-1 rounded-lg text-[9px] border">
                        📍 Sin ubicación
                      </span>
                    )}
                  </div>

                  {/* TAGS */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {caja.tags?.tipo_producto && caja.tags.tipo_producto !== "todos" && (
                      <Badge className="bg-neutral-100 text-neutral-800 border border-neutral-200 capitalize text-[9px] px-1.5 py-0">
                        {caja.tags.tipo_producto}
                      </Badge>
                    )}
                    {caja.tags?.genero && caja.tags.genero !== "todos" && (
                      <Badge className="bg-blue-50 text-blue-800 border border-blue-100 text-[9px] px-1.5 py-0 font-extrabold">
                        {caja.tags.genero === "H" ? "H" : "M"}
                      </Badge>
                    )}
                    {caja.tags?.marca && caja.tags.marca !== "todos" && (
                      <Badge className="bg-purple-50 text-purple-800 border border-purple-100 text-[9px] px-1.5 py-0 font-extrabold">
                        {caja.tags.marca}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-3 border-y border-neutral-50 mb-4">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-neutral-400">Modelos</p>
                      <p className="text-xl font-bold">{caja.total_productos_unicos || 0}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-neutral-400">Unidades</p>
                      <p className="text-xl font-bold">{caja.total_unidades || 0}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {caja.estado !== "llena" ? (
                      <>
                        <Button 
                          className={`flex-1 rounded-xl font-bold ${activeCajaId === caja.id_caja ? "bg-blue-600 hover:bg-blue-700" : "bg-neutral-900"}`}
                          onClick={() => selectCaja(caja)}
                        >
                          {activeCajaId === caja.id_caja ? <CheckCircle2 className="mr-2" size={16} /> : "Seleccionar"}
                        </Button>
                        <Button 
                          variant="outline" 
                          className="rounded-xl"
                          onClick={() => updateEstado(caja.id_caja, "llena")}
                        >
                          Cerrar
                        </Button>
                      </>
                    ) : (
                      <Button 
                        variant="outline" 
                        className="w-full rounded-xl gap-2 text-neutral-500 hover:bg-neutral-50"
                        onClick={() => updateEstado(caja.id_caja, "activa")}
                      >
                        <History size={16} /> Reabrir Caja
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        // CJ-X Containers Tab
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
            <span className="font-extrabold text-sm text-neutral-700">Contenedores CJ-X:</span>
            <div className="flex gap-2">
              <Button 
                onClick={() => setShowTransferModal(true)} 
                variant="outline" 
                className="rounded-xl h-10 border-neutral-200 text-neutral-700 font-bold bg-white"
              >
                <ArrowRightLeft className="mr-2" size={16} /> Transferir Caja Dañada
              </Button>
              <Button 
                onClick={() => setShowAddCjxModal(true)} 
                className="rounded-xl h-10 bg-neutral-900 text-white font-bold"
              >
                <Plus className="mr-2" size={16} /> Nueva Caja CJ-X
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {loadingCjx ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-44 bg-neutral-100 animate-pulse rounded-2xl border" />
              ))
            ) : cjxContainers.length === 0 ? (
              <div className="col-span-full py-20 text-center text-neutral-400 border-2 border-dashed rounded-3xl bg-neutral-50/50">
                <Box size={48} className="mx-auto mb-4 opacity-20" />
                <p className="font-semibold text-sm">No hay cajas CJ-X especiales creadas aún.</p>
                <p className="text-xs text-neutral-500 mt-1">Crea una caja especial validando el SKU de producto primero.</p>
              </div>
            ) : (
              cjjxContainersToShow()
            )}
          </div>
        </div>
      )}

      {/* Legacy Caja Details Modal */}
      {selectedCaja && (
        <CajaDetailsModal 
          caja={selectedCaja} 
          onClose={() => {
            setSelectedCaja(null);
            fetchCajas();
            fetchCjxContainers();
          }} 
        />
      )}

      {/* Modal Nueva Caja CJ-X (con Validación SKU) */}
      <Dialog open={showAddCjxModal} onOpenChange={setShowAddCjxModal}>
        <DialogContent className="rounded-3xl max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2">
              <Plus /> Crear Caja Especial CJ-X
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleValidateSku} className="space-y-4 pt-4">
            <p className="text-xs text-neutral-500">
              Ingresa el SKU del producto. El sistema validará que exista en inventario y no tenga otro contenedor especial asignado antes de crear el código autoincremental CJ-X.
            </p>

            <div className="flex gap-2">
              <Input 
                placeholder="SKU a validar (ej: SKU-PANT-01)"
                value={skuToValidate}
                onChange={e => setSkuToValidate(e.target.value)}
                className="rounded-xl h-11"
                required
              />
              <Button type="submit" disabled={isValidatingSku} className="rounded-xl h-11 bg-neutral-900 text-white font-bold shrink-0">
                {isValidatingSku ? <Loader2 className="animate-spin" size={16} /> : "Validar"}
              </Button>
            </div>

            {skuValidationResult && (
              <div className={`p-4 rounded-2xl border text-xs flex flex-col gap-2 ${
                skuValidationResult.exists ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"
              }`}>
                <div className="flex items-center gap-2 font-bold">
                  {skuValidationResult.exists ? <Check size={16} /> : <AlertTriangle size={16} />}
                  <span>{skuValidationResult.exists ? "SKU VÁLIDO" : "SKU NO ENCONTRADO"}</span>
                </div>
                {skuValidationResult.exists && (
                  <>
                    <p>Producto: <strong className="font-extrabold">{skuValidationResult.product.sku}</strong></p>
                    <p>Marca: <span className="capitalize">{skuValidationResult.product.marca_sub}</span> | Talla: {skuValidationResult.product.talla}</p>
                    <p>Temporada: <span className="capitalize">{skuValidationResult.product.temporada}</span></p>
                    
                    <Button 
                      type="button" 
                      onClick={handleCreateCjx}
                      disabled={isCreating}
                      className="w-full mt-2 rounded-xl bg-neutral-950 text-white font-bold h-10 text-xs"
                    >
                      {isCreating ? <Loader2 className="animate-spin" size={16} /> : "Generar Caja CJ-X"}
                    </Button>
                  </>
                )}
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Transferir Caja Rota */}
      <Dialog open={showTransferModal} onOpenChange={setShowTransferModal}>
        <DialogContent className="rounded-3xl max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2">
              <ArrowRightLeft className="text-amber-500" />
              Transferir Caja Rota / Vieja
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleTransferBox} className="space-y-4 pt-4">
            <p className="text-xs text-neutral-500">
              Mueve todo el inventario de una caja dañada a una nueva. La caja de destino heredará el código de barras/SKU y la configuración de la caja de origen. La caja vieja será dada de baja de la jerarquía activa.
            </p>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400">Caja de Origen (Dañada)</label>
              <select
                required
                value={transferOriginId}
                onChange={e => setTransferOriginId(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none"
              >
                <option value="">Selecciona la caja de origen</option>
                {cajas.filter(c => c.estado !== "vacia").map(c => (
                  <option key={c.id_caja} value={c.id_caja}>
                    Caja {c.numero_caja} {c.sku ? `(${c.sku})` : ""} - {c.estado.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400">Caja de Destino (Nueva/Vacia)</label>
              <select
                required
                value={transferDestId}
                onChange={e => setTransferDestId(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none"
              >
                <option value="">Selecciona la caja de destino vacía</option>
                {cajas.filter(c => c.estado === "vacia" && c.id_caja.toString() !== transferOriginId).map(c => (
                  <option key={c.id_caja} value={c.id_caja}>
                    Caja {c.numero_caja} - VACÍA
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-4 border-t flex gap-2">
              <Button type="button" variant="outline" onClick={() => setShowTransferModal(false)} className="rounded-xl flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={transferLoading || !transferOriginId || !transferDestId} className="rounded-xl flex-1 bg-neutral-900 text-white font-bold">
                {transferLoading ? <Loader2 className="animate-spin" size={16} /> : "Ejecutar Transferencia"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Nueva Caja Estándar */}
      <Dialog open={showAddCajaModal} onOpenChange={setShowAddCajaModal}>
        <DialogContent className="rounded-3xl max-w-md p-6 bg-white border border-neutral-100 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2 text-neutral-900">
              <Plus /> Crear Nueva Caja Estándar
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateCaja} className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Identificador / Número de Caja</label>
              <Input
                placeholder="Ej: CJ-15 o Estante Superior A"
                value={newCajaNumber}
                onChange={e => setNewCajaNumber(e.target.value)}
                className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Ubicación (Almacén / Sección)</label>
              <select
                value={selectedValue}
                onChange={e => setSelectedValue(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                required
              >
                <option value="">Seleccione una ubicación...</option>
                {zones.map(z => (
                  <optgroup key={z.id_zona_almacen} label={z.nombre.toUpperCase()}>
                    <option value={`zone_${z.id_zona_almacen}`}>
                      {z.nombre.toUpperCase()} (SIN SECCIÓN ESPECÍFICA)
                    </option>
                    {sections
                      .filter(s => s.id_zona_almacen === z.id_zona_almacen)
                      .map(s => (
                        <option key={s.id_zona_seccion} value={`section_${s.id_zona_seccion}`}>
                          ↳ {s.pasillo_nombre && s.pasillo_nombre !== "Sin pasillo" ? `${s.pasillo_nombre.toUpperCase()} > ` : ""}{s.nombre.toUpperCase()}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Temporada Default (Opcional)</label>
              <select
                value={newCajaTemporada}
                onChange={e => setNewCajaTemporada(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="">Seleccione temporada...</option>
                {temporadasOpts.map((t, idx) => (
                  <option key={idx} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Tipo de Producto</label>
              <select
                value={cajaTipo}
                onChange={e => {
                  setCajaTipo(e.target.value);
                  if (e.target.value !== "calzado") {
                    setCajaMarca("todos");
                  }
                }}
                className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="todos">TODOS / AMBOS</option>
                <option value="ropa">ROPA</option>
                <option value="calzado">CALZADO</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Género Destinado</label>
              <select
                value={cajaGenero}
                onChange={e => setCajaGenero(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="todos">UNISEX / TODOS</option>
                <option value="H">HOMBRE (H)</option>
                <option value="M">MUJER (M)</option>
              </select>
            </div>

            {cajaTipo === "calzado" && (
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Marca de Calzado</label>
                <select
                  value={cajaMarca}
                  onChange={e => setCajaMarca(e.target.value)}
                  className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                >
                  <option value="todos">TODAS / AMBAS</option>
                  <option value="Marciano">MARCIANO (M)</option>
                  <option value="Guess">GUESS (G)</option>
                </select>
              </div>
            )}

            <DialogFooter className="pt-4 border-t flex gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddCajaModal(false)} className="rounded-xl flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={isCreating || !newCajaNumber.trim() || !selectedValue} className="rounded-xl flex-1 bg-neutral-900 text-white font-bold">
                {isCreating ? <Loader2 className="animate-spin" size={16} /> : "Crear Caja"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );

  function cjjxContainersToShow() {
    return cjxContainers.map((node) => {
      const code = `${node.prefijo}-${node.secuencia}`;
      return (
        <Card 
          key={node.id} 
          className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl rounded-2xl border border-neutral-200"
        >
          <div className="absolute top-0 right-0 p-3 flex gap-1 items-center z-10">
            <Button 
              variant="ghost" 
              size="icon" 
              className="rounded-full bg-white/80 h-8 w-8 hover:bg-neutral-900 hover:text-white border"
              onClick={() => {
                const cajaObj: Caja = {
                  id_caja: node.id,
                  numero_caja: `Caja ${code}`,
                  sku: code,
                  estado: node.estado as any,
                  fecha_creacion: node.created_at
                };
                setSelectedCaja(cajaObj);
              }}
            >
              <ExternalLink size={14} />
            </Button>
          </div>

          <CardHeader className="pb-2">
            <div className="flex justify-between items-start">
              <div className="bg-amber-500 p-2.5 rounded-xl text-black shadow-md">
                <Box size={24} />
              </div>
              <Badge variant="outline" className={`capitalize border font-bold ${getStatusColor(node.estado)}`}>
                {node.estado}
              </Badge>
            </div>
            <CardTitle className="text-xl pt-4 font-black tracking-tight">{code}</CardTitle>
            <span className="text-[10px] text-neutral-500 font-mono font-bold bg-neutral-100 px-2 py-0.5 rounded-full w-fit mt-1">
              SKU: {node.sku_validado}
            </span>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full text-xs font-bold rounded-xl"
                onClick={() => {
                  const cajaObj: Caja = {
                    id_caja: node.id,
                    numero_caja: `Caja ${code}`,
                    sku: code,
                    estado: node.estado as any,
                    fecha_creacion: node.created_at
                  };
                  selectCaja(cajaObj);
                }}
              >
                Asociar Escáner
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    });
  }
}
