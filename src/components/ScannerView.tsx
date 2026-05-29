import { useState, useEffect, useRef, FormEvent } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Box, Package, Camera, Power, RefreshCw, Scan, MapPin, Home, Repeat, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ProductQuickRegister from "./ProductQuickRegister";
import { Caja, Producto } from "../types";
import { Input } from "@/components/ui/input";

export default function ScannerView() {
  const [activeMode, setActiveMode] = useState<"caja" | "nivel" | "seccion" | "almacen">("caja");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedAlmacenId, setSelectedAlmacenId] = useState("");
  const [selectedNivelId, setSelectedNivelId] = useState("");
  const [zones, setZones] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [niveles, setNiveles] = useState<any[]>([]);
  const [cajas, setCajas] = useState<any[]>([]);
  const [resolvedTargetCaja, setResolvedTargetCaja] = useState<Caja | null>(null);

  const [isScannerActive, setIsScannerActive] = useState(false);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [activeCaja, setActiveCaja] = useState<Caja | null>(null);
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [manualQty, setManualQty] = useState<number | "">(1);
  const [pendingQty, setPendingQty] = useState(1);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const preventReactivateRef = useRef(false);

  // Modo continuo
  const [continuousScan, setContinuousScan] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [lastScannedTime, setLastScannedTime] = useState<number>(0);
  
  // Modales de cantidad
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [showPostRegisterModal, setShowPostRegisterModal] = useState(false);
  const [qtyModalValue, setQtyModalValue] = useState<number | "">(1);
  const [registeredProduct, setRegisteredProduct] = useState<Producto | null>(null);

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    
    const query = manualInput.trim();
    const finalQty = manualQty === "" ? 1 : manualQty;
    setScannedResult(query);
    verifyProduct(query, finalQty);
    setManualInput("");
    setManualQty(1);
  };

  const fetchLocations = async () => {
    try {
      const [zonesResp, sectionsResp, nivelesResp] = await Promise.all([
        fetch("/api/almacen/zonas"),
        fetch("/api/almacen/secciones"),
        fetch("/api/almacen/niveles")
      ]);
      if (zonesResp.ok && sectionsResp.ok && nivelesResp.ok) {
        const [zonesData, sectionsData, nivelesData] = await Promise.all([
          zonesResp.json(),
          sectionsResp.json(),
          nivelesResp.json()
        ]);
        setZones(zonesData);
        setSections(sectionsData);
        setNiveles(nivelesData);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCajas = async () => {
    try {
      const resp = await fetch("/api/cajas");
      if (resp.ok) {
        const data = await resp.json();
        setCajas(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // Cargar la caja seleccionada del localStorage si existe
    const savedCaja = localStorage.getItem("activeCaja");
    if (savedCaja) {
      const parsed = JSON.parse(savedCaja);
      setActiveCaja(parsed);
      setResolvedTargetCaja(parsed);
    }

    const savedSec = localStorage.getItem("activeScannerSectionId");
    if (savedSec) {
      setSelectedSectionId(savedSec);
    }
    const savedAlm = localStorage.getItem("activeScannerAlmacenId");
    if (savedAlm) {
      setSelectedAlmacenId(savedAlm);
    }
    const savedNivel = localStorage.getItem("activeScannerNivelId");
    if (savedNivel) {
      setSelectedNivelId(savedNivel);
    }

    fetchLocations();
    fetchCajas();

    return () => {
      if (scannerRef.current) {
        const cleanupScanner = async () => {
          try {
            if (scannerRef.current?.isScanning) {
              await scannerRef.current.stop();
            }
            scannerRef.current?.clear();
          } catch (e) {
            console.error("Error en cleanup del scanner:", e);
          }
        };
        cleanupScanner();
      }
    };
  }, []);

  useEffect(() => {
    const updateResolvedTarget = () => {
      if (activeMode === "caja") {
        setResolvedTargetCaja(activeCaja);
      } else if (activeMode === "nivel") {
        if (selectedNivelId && niveles.length > 0) {
          const lvlId = parseInt(selectedNivelId);
          const lvl = niveles.find(n => n.id_zona_nivel === lvlId);
          if (lvl) {
            const nameToMatch = `NIVEL: ${lvl.nombre.toUpperCase()}`;
            const existing = cajas.find(c => c.id_zona_nivel === lvlId && c.numero_caja === nameToMatch);
            if (existing) {
              setResolvedTargetCaja(existing);
            } else {
              setResolvedTargetCaja(null);
            }
          } else {
            setResolvedTargetCaja(null);
          }
        } else {
          setResolvedTargetCaja(null);
        }
      } else if (activeMode === "seccion") {
        if (selectedSectionId && sections.length > 0) {
          const secId = parseInt(selectedSectionId);
          const sec = sections.find(s => s.id_zona_seccion === secId);
          if (sec) {
            const nameToMatch = `SECCIÓN: ${sec.nombre.toUpperCase()}`;
            const existing = cajas.find(c => c.id_zona_seccion === secId && c.numero_caja === nameToMatch);
            if (existing) {
              setResolvedTargetCaja(existing);
            } else {
              setResolvedTargetCaja(null);
            }
          } else {
            setResolvedTargetCaja(null);
          }
        } else {
          setResolvedTargetCaja(null);
        }
      } else if (activeMode === "almacen") {
        if (selectedAlmacenId && zones.length > 0) {
          const zoneId = parseInt(selectedAlmacenId);
          const zone = zones.find(z => z.id_zona_almacen === zoneId);
          if (zone) {
            const nameToMatch = `ALMACÉN: ${zone.nombre.toUpperCase()}`;
            const existing = cajas.find(c => c.id_zona_almacen === zoneId && !c.id_zona_seccion && c.numero_caja === nameToMatch);
            if (existing) {
              setResolvedTargetCaja(existing);
            } else {
              setResolvedTargetCaja(null);
            }
          } else {
            setResolvedTargetCaja(null);
          }
        } else {
          setResolvedTargetCaja(null);
        }
      }
    };
    updateResolvedTarget();
  }, [activeMode, activeCaja, selectedSectionId, selectedAlmacenId, selectedNivelId, sections, zones, niveles, cajas]);

  const startScanner = async () => {
    try {
      let html5QrCode = scannerRef.current;
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;
      }

      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }

      setIsScannerActive(true);

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
        },
        onScanSuccess,
        (errorMessage) => {
          // Omitimos loggear warnings constantes de no detección por frame
        }
      );
      toast.success("Cámara iniciada correctamente");
    } catch (err: any) {
      console.error("Error al iniciar el escáner:", err);
      toast.error(`No se pudo acceder a la cámara: ${err.name || "Error"} - ${err.message || err}`);
      setIsScannerActive(false);
      if (scannerRef.current) {
        try {
          scannerRef.current.clear();
        } catch (e) {}
        scannerRef.current = null;
      }
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
        setIsScannerActive(false);
        scannerRef.current = null;
      } catch (err) {
        console.error("Failed to stop scanner", err);
        toast.error("Error al apagar la cámara");
        setIsScannerActive(false);
        scannerRef.current = null;
      }
    } else {
      setIsScannerActive(false);
    }
  };

  const onScanSuccess = (decodedText: string) => {
    if (isChecking) return;
    
    if (continuousScan) {
      const now = Date.now();
      if (decodedText === lastScannedCode && now - lastScannedTime < 2000) {
        return; // ignore duplicates for 2 seconds
      }
      setLastScannedCode(decodedText);
      setLastScannedTime(now);
      toast.info(`EAN continuo: ${decodedText}`);
      verifyProductContinuous(decodedText);
    } else {
      stopScanner();
      setScannedResult(decodedText);
      verifyProduct(decodedText);
      toast.info(`EAN detectado: ${decodedText}`);
    }
  };

  const verifyProductContinuous = async (ean: string) => {
    let targetCaja = activeCaja;
    
    if (activeMode === "nivel") {
      if (!selectedNivelId) {
        toast.error("Selecciona un nivel activo primero");
        return;
      }
      try {
        const box = await getOrCreateNivelCaja(parseInt(selectedNivelId));
        targetCaja = box;
      } catch (err: any) {
        toast.error(err.message || "Error al obtener contenedor de nivel");
        return;
      }
    } else if (activeMode === "seccion") {
      if (!selectedSectionId) {
        toast.error("Selecciona una sección activa primero");
        return;
      }
      try {
        const box = await getOrCreateSectionCaja(parseInt(selectedSectionId));
        targetCaja = box;
      } catch (err: any) {
        toast.error(err.message || "Error al obtener contenedor de sección");
        return;
      }
    } else if (activeMode === "almacen") {
      if (!selectedAlmacenId) {
        toast.error("Selecciona un almacén activo primero");
        return;
      }
      try {
        const box = await getOrCreateZoneCaja(parseInt(selectedAlmacenId));
        targetCaja = box;
      } catch (err: any) {
        toast.error(err.message || "Error al obtener contenedor de almacén");
        return;
      }
    } else {
      if (!activeCaja) {
        toast.error("Selecciona una caja activa primero en la pestaña de Cajas");
        return;
      }
    }

    try {
      const resp = await fetch(`/api/verificar/${ean}`);
      const data = await resp.json();
      
      if (!data.exists) {
        stopScanner();
        setScannedResult(ean);
        setVerificationResult(data);
        setResolvedTargetCaja(targetCaja);
        setShowQuickRegister(true);
        toast.warning("Producto no registrado. Inicia registro rápido.");
      } else if (data.ubicacion && data.ubicacion.numero_caja !== targetCaja?.numero_caja) {
        stopScanner();
        setScannedResult(ean);
        setVerificationResult(data);
        setResolvedTargetCaja(targetCaja);
        setShowConflictDialog(true);
        toast.warning("Conflicto de ubicación. Escaneo pausado.");
      } else {
        const id_producto = data.product.id_producto;
        const res = await fetch(`/api/cajas/${targetCaja.id_caja}/asignar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_producto, force: false, cantidad: 1 })
        });
        if (res.ok) {
          toast.success(`[Lote] 1 unidad de ${data.product.sku} agregada a ${targetCaja.numero_caja}`);
          fetchCajas();
        } else {
          const errData = await res.json();
          toast.error(errData.error || "Error al asignar");
        }
      }
    } catch (error) {
      toast.error("Error en escaneo continuo");
    }
  };

  const onScanError = (errorMessage: string) => {
    // console.warn(errorMessage);
  };

  const getOrCreateSectionCaja = async (secId: number) => {
    const sec = sections.find(s => s.id_zona_seccion === secId);
    if (!sec) throw new Error("Sección no encontrada");
    
    const nameToMatch = `SECCIÓN: ${sec.nombre.toUpperCase()}`;
    const existing = cajas.find(c => c.id_zona_seccion === secId && c.numero_caja === nameToMatch);
    if (existing) {
      return existing;
    }
    
    const resp = await fetch("/api/cajas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero_caja: nameToMatch,
        id_zona_seccion: secId,
        id_zona_almacen: null
      })
    });
    if (resp.ok) {
      const newCaja = await resp.json();
      await fetchCajas();
      return newCaja;
    } else {
      throw new Error("No se pudo crear la caja de sección");
    }
  };

  const getOrCreateZoneCaja = async (zoneId: number) => {
    const zone = zones.find(z => z.id_zona_almacen === zoneId);
    if (!zone) throw new Error("Zona no encontrada");
    
    const nameToMatch = `ALMACÉN: ${zone.nombre.toUpperCase()}`;
    const existing = cajas.find(c => c.id_zona_almacen === zoneId && !c.id_zona_seccion && c.numero_caja === nameToMatch);
    if (existing) {
      return existing;
    }
    
    const resp = await fetch("/api/cajas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero_caja: nameToMatch,
        id_zona_almacen: zoneId,
        id_zona_seccion: null
      })
    });
    if (resp.ok) {
      const newCaja = await resp.json();
      await fetchCajas();
      return newCaja;
    } else {
      throw new Error("No se pudo crear la caja de almacén");
    }
  };

  const getOrCreateNivelCaja = async (lvlId: number) => {
    const lvl = niveles.find(n => n.id_zona_nivel === lvlId);
    if (!lvl) throw new Error("Nivel no encontrado");
    
    const nameToMatch = `NIVEL: ${lvl.nombre.toUpperCase()}`;
    const existing = cajas.find(c => c.id_zona_nivel === lvlId && c.numero_caja === nameToMatch);
    if (existing) {
      return existing;
    }
    
    const resp = await fetch("/api/cajas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero_caja: nameToMatch,
        id_zona_nivel: lvlId,
        id_zona_seccion: lvl.id_zona_seccion,
        id_zona_almacen: null
      })
    });
    if (resp.ok) {
      const newCaja = await resp.json();
      await fetchCajas();
      return newCaja;
    } else {
      throw new Error("No se pudo crear la caja de nivel");
    }
  };

  const verifyProduct = async (ean: string, qty = 1) => {
    let targetCaja = activeCaja;
    
    if (activeMode === "nivel") {
      if (!selectedNivelId) {
        toast.error("Selecciona un nivel activo primero");
        return;
      }
      setIsChecking(true);
      try {
        const box = await getOrCreateNivelCaja(parseInt(selectedNivelId));
        targetCaja = box;
      } catch (err: any) {
        toast.error(err.message || "Error al obtener contenedor de nivel");
        setIsChecking(false);
        return;
      }
    } else if (activeMode === "seccion") {
      if (!selectedSectionId) {
        toast.error("Selecciona una sección activa primero");
        return;
      }
      setIsChecking(true);
      try {
        const box = await getOrCreateSectionCaja(parseInt(selectedSectionId));
        targetCaja = box;
      } catch (err: any) {
        toast.error(err.message || "Error al obtener contenedor de sección");
        setIsChecking(false);
        return;
      }
    } else if (activeMode === "almacen") {
      if (!selectedAlmacenId) {
        toast.error("Selecciona un almacén activo primero");
        return;
      }
      setIsChecking(true);
      try {
        const box = await getOrCreateZoneCaja(parseInt(selectedAlmacenId));
        targetCaja = box;
      } catch (err: any) {
        toast.error(err.message || "Error al obtener contenedor de almacén");
        setIsChecking(false);
        return;
      }
    } else {
      if (!activeCaja) {
        toast.error("Selecciona una caja activa primero en la pestaña de Cajas");
        return;
      }
    }

    setResolvedTargetCaja(targetCaja);
    setIsChecking(true);
    setPendingQty(qty);
    try {
      const resp = await fetch(`/api/verificar/${ean}`);
      const data = await resp.json();
      
      setVerificationResult(data);
      
      if (!data.exists) {
        toast.warning("Producto no encontrado. ¿Registrar ahora?");
        setShowQuickRegister(true);
      } else {
        // En vez de agregar directo, abrimos modal de cantidad
        setResolvedTargetCaja(targetCaja);
        setQtyModalValue(1);
        setShowQtyModal(true);
      }
    } catch (error) {
      toast.error("Error al verificar producto");
    } finally {
      setIsChecking(false);
    }
  };

  const handleConflictClose = (open: boolean) => {
    if (!open) {
      setShowConflictDialog(false);
      if (!preventReactivateRef.current) {
        startScanner();
      }
      preventReactivateRef.current = false;
    }
  };

  const asignarProducto = async (id_producto: number, force = false, qty = 1, accion?: 'mover' | 'agregar', customCaja?: Caja | null) => {
    const targetCaja = customCaja !== undefined ? customCaja : (resolvedTargetCaja || activeCaja);
    if (!targetCaja) return;

    try {
      preventReactivateRef.current = true;
      const resp = await fetch(`/api/cajas/${targetCaja.id_caja}/asignar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_producto, force, cantidad: qty, accion })
      });
      
      if (resp.ok) {
        toast.success(accion === 'mover' ? "Producto movido de ubicación" : "Producto asignado correctamente");
        setVerificationResult(null);
        setScannedResult(null);
        setShowConflictDialog(false);
        fetchCajas(); // Refresca cajas
      } else {
        const errorData = await resp.json();
        toast.error(errorData.error || "Error al asignar");
      }
    } catch (error) {
      toast.error("Error de conexión");
    }
  };

  const isTargetSelected = () => {
    if (activeMode === "caja") return !!activeCaja;
    if (activeMode === "nivel") return !!selectedNivelId;
    if (activeMode === "seccion") return !!selectedSectionId;
    if (activeMode === "almacen") return !!selectedAlmacenId;
    return false;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-28 md:pb-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-neutral-100">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight uppercase text-neutral-900 leading-none">ESCÁNER</h2>
          <p className="text-xs md:text-sm text-neutral-500 font-medium mt-1">Asocia productos a cajas, niveles, secciones o almacenes</p>
        </div>
        
        {/* Tab switcher for scanner modes */}
        <div className="flex bg-neutral-100 p-2 md:p-1.5 rounded-2xl border overflow-x-auto max-w-full whitespace-nowrap scrollbar-none flex-row shrink-0 gap-2 md:gap-1 w-full md:w-auto justify-start">
          <button
            onClick={() => setActiveMode("caja")}
            className={`flex items-center gap-2 px-5 py-3 md:px-4 md:py-2 rounded-xl text-sm md:text-xs font-black uppercase tracking-wider transition-all shrink-0 ${
              activeMode === "caja"
                ? "bg-white text-neutral-950 shadow-md"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Box size={16} className="md:w-3.5 md:h-3.5" />
            Cajas (Nivel 5)
          </button>
          <button
            onClick={() => setActiveMode("nivel")}
            className={`flex items-center gap-2 px-5 py-3 md:px-4 md:py-2 rounded-xl text-sm md:text-xs font-black uppercase tracking-wider transition-all shrink-0 ${
              activeMode === "nivel"
                ? "bg-white text-neutral-950 shadow-md"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Layers size={16} className="md:w-3.5 md:h-3.5" />
            Niveles (Nivel 4)
          </button>
          <button
            onClick={() => setActiveMode("seccion")}
            className={`flex items-center gap-2 px-5 py-3 md:px-4 md:py-2 rounded-xl text-sm md:text-xs font-black uppercase tracking-wider transition-all shrink-0 ${
              activeMode === "seccion"
                ? "bg-white text-neutral-950 shadow-md"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <MapPin size={16} className="md:w-3.5 md:h-3.5" />
            Secciones (Nivel 3)
          </button>
          <button
            onClick={() => setActiveMode("almacen")}
            className={`flex items-center gap-2 px-5 py-3 md:px-4 md:py-2 rounded-xl text-sm md:text-xs font-black uppercase tracking-wider transition-all shrink-0 ${
              activeMode === "almacen"
                ? "bg-white text-neutral-950 shadow-md"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Home size={16} className="md:w-3.5 md:h-3.5" />
            Almacenes (Nivel 1)
          </button>
        </div>
      </div>

      {/* Target Container Banner */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-neutral-100 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-neutral-900 p-3 rounded-2xl text-white shadow-lg shrink-0">
            {activeMode === "caja" ? <Box size={24} /> : activeMode === "nivel" ? <Layers size={24} /> : activeMode === "seccion" ? <MapPin size={24} /> : <Home size={24} />}
          </div>
          <div>
            <p className="text-[10px] uppercase font-black text-neutral-400 tracking-[0.2em]">
              {activeMode === "caja" ? "Caja Receptora" : activeMode === "nivel" ? "Nivel Receptor" : activeMode === "seccion" ? "Sección Receptora" : "Almacén Receptor"}
            </p>
            <h3 className="font-black text-neutral-900 leading-none text-xl tracking-tight mt-1">
              {activeMode === "caja" 
                ? (activeCaja ? activeCaja.numero_caja : "Ninguna seleccionada") 
                : activeMode === "nivel"
                  ? (selectedNivelId 
                      ? (niveles.find(n => n.id_zona_nivel === parseInt(selectedNivelId))?.nombre.toUpperCase() || "No encontrado")
                      : "Ninguno seleccionado"
                    )
                  : activeMode === "seccion" 
                    ? (selectedSectionId 
                        ? (() => {
                            const sec = sections.find(s => s.id_zona_seccion === parseInt(selectedSectionId));
                            return sec ? sec.nombre.toUpperCase() : "No encontrada";
                          })()
                        : "Ninguna seleccionada"
                      )
                    : (selectedAlmacenId 
                        ? (zones.find(z => z.id_zona_almacen === parseInt(selectedAlmacenId))?.nombre.toUpperCase() || "No encontrado")
                        : "Ninguno seleccionado"
                      )
              }
            </h3>
            {activeMode === "caja" && activeCaja && (
              <p className="text-[10px] text-neutral-500 font-medium mt-1">
                📍 {activeCaja.almacen_nombre || "Sin almacén"} 
                {activeCaja.pasillo_nombre && activeCaja.pasillo_nombre !== "Sin pasillo" ? ` | ${activeCaja.pasillo_nombre}` : ""} 
                {activeCaja.seccion_nombre ? ` | ${activeCaja.seccion_nombre}` : ""}
                {activeCaja.nivel_nombre ? ` | ${activeCaja.nivel_nombre}` : ""}
              </p>
            )}
            {activeMode === "nivel" && selectedNivelId && (() => {
              const lvl = niveles.find(n => n.id_zona_nivel === parseInt(selectedNivelId));
              return lvl ? (
                <p className="text-[10px] text-neutral-500 font-medium mt-1">
                  📍 {lvl.almacen_nombre || "Sin almacén"} {lvl.pasillo_nombre && lvl.pasillo_nombre !== "Sin pasillo" ? ` | ${lvl.pasillo_nombre}` : ""} {lvl.seccion_nombre ? ` | ${lvl.seccion_nombre}` : ""}
                </p>
              ) : null;
            })()}
            {activeMode === "seccion" && selectedSectionId && (() => {
              const sec = sections.find(s => s.id_zona_seccion === parseInt(selectedSectionId));
              return sec ? (
                <p className="text-[10px] text-neutral-500 font-medium mt-1">
                  📍 {sec.almacen_nombre || "Sin almacén"} {sec.pasillo_nombre && sec.pasillo_nombre !== "Sin pasillo" ? ` | ${sec.pasillo_nombre}` : ""}
                </p>
              ) : null;
            })()}
          </div>
        </div>

        {/* Dynamic Selectors depending on Active Mode */}
        {activeMode === "nivel" && (
          <div className="w-full sm:w-64">
            <select
              value={selectedNivelId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedNivelId(val);
                localStorage.setItem("activeScannerNivelId", val);
              }}
              className="w-full rounded-2xl h-11 px-4 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
            >
              <option value="">Selecciona un nivel...</option>
              {zones.map((zone) => {
                const zoneSections = sections.filter(s => s.id_zona_almacen === zone.id_zona_almacen);
                return (
                  <optgroup key={zone.id_zona_almacen} label={zone.nombre.toUpperCase()}>
                    {zoneSections.map((sec) => {
                      const secNiveles = niveles.filter(n => n.id_zona_seccion === sec.id_zona_seccion);
                      if (secNiveles.length === 0) return null;
                      return (
                        <optgroup key={sec.id_zona_seccion} label={`  ↳ ${sec.nombre.toUpperCase()}`}>
                          {secNiveles.map((n) => (
                            <option key={n.id_zona_nivel} value={n.id_zona_nivel}>
                              {n.nombre.toUpperCase()}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </optgroup>
                );
              })}
            </select>
          </div>
        )}

        {activeMode === "seccion" && (
          <div className="w-full sm:w-64">
            <select
              value={selectedSectionId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedSectionId(val);
                localStorage.setItem("activeScannerSectionId", val);
              }}
              className="w-full rounded-2xl h-11 px-4 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
            >
              <option value="">Selecciona una sección...</option>
              {zones.map((zone) => {
                const zoneSections = sections.filter(s => s.id_zona_almacen === zone.id_zona_almacen);
                return (
                  <optgroup key={zone.id_zona_almacen} label={zone.nombre.toUpperCase()}>
                    {zoneSections.map((sec) => (
                      <option key={sec.id_zona_seccion} value={sec.id_zona_seccion}>
                        ↳ {sec.pasillo_nombre && sec.pasillo_nombre !== "Sin pasillo" ? `${sec.pasillo_nombre.toUpperCase()} > ` : ""}{sec.nombre.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        )}

        {activeMode === "almacen" && (
          <div className="w-full sm:w-64">
            <select
              value={selectedAlmacenId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedAlmacenId(val);
                localStorage.setItem("activeScannerAlmacenId", val);
              }}
              className="w-full rounded-2xl h-11 px-4 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
            >
              <option value="">Selecciona un almacén...</option>
              {zones.map((zone) => (
                <option key={zone.id_zona_almacen} value={zone.id_zona_almacen}>
                  {zone.nombre.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!isTargetSelected() ? (
        <Card className="border-dashed border-2 bg-neutral-50/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="bg-white p-4 rounded-full shadow-sm mb-4">
              <AlertCircle size={32} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold">
              {activeMode === "caja" ? "Caja no seleccionada" : activeMode === "nivel" ? "Nivel no seleccionado" : activeMode === "seccion" ? "Sección no seleccionada" : "Almacén no seleccionado"}
            </h3>
            <p className="text-neutral-500 max-w-xs mt-1 mb-6">
              {activeMode === "caja" 
                ? "Debes seleccionar o crear una caja en la pestaña 'Cajas' antes de empezar a escanear."
                : activeMode === "nivel"
                  ? "Selecciona un nivel activo arriba para asociar los productos directamente a él."
                  : activeMode === "seccion"
                    ? "Selecciona una sección activa arriba para asociar los productos directamente a ella."
                    : "Selecciona un almacén activo arriba para asociar los productos directamente a él."}
            </p>
            {activeMode === "caja" && (
              <Button variant="outline" className="rounded-full">Ir a Cajas</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="md:col-span-3 space-y-6">
            <Card className="overflow-hidden border-none shadow-lg">
              <CardHeader className="bg-neutral-900 text-white pb-8">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Visor de Cámara</CardTitle>
                    <CardDescription className="text-neutral-400">Escaneando EAN-13 / UPC / CODE 128</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {/* Botón Escaneo Continuo */}
                    <Button 
                      size="icon" 
                      variant={continuousScan ? "default" : "outline"}
                      onClick={() => setContinuousScan(prev => !prev)}
                      className={`rounded-full ${continuousScan ? "bg-amber-500 hover:bg-amber-600 text-neutral-900 border-none animate-pulse" : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"}`}
                      title={continuousScan ? "Desactivar escaneo continuo (por lotes)" : "Activar escaneo continuo (por lotes)"}
                    >
                      <Repeat size={18} />
                    </Button>
                    <Button 
                      size="icon" 
                      variant={isScannerActive ? "destructive" : "secondary"}
                      onClick={isScannerActive ? stopScanner : startScanner}
                      className="rounded-full"
                    >
                      {isScannerActive ? <Power size={18} /> : <Camera size={18} />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className={`p-0 bg-neutral-100 relative min-h-[300px] flex items-center justify-center ${!isScannerActive ? "bg-neutral-200" : ""}`}>
                <div id="reader" className="w-full h-full"></div>
                
                {!isScannerActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-4">
                    <Camera size={48} strokeWidth={1} />
                    <p className="text-sm font-medium">Cámara desactivada</p>
                    <Button onClick={startScanner} variant="outline" size="sm" className="rounded-full bg-white">
                      Activar ahora
                    </Button>
                  </div>
                )}

                {isChecking && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                    <RefreshCw className="animate-spin text-neutral-900 mb-2" size={32} />
                    <p className="font-semibold">Verificando en base de datos...</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-neutral-100 shadow-lg rounded-3xl overflow-hidden bg-white">
              <CardHeader className="pb-3 bg-neutral-50 border-b">
                <CardTitle className="text-lg flex items-center gap-2 font-bold text-neutral-900">
                  <Scan size={18} className="text-neutral-500" />
                  Ingreso Manual de SKU / EAN
                </CardTitle>
                <CardDescription className="text-neutral-500">
                  Si no dispones de cámara o prefieres escribir, ingresa el SKU o código EAN-13 del producto.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleManualSubmit} className="flex gap-2 items-center">
                  <div className="flex-1">
                    <Input 
                      type="text" 
                      placeholder="Escribe el SKU o EAN-13 (ej: SKU-PANT-01)" 
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      className="rounded-2xl h-11 border-neutral-200 focus-visible:ring-neutral-400"
                      disabled={isChecking}
                    />
                  </div>
                  <div className="w-20">
                    <Input 
                      type="number"
                      min={1}
                      value={manualQty}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualQty(val === "" ? "" : (parseInt(val) || 1));
                      }}
                      className="rounded-2xl h-11 border-neutral-200 focus-visible:ring-neutral-400 text-center font-bold"
                      disabled={isChecking}
                      title="Cantidad a asociar"
                    />
                  </div>
                  <Button type="submit" disabled={isChecking || !manualInput.trim() || manualQty === ""} className="rounded-2xl h-11 px-5 bg-neutral-900 hover:bg-neutral-800 text-white shrink-0 font-semibold transition-all">
                    Asociar
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2 space-y-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-lg">Última Detección</CardTitle>
              </CardHeader>
              <CardContent>
                {scannedResult ? (
                  <div className="space-y-4">
                    {verificationResult?.exists && (
                      <div className="flex justify-center mb-4">
                        {verificationResult.product.has_foto ? (
                          <img 
                            src={`/api/productos/${verificationResult.product.id_producto}/image`}
                            alt="Encontrado"
                            className="w-32 h-32 object-cover rounded-2xl shadow-lg border-2 border-white"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-32 h-32 bg-neutral-100 flex items-center justify-center rounded-2xl border-2 border-white shadow-lg text-neutral-400">
                            <Package size={48} strokeWidth={1} />
                          </div>
                        )}
                      </div>
                    )}
                    <div className="bg-neutral-900 text-white p-4 rounded-xl font-mono text-xl tracking-widest text-center shadow-inner">
                      {scannedResult}
                    </div>
                    
                    {verificationResult?.exists ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">
                          <CheckCircle2 size={20} />
                          <span className="font-medium">Producto Existente</span>
                        </div>
                        <div className="space-y-2 border-t pt-3">
                          <div className="flex justify-between">
                            <span className="text-neutral-500 text-sm">SKU:</span>
                            <span className="font-semibold">{verificationResult.product.sku}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-500 text-sm">Tipo:</span>
                            <Badge variant="outline" className="capitalize">{verificationResult.product.tipo}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-500 text-sm">Talla:</span>
                            <span className="font-semibold">{verificationResult.product.talla}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-amber-50 text-amber-700 rounded-lg border border-amber-100 text-center space-y-3">
                        <Package size={32} className="mx-auto opacity-50" />
                        <p className="text-sm font-medium">Este código no está registrado en el inventario</p>
                        <Button 
                          onClick={() => setShowQuickRegister(true)}
                          className="w-full rounded-full bg-amber-600 hover:bg-amber-700"
                        >
                          Registro Rápido
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-neutral-400 space-y-2">
                    <Scan size={40} strokeWidth={1} />
                    <p className="text-sm">Esperando lectura de código...</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Modal Registro Rápido */}
      {showQuickRegister && (
        <ProductQuickRegister 
          ean={scannedResult || ""} 
          defaultQty={pendingQty}
          defaultTemporada={resolvedTargetCaja?.temporada_default || undefined}
          defaultTipo={(() => {
            if (activeMode === "caja") {
              const tags = activeCaja?.tags;
              if (tags?.tipo_producto === "ropa" && tags?.tipo_producto_exacto && tags?.tipo_producto_exacto !== "todos") {
                return tags.tipo_producto_exacto;
              }
              const type = tags?.tipo_producto;
              return type && type !== "todos" ? type : undefined;
            }
            if (activeMode === "nivel") {
              const lvl = niveles.find(n => n.id_zona_nivel === parseInt(selectedNivelId));
              const tags = lvl?.tags;
              if (tags?.tipo_producto === "ropa" && tags?.tipo_producto_exacto && tags?.tipo_producto_exacto !== "todos") {
                return tags.tipo_producto_exacto;
              }
              const type = tags?.tipo_producto;
              return type && type !== "todos" ? type : undefined;
            }
            if (activeMode === "seccion") {
              const activeSec = sections.find(s => s.id_zona_seccion === parseInt(selectedSectionId));
              const type = activeSec?.tags?.tipo_producto;
              return type && type !== "todos" ? type : undefined;
            }
            return undefined;
          })()}
          defaultCajaId={resolvedTargetCaja?.id_caja || undefined}
          defaultNivelId={activeMode === "nivel" ? parseInt(selectedNivelId) : undefined}
          defaultSeccionId={activeMode === "seccion" ? parseInt(selectedSectionId) : undefined}
          defaultAlmacenId={activeMode === "almacen" ? parseInt(selectedAlmacenId) : undefined}
          onClose={() => {
            setShowQuickRegister(false);
            startScanner();
          }}
          onSuccess={(product, qty) => {
            preventReactivateRef.current = true;
            setRegisteredProduct(product);
            setQtyModalValue(qty || 1);
            setShowPostRegisterModal(true);
            setShowQuickRegister(false);
          }}
          onSuccessGroup={(products) => {
            toast.success(`Grupo de ${products.length} productos registrado y asignado`);
            setShowQuickRegister(false);
            fetchCajas();
            startScanner();
          }}
        />
      )}

      {/* Dialogo de Conflicto de Ubicación */}
      <Dialog open={showConflictDialog} onOpenChange={handleConflictClose}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertCircle /> Conflicto de Ubicación
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4 text-center">
            <p className="text-neutral-600 text-sm">
              Este producto ya se encuentra registrado en otra caja o ubicación activa:
            </p>
            <div className="bg-neutral-100 p-5 rounded-2xl border border-neutral-200">
              <p className="text-[10px] uppercase font-black text-neutral-400 tracking-[0.1em] mb-1">Ubicación Origen</p>
              <p className="text-2xl font-black text-neutral-900 leading-none">{verificationResult?.ubicacion?.numero_caja}</p>
              <Badge className="mt-2 bg-amber-500 border-none hover:bg-amber-600 uppercase text-[9px] font-bold">{verificationResult?.ubicacion?.estado}</Badge>
            </div>
            <p className="text-sm text-neutral-500">
              ¿Deseas mover el producto a la ubicación actual{" "}
              <strong>
                {activeMode === "caja" 
                  ? activeCaja?.numero_caja 
                  : activeMode === "nivel"
                    ? `Nivel: ${niveles.find(n => n.id_zona_nivel === parseInt(selectedNivelId))?.nombre}`
                    : activeMode === "seccion" 
                      ? `Sección: ${sections.find(s => s.id_zona_seccion === parseInt(selectedSectionId))?.nombre}` 
                      : `Almacén: ${zones.find(z => z.id_zona_almacen === parseInt(selectedAlmacenId))?.nombre}`}
              </strong>?
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full pt-4 border-t border-neutral-100">
            <Button 
              className="rounded-xl w-full bg-neutral-900 hover:bg-neutral-855 text-white h-11 text-sm font-extrabold transition-all"
              onClick={() => asignarProducto(verificationResult.product.id_producto, true, pendingQty, 'mover', resolvedTargetCaja)}
            >
              Mover a {activeMode === "caja" ? "esta caja" : activeMode === "nivel" ? "este nivel" : activeMode === "seccion" ? "esta sección" : "este almacén"}
            </Button>
            <Button 
              className="rounded-xl w-full bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border border-neutral-200 h-11 text-sm font-bold transition-all"
              onClick={() => asignarProducto(verificationResult.product.id_producto, true, pendingQty, 'agregar', resolvedTargetCaja)}
            >
              Agregar a {activeMode === "caja" ? "caja actual" : activeMode === "nivel" ? "nivel actual" : activeMode === "seccion" ? "sección actual" : "almacén actual"}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowConflictDialog(false);
                startScanner();
              }} 
              className="rounded-xl w-full h-11 text-sm font-semibold border-neutral-200 text-neutral-500 hover:text-neutral-900 transition-all"
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Cantidad para Producto Existente */}
      <Dialog open={showQtyModal} onOpenChange={(open) => {
        if (!open) {
          setShowQtyModal(false);
          if (!preventReactivateRef.current) startScanner();
          preventReactivateRef.current = false;
        }
      }}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-black flex items-center gap-2">
              <Package className="text-amber-500" size={20} />
              Ingresar Cantidad
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-neutral-500 font-medium">
              Define cuántas unidades del producto <strong>{verificationResult?.product?.sku}</strong> deseas guardar en el contenedor <strong>{resolvedTargetCaja?.numero_caja}</strong>.
            </p>
            
            <div className="space-y-2">
              <label className="text-xs font-bold text-neutral-700 block">Cantidad a Guardar</label>
              <Input 
                type="number"
                min={1}
                value={qtyModalValue}
                onChange={e => {
                  const val = e.target.value;
                  setQtyModalValue(val === "" ? "" : (parseInt(val) || 1));
                }}
                className="rounded-xl h-11 text-center font-bold text-lg focus-visible:ring-neutral-400"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowQtyModal(false);
                  startScanner();
                }} 
                className="flex-1 rounded-xl h-11 font-bold text-xs"
              >
                Cancelar
              </Button>
              <Button 
                onClick={() => {
                  setShowQtyModal(false);
                  const finalVal = qtyModalValue === "" ? 1 : qtyModalValue;
                  if (verificationResult?.ubicacion && verificationResult.ubicacion.numero_caja !== resolvedTargetCaja?.numero_caja) {
                    setPendingQty(finalVal);
                    setShowConflictDialog(true);
                  } else {
                    asignarProducto(verificationResult.product.id_producto, false, finalVal, undefined, resolvedTargetCaja);
                  }
                }} 
                className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs"
              >
                Asociar a Caja
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Post-Registro (Asociar o registrar libre) */}
      <Dialog open={showPostRegisterModal} onOpenChange={(open) => {
        if (!open) {
          setShowPostRegisterModal(false);
          if (!preventReactivateRef.current) startScanner();
          preventReactivateRef.current = false;
        }
      }}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-black flex items-center gap-2">
              <CheckCircle2 className="text-emerald-500" size={20} />
              Producto Registrado
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-neutral-500 font-medium">
              El producto se ha registrado con éxito en el sistema. ¿Deseas ingresarlo en la caja/contenedor <strong>{resolvedTargetCaja?.numero_caja}</strong>?
            </p>

            <div className="space-y-2">
              <label className="text-xs font-bold text-neutral-700 block">Cantidad a Ingresar</label>
              <Input 
                type="number"
                min={1}
                value={qtyModalValue}
                onChange={e => {
                  const val = e.target.value;
                  setQtyModalValue(val === "" ? "" : (parseInt(val) || 1));
                }}
                className="rounded-xl h-11 text-center font-bold text-lg focus-visible:ring-neutral-400"
              />
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowPostRegisterModal(false);
                    toast.success("Producto registrado únicamente (libre de contenedor)");
                    setVerificationResult(null);
                    setScannedResult(null);
                    startScanner();
                  }} 
                  className="flex-1 rounded-xl h-11 font-bold text-xs"
                >
                  Solo Registrar (Libre)
                </Button>
                <Button 
                  onClick={() => {
                    setShowPostRegisterModal(false);
                    if (registeredProduct) {
                      const finalVal = qtyModalValue === "" ? 1 : qtyModalValue;
                      asignarProducto(registeredProduct.id_producto, false, finalVal, undefined, resolvedTargetCaja);
                    }
                  }} 
                  className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs"
                >
                  Asociar a Caja
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
