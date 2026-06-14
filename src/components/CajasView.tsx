import React, { useState, useEffect, useRef, FormEvent } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  Plus, Box, ExternalLink, Archive, CheckCircle2, History, Loader2, 
  Trash2, ArrowRightLeft, AlertTriangle, Check, RefreshCw, Network,
  Scan, Search, X
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
  const [activeSubTab, setActiveSubTab] = useState<"standard" | "cjx" | "niveles">("standard");

  // Legacy cajas state
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [niveles, setNiveles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCajaNumber, setNewCajaNumber] = useState("");
  const [newCajaSku, setNewCajaSku] = useState("");
  const [newCajaPrefix, setNewCajaPrefix] = useState("manual");
  const [zones, setZones] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedValue, setSelectedValue] = useState("");
  const [newCajaTemporada, setNewCajaTemporada] = useState("");
  const [temporadasOpts, setTemporadasOpts] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCaja, setSelectedCaja] = useState<Caja | null>(null);
  const [openedViaQuickFind, setOpenedViaQuickFind] = useState(false);
  const [activeCajaId, setActiveCajaId] = useState<number | null>(null);

  // CJ-X containers state
  const [cjxContainers, setCjxContainers] = useState<CJXContainer[]>([]);
  const [loadingCjx, setLoadingCjx] = useState(false);
  const [loadingNiveles, setLoadingNiveles] = useState(false);
  const [skuToValidate, setSkuToValidate] = useState("");
  const [isValidatingSku, setIsValidatingSku] = useState(false);
  const [skuValidationResult, setSkuValidationResult] = useState<any>(null);
  const [showAddCjxModal, setShowAddCjxModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAddCajaModal, setShowAddCajaModal] = useState(false);
  const [cajaTipo, setCajaTipo] = useState("todos");
  const [cajaGenero, setCajaGenero] = useState("todos");
  const [cajaMarca, setCajaMarca] = useState("todos");

  // Quick-find / scanner states
  const [quickFindQuery, setQuickFindQuery] = useState("");
  const [quickFindLoading, setQuickFindLoading] = useState(false);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Transfer form state
  const [transferOriginId, setTransferOriginId] = useState("");
  const [transferDestId, setTransferDestId] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const openCajaModal = (caja: Caja, viaQuickFind = false) => {
    setOpenedViaQuickFind(viaQuickFind);
    setSelectedCaja(caja);
  };

  useEffect(() => {
    fetchCajas();
    fetchNiveles();
    fetchLocations();
    fetchTemporadas();
    fetchCjxContainers();
    const saved = localStorage.getItem("activeCaja");
    if (saved) {
      setActiveCajaId(JSON.parse(saved).id_caja);
    }
    return () => { stopScanner(); };
  }, []);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) await scannerRef.current.stop();
      } catch (_) {}
      scannerRef.current = null;
    }
    setIsScannerActive(false);
  };

  const startScanner = async () => {
    await stopScanner();
    setIsScannerActive(true);
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById("cajas-quick-reader");
    if (!el) { setIsScannerActive(false); return; }
    try {
      const qr = new Html5Qrcode("cajas-quick-reader");
      scannerRef.current = qr;
      await qr.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.UPC_A,
          ]
        } as any,
        (decoded) => {
          stopScanner();
          setQuickFindQuery(decoded);
          handleQuickFind(decoded);
        },
        () => {}
      );
      toast.success("Cámara activada — apunta a la etiqueta del contenedor");
    } catch {
      toast.error("No se pudo activar la cámara");
      setIsScannerActive(false);
    }
  };

  // Search in the active tab's list and open the matching container modal
  const handleQuickFind = async (rawQuery: string) => {
    const q = rawQuery.trim().toUpperCase();
    if (!q) return;
    setQuickFindLoading(true);
    try {
      if (activeSubTab === "niveles") {
        const match = niveles.find(
          (n: any) =>
            n.nombre?.toUpperCase() === q ||
            n.sku?.toUpperCase() === q ||
            n.nombre?.toUpperCase().includes(q)
        );
        if (match) {
          toast.success(`Nivel encontrado: ${match.nombre}`);
          await handleOpenNivelDetails(match);
        } else {
          toast.error(`No se encontró ningún nivel con "${rawQuery.trim()}" en esta pestaña`);
        }
      } else {
        // Standard or CJ-X cajas
        const listToSearch = activeSubTab === "standard"
          ? cajas.filter((c: any) => !c.numero_caja?.toUpperCase().startsWith("NIVEL:"))
          : cajas.filter((c: any) => c.sku?.startsWith("CJ-"));

        const match = listToSearch.find(
          (c) =>
            c.sku?.toUpperCase() === q ||
            c.numero_caja?.toUpperCase() === q ||
            c.sku?.toUpperCase().includes(q) ||
            c.numero_caja?.toUpperCase().includes(q)
        );

        if (match) {
          toast.success(`Contenedor encontrado: ${match.numero_caja}`);
          openCajaModal(match, true);
        } else {
          // Try fetching fresh in case the local list is stale
          const resp = await fetch("/api/cajas");
          if (resp.ok) {
            const freshList: Caja[] = await resp.json();
            const freshMatch = freshList.find(
              (c) =>
                c.sku?.toUpperCase() === q ||
                c.numero_caja?.toUpperCase() === q ||
                c.sku?.toUpperCase().includes(q) ||
                c.numero_caja?.toUpperCase().includes(q)
            );
            if (freshMatch) {
              setCajas(freshList);
              toast.success(`Contenedor encontrado: ${freshMatch.numero_caja}`);
              openCajaModal(freshMatch, true);
            } else {
              toast.error(`No se encontró "${rawQuery.trim()}" en la pestaña activa`);
            }
          }
        }
      }
    } catch {
      toast.error("Error al buscar el contenedor");
    } finally {
      setQuickFindLoading(false);
    }
  };

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
        const dataList = Array.isArray(data) ? data : [];
        // Filters boxes that have SKU matching the CJ-X pattern
        const filtered = dataList.filter((c: any) => c.sku && c.sku.startsWith("CJ-"));
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

  const fetchNiveles = async () => {
    setLoadingNiveles(true);
    try {
      const resp = await fetch("/api/almacen/niveles");
      if (resp.ok) {
        const data = await resp.json();
        setNiveles(data);
      }
    } catch (err) {
      console.error("Error al cargar niveles:", err);
    } finally {
      setLoadingNiveles(false);
    }
  };

  const handleOpenNivelDetails = async (nivel: any) => {
    // Find matching virtual box
    const matchingCaja = cajas.find((c: any) => c.id_zona_nivel === nivel.id_zona_nivel);
    if (matchingCaja) {
      openCajaModal(matchingCaja, false);
      return;
    }

    setLoadingNiveles(true);
    try {
      const resp = await fetch("/api/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_caja: `NIVEL: ${nivel.nombre.toUpperCase()}`,
          id_zona_nivel: nivel.id_zona_nivel,
          tags: nivel.tags || { tipo_producto: "todos", genero: "todos", marca: "todos" }
        })
      });
      if (resp.ok) {
        const newBox = await resp.json();
        setCajas((prev) => [...prev, newBox]);
        openCajaModal(newBox, false);
      } else {
        const err = await resp.json();
        toast.error(`No se pudo abrir el detalle del nivel: ${err.error || 'Error desconocido'}`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión al abrir el detalle del nivel");
    } finally {
      setLoadingNiveles(false);
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

  const handlePrefixChange = async (prefix: string) => {
    setNewCajaPrefix(prefix);
    if (prefix === "manual") {
      return;
    }
    
    let lookupPrefix = "";
    if (prefix === "CJ-X") lookupPrefix = "CJ-";
    else if (prefix === "CJ-PLX") lookupPrefix = "CJ-PL";
    else if (prefix === "CJ-PFX") lookupPrefix = "CJ-PF";
    
    if (!lookupPrefix) return;
    
    try {
      const resp = await fetch(`/api/cajas/next-number?prefix=${encodeURIComponent(lookupPrefix)}`);
      if (resp.ok) {
        const { nextNumber } = await resp.json();
        const code = `${lookupPrefix}${nextNumber}`;
        setNewCajaNumber(code);
        setNewCajaSku(code);
      }
    } catch (err) {
      console.error("Error fetching next box number:", err);
      toast.error("Error al autogenerar número de caja");
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
          sku: newCajaSku || null,
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
        setNewCajaSku("");
        setNewCajaPrefix("manual");
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
            <Archive size={32} className="text-neutral-400" /> GESTIÓN DE CONTENEDORES
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
          <button
            onClick={() => setActiveSubTab("niveles")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeSubTab === "niveles" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            Niveles
          </button>
        </div>
      </div>

      {/* ── Quick-Find Bar ──────────────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-2xl shadow-sm p-3">
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Scanner is now rendered inside a Dialog modal */}

          {/* Search input */}
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <Input
              placeholder={`Buscar ${activeSubTab === "niveles" ? "nivel" : "contenedor"} por nombre, número o SKU...`}
              value={quickFindQuery}
              onChange={e => setQuickFindQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleQuickFind(quickFindQuery)}
              className="pl-8 h-9 rounded-xl bg-neutral-50 border-neutral-200 text-sm"
            />
          </div>

          {/* Search button */}
          <Button
            onClick={() => handleQuickFind(quickFindQuery)}
            disabled={quickFindLoading || !quickFindQuery.trim()}
            className="h-9 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white font-bold shrink-0"
          >
            {quickFindLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </Button>

          {/* Camera toggle */}
          {isScannerActive ? (
            <Button
              onClick={stopScanner}
              variant="destructive"
              className="h-9 px-3 rounded-xl font-bold shrink-0 text-xs gap-1.5"
            >
              <X size={13} /> Apagar
            </Button>
          ) : (
            <Button
              onClick={startScanner}
              variant="outline"
              className="h-9 px-3 rounded-xl border-neutral-200 font-bold shrink-0 gap-1.5 text-xs"
              title="Escanear etiqueta del contenedor"
            >
              <Scan size={14} /> Escanear
            </Button>
          )}

          {/* Clear query */}
          {quickFindQuery && !isScannerActive && (
            <button
              onClick={() => setQuickFindQuery("")}
              className="text-neutral-400 hover:text-neutral-700 p-1 shrink-0"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {activeSubTab === "standard" ? (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
            <span className="font-extrabold text-sm text-neutral-700">Gestión de Contenedores del Inventario</span>
            <Button onClick={() => setShowAddCajaModal(true)} className="w-full sm:w-auto rounded-xl h-10 bg-neutral-900 hover:bg-neutral-850 text-white font-bold text-xs shadow-md">
              <Plus className="mr-1.5" size={16} /> Nueva Caja Estándar
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-48 bg-neutral-100 animate-pulse rounded-2xl border" />
              ))
            ) : cajas.filter((c: any) => !c.numero_caja?.toUpperCase().startsWith("NIVEL:")).length === 0 ? (
              <div className="col-span-full py-20 text-center text-neutral-400">
                <Box size={48} className="mx-auto mb-4 opacity-20" />
                <p>No hay cajas registradas aún.</p>
              </div>
            ) : cajas.filter((c: any) => !c.numero_caja?.toUpperCase().startsWith("NIVEL:")).map((caja) => (
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
                    onClick={() => openCajaModal(caja, false)}
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
      ) : activeSubTab === "cjx" ? (
        // CJ-X Containers Tab
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
            <span className="font-extrabold text-sm text-neutral-700">Contenedores CJ-X:</span>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button 
                onClick={() => setShowTransferModal(true)} 
                variant="outline" 
                className="w-full sm:w-auto rounded-xl h-10 border-neutral-200 text-neutral-700 font-bold bg-white text-xs"
              >
                <ArrowRightLeft className="mr-2" size={16} /> Transferir Caja Dañada
              </Button>
              <Button 
                onClick={() => setShowAddCjxModal(true)} 
                className="w-full sm:w-auto rounded-xl h-10 bg-neutral-900 text-white font-bold text-xs"
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
      ) : activeSubTab === "niveles" ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
            <span className="font-extrabold text-sm text-neutral-700">Gestión de Niveles (Nivel 4)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {loadingNiveles ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-48 bg-neutral-100 animate-pulse rounded-2xl border" />
              ))
            ) : niveles.length === 0 ? (
              <div className="col-span-full py-20 text-center text-neutral-400">
                <Network size={48} className="mx-auto mb-4 opacity-20" />
                <p>No hay niveles registrados aún.</p>
              </div>
            ) : niveles.map((nivel) => (
              <Card 
                key={nivel.id_zona_nivel} 
                className={`group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 rounded-2xl border-2 border-neutral-100 bg-white`}
              >
                <div className="absolute top-0 right-0 p-3 flex gap-1 items-center z-10">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="rounded-full bg-white/85 backdrop-blur-sm h-8 w-8 hover:bg-neutral-900 hover:text-white border"
                    onClick={() => handleOpenNivelDetails(nivel)}
                    title="Detalles de Nivel"
                  >
                    <ExternalLink size={14} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="rounded-full bg-white/85 backdrop-blur-sm h-8 w-8 hover:bg-rose-600 hover:text-white text-rose-600 border"
                    onClick={() => {
                      if(window.confirm(`¿Eliminar nivel ${nivel.nombre}?`)) {
                        fetch(`/api/almacen/niveles/${nivel.id_zona_nivel}`, { method: 'DELETE' })
                        .then(() => { toast.success('Nivel eliminado'); fetchNiveles(); })
                        .catch(() => toast.error('Error al eliminar'));
                      }
                    }}
                    title="Eliminar Nivel"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="bg-neutral-900 p-2.5 rounded-xl text-white shadow-lg">
                      <Network size={24} />
                    </div>
                    <Badge variant="outline" className={`capitalize border font-bold ${getStatusColor(nivel.estado)}`}>
                      {nivel.estado}
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl pt-4 font-black tracking-tight">{nivel.nombre}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="pb-3 flex flex-wrap gap-1">
                    <span className="font-extrabold text-neutral-700 bg-neutral-100 px-2.5 py-1 rounded-lg text-[9px] uppercase tracking-wider border">
                      📍 {nivel.almacen_nombre || "N/A"} | {nivel.pasillo_nombre || "N/A"} | {nivel.seccion_nombre || "N/A"}
                    </span>
                  </div>

                  {/* TAGS */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {nivel.tags?.tipo_producto && nivel.tags.tipo_producto !== "todos" && (
                      <Badge className="bg-neutral-100 text-neutral-800 border border-neutral-200 capitalize text-[9px] px-1.5 py-0">
                        {nivel.tags.tipo_producto}
                      </Badge>
                    )}
                    {nivel.tags?.genero && nivel.tags.genero !== "todos" && (
                      <Badge className="bg-blue-50 text-blue-800 border border-blue-100 text-[9px] px-1.5 py-0 font-extrabold">
                        {nivel.tags.genero === "H" ? "H" : "M"}
                      </Badge>
                    )}
                    {nivel.tags?.marca && nivel.tags.marca !== "todos" && (
                      <Badge className="bg-purple-50 text-purple-800 border border-purple-100 text-[9px] px-1.5 py-0 font-extrabold">
                        {nivel.tags.marca}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* Legacy Caja Details Modal */}
      {selectedCaja && (
        <CajaDetailsModal 
          caja={selectedCaja} 
          openedViaQuickFind={openedViaQuickFind}
          onClose={() => {
            setSelectedCaja(null);
            setOpenedViaQuickFind(false);
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
                {cajas.filter(c => c.estado !== "vacia" && !c.numero_caja?.toUpperCase().startsWith("NIVEL:")).map(c => (
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
                {cajas.filter(c => c.estado === "vacia" && c.id_caja.toString() !== transferOriginId && !c.numero_caja?.toUpperCase().startsWith("NIVEL:")).map(c => (
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
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Patrón de Prefijo</label>
              <select
                value={newCajaPrefix}
                onChange={e => handlePrefixChange(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="manual">Manual (Personalizado)</option>
                <option value="CJ-X">CJ-X (Caja Normal)</option>
                <option value="CJ-PLX">CJ-PLX (Caja Plana/PL)</option>
                <option value="CJ-PFX">CJ-PFX (Caja Perfume/PF)</option>
              </select>
            </div>

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
              <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">SKU / Código Barra (Opcional)</label>
              <Input
                placeholder="Ej: CJ-15"
                value={newCajaSku}
                onChange={e => setNewCajaSku(e.target.value)}
                className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
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

      {/* Modal Escáner de Búsqueda Rápida */}
      <Dialog open={isScannerActive} onOpenChange={(open) => { if (!open) stopScanner(); }}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-black flex items-center gap-2">
              <Scan className="text-neutral-900" size={20} />
              Escanear Etiqueta de Contenedor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-neutral-500 font-medium">
              Apunta la cámara al código de barra o QR del contenedor para buscarlo y seleccionarlo.
            </p>
            <div className="relative rounded-2xl overflow-hidden bg-neutral-100 border min-h-[250px] flex items-center justify-center animate-in fade-in zoom-in-95 duration-200">
              <div id="cajas-quick-reader" className="w-full h-full"></div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={stopScanner} 
                className="w-full rounded-xl h-11 font-bold text-xs"
              >
                Cancelar
              </Button>
            </div>
          </div>
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
                openCajaModal(cajaObj, false);
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
