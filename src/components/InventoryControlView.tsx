import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ClipboardList, Calendar, Bell, ShieldCheck, User, CheckCircle2, 
  XCircle, Loader2, AlertCircle, FileText, Download, Scan, Plus, MapPin,
  RefreshCw, X, Camera, Power
} from "lucide-react";
import { toast } from "sonner";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface Props {
  userRole: "operator" | "manager";
}

export default function InventoryControlView({ userRole }: Props) {
  // Common states
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activeEvent, setActiveEvent] = useState<any | null>(null);

  // Operator states
  const [operatorId, setOperatorId] = useState("Operador 1");
  const [selectedZone, setSelectedZone] = useState<any | null>(null);
  const [zones, setZones] = useState<any[]>([]); // cajas to count
  const [boxProducts, setBoxProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [countedQuantities, setCountedQuantities] = useState<Record<number, number>>({}); // id_producto -> qty
  const [sendingCount, setSendingCount] = useState(false);

  // New Operator barcode scanning states
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [activeSection, setActiveSection] = useState<any | null>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Manager states
  const [newEventDesc, setNewEventDesc] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [countRequests, setCountRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [approvingRequestId, setApprovingRequestId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [simulatingCount, setSimulatingCount] = useState(false);

  const notificationsSSERef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchEvents();
    fetchZones(); // Always fetch zones/cajas for both roles to support count simulation
    if (userRole === "manager") {
      fetchCountRequests();
      fetchReports();
      setupNotificationsSSE();
      // Regular fallback poll
      const interval = setInterval(() => {
        fetchNotifications();
      }, 5000);
      return () => {
        clearInterval(interval);
        if (notificationsSSERef.current) notificationsSSERef.current.close();
      };
    } else {
      fetchOperatorSections();
    }
  }, [userRole]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop();
          }
          scannerRef.current.clear();
        } catch (e) {}
      }
    };
  }, []);

  const fetchEvents = async () => {
    setLoadingEvents(true);
    try {
      const resp = await fetch("/api/inventory/events");
      if (resp.ok) {
        const data = await resp.json();
        setEvents(data);
        const active = data.find((e: any) => e.estado === "programado" || e.estado === "en_progreso");
        if (active) setActiveEvent(active);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingEvents(false);
    }
  };

  const fetchZones = async () => {
    try {
      const resp = await fetch("/api/cajas");
      if (resp.ok) {
        const data = await resp.json();
        setZones(data);
      }
    } catch (e) {}
  };

  const fetchOperatorSections = async () => {
    try {
      const resp = await fetch("/api/almacen/secciones");
      if (resp.ok) {
        const data = await resp.json();
        setSections(data);
      }
    } catch (e) {
      console.error("Error fetching sections for operator:", e);
    }
  };

  const handleBarcodeSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scannedBarcode.trim()) return;

    processScannedCode(scannedBarcode.trim());
    setScannedBarcode("");
  };

  const processScannedCode = (code: string) => {
    const sectionMatch = code.match(/^SEC-(\d+)$/i);
    if (sectionMatch) {
      const sectionId = parseInt(sectionMatch[1]);
      const sectionObj = sections.find(s => s.id_zona_seccion === sectionId);
      if (sectionObj) {
        setActiveSection(sectionObj);
        setSelectedZone(null); // Reset active box
        setBoxProducts([]);
        toast.success(`Sección escaneada: ${sectionObj.nombre.toUpperCase()}`);
      } else {
        toast.error(`No se encontró la sección con ID: ${sectionId}`);
      }
      return;
    }

    // Buscar sección directamente por nombre/código (ej: AN0RPA01)
    const sectionObjByName = sections.find(s => s.nombre.toLowerCase() === code.toLowerCase().trim());
    if (sectionObjByName) {
      setActiveSection(sectionObjByName);
      setSelectedZone(null); // Reset active box
      setBoxProducts([]);
      toast.success(`Sección escaneada: ${sectionObjByName.nombre.toUpperCase()}`);
      return;
    }

    // Otherwise, check if it's a box SKU or box number
    const boxObj = zones.find(
      b => b.sku?.toLowerCase() === code.toLowerCase() || 
           b.numero_caja?.toLowerCase() === code.toLowerCase() ||
           b.numero_caja?.toLowerCase().includes(code.toLowerCase())
    );

    if (boxObj) {
      // Find the section this box belongs to
      if (boxObj.id_zona_seccion) {
        const sectionObj = sections.find(s => s.id_zona_seccion === boxObj.id_zona_seccion);
        if (sectionObj) {
          setActiveSection(sectionObj);
        }
      }
      handleSelectZone(boxObj);
      toast.success(`Caja escaneada y seleccionada: ${boxObj.numero_caja}`);
    } else {
      toast.error(`No se encontró caja o sección con código: "${code}"`);
    }
  };

  const startCameraScanner = async () => {
    try {
      let html5QrCode = scannerRef.current;
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("operator-reader");
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
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13
          ]
        },
        (decodedText) => {
          processScannedCode(decodedText);
          stopCameraScanner();
        },
        (errorMessage) => {}
      );
      toast.success("Cámara de escaneo activada");
    } catch (err: any) {
      console.error(err);
      toast.error("Error al acceder a la cámara");
      setIsScannerActive(false);
    }
  };

  const stopCameraScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
        setIsScannerActive(false);
        scannerRef.current = null;
      } catch (err) {
        console.error(err);
        setIsScannerActive(false);
      }
    } else {
      setIsScannerActive(false);
    }
  };

  const fetchCountRequests = async () => {
    setLoadingRequests(true);
    try {
      const resp = await fetch("/api/inventory/count-requests");
      if (resp.ok) {
        const data = await resp.json();
        setCountRequests(data);
      }
    } catch (e) {}
    finally {
      setLoadingRequests(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const resp = await fetch("/api/inventory/notifications");
      if (resp.ok) {
        const data = await resp.json();
        setNotifications(data.reverse()); // latest first
      }
    } catch (e) {}
  };

  const fetchReports = async () => {
    setLoadingReport(true);
    try {
      const resp = await fetch("/api/inventory/reports");
      if (resp.ok) {
        const data = await resp.json();
        setReports(data);
      }
    } catch (e) {}
    finally {
      setLoadingReport(false);
    }
  };

  const setupNotificationsSSE = () => {
    if (notificationsSSERef.current) notificationsSSERef.current.close();
    
    const es = new EventSource("/api/inventory/notifications/sse");
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.tipo) {
          // Play a visual alert / toast
          if (data.tipo === "operador_activo") {
            toast.info(`🔔 Operador ${data.operator_id} activo en ${data.zone_name}`);
          } else if (data.tipo === "conteo_enviado") {
            toast.success(`📝 Nuevo conteo físico recibido de ${data.zone_name}`);
            fetchCountRequests();
          }
          fetchNotifications();
        }
      } catch (e) {}
    };
    notificationsSSERef.current = es;
  };

  // Event creation
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventDesc.trim()) return;

    setCreatingEvent(true);
    try {
      const resp = await fetch("/api/inventory/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: newEventDesc,
          fecha: newEventDate || null
        })
      });
      if (resp.ok) {
        toast.success("Evento de inventario programado");
        setNewEventDesc("");
        setNewEventDate("");
        fetchEvents();
      }
    } catch (e) {
      toast.error("Error al programar evento");
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleCreateTestEvent = async () => {
    try {
      const resp = await fetch("/api/inventory/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: "Evento de Prueba Simulado (Auto)",
          fecha: new Date().toISOString().split("T")[0]
        })
      });
      if (resp.ok) {
        toast.success("Evento de prueba programado correctamente.");
        fetchEvents();
      } else {
        toast.error("Error al programar evento de prueba.");
      }
    } catch (e) {
      toast.error("Error de conexión al programar evento.");
    }
  };

  const handleSimulateDiscrepancy = async () => {
    if (!activeEvent) {
      toast.error("No hay un evento de inventario activo.");
      return;
    }
    if (zones.length === 0) {
      toast.error("No hay contenedores cargados para simular.");
      return;
    }

    setSimulatingCount(true);
    try {
      // 1. Pick a random box/caja
      const randomBox = zones[Math.floor(Math.random() * zones.length)];
      
      // 2. Fetch products inside this box
      const resp = await fetch(`/api/cajas/${randomBox.id_caja}/productos`);
      let products = [];
      if (resp.ok) {
        products = await resp.json();
      }
      
      const quantities: Record<number, number> = {};
      const randomOperatorNames = ["Carlos", "Ana", "Luis", "Marta", "Sofia", "Pedro"];
      const operatorName = `Simulado (${randomOperatorNames[Math.floor(Math.random() * randomOperatorNames.length)]})`;

      if (products.length > 0) {
        // Build quantities with random discrepancies
        products.forEach((item: any) => {
          const systemQty = item.cantidad;
          // Introduce discrepancy (plus or minus, ensuring non-negative)
          const discrepancy = Math.random() > 0.5 ? (Math.random() > 0.5 ? 2 : 1) : -1;
          const physicalQty = Math.max(0, systemQty + discrepancy);
          quantities[item.id_producto] = physicalQty;
        });
      } else {
        // If box is empty, let's grab some random products from the catalog to simulate a discrepancy!
        const prodResp = await fetch("/api/productos");
        if (prodResp.ok) {
          const allProducts = await prodResp.json();
          if (allProducts.length > 0) {
            // Pick 1-2 random products and report they were found in this box (which the system thinks is empty!)
            const countToSimulate = Math.min(2, allProducts.length);
            for (let i = 0; i < countToSimulate; i++) {
              const p = allProducts[Math.floor(Math.random() * allProducts.length)];
              quantities[p.id_producto] = Math.floor(Math.random() * 5) + 1; // 1-5 units
            }
          }
        }
      }

      if (Object.keys(quantities).length === 0) {
        toast.error("No se pudo simular: crea al menos un producto en el sistema.");
        setSimulatingCount(false);
        return;
      }

      // 3. Submit the count request
      const zoneName = `Caja ${randomBox.numero_caja} (${randomBox.almacen_nombre || "Sin almacén"})`;
      const submitResp = await fetch("/api/inventory/count-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: activeEvent.id,
          operator_id: operatorName,
          zone_id: randomBox.id_caja,
          zone_name: zoneName,
          cantidades: quantities
        })
      });

      if (submitResp.ok) {
        toast.success(`Conteo simulado enviado con discrepancia para la Caja ${randomBox.numero_caja}`);
        fetchCountRequests();
        fetchNotifications();
      } else {
        toast.error("Error al enviar el conteo físico simulado.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Error de red al simular discrepancia.");
    } finally {
      setSimulatingCount(false);
    }
  };

  // Operator: Select Zone/Box
  const handleSelectZone = async (box: any) => {
    setSelectedZone(box);
    setBoxProducts([]);
    setCountedQuantities({});
    setLoadingProducts(true);

    const zoneName = `Caja ${box.numero_caja} (${box.almacen_nombre || "Sin almacén"})`;

    // Notify manager that operator is active in this zone
    try {
      fetch("/api/inventory/operator-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operatorId,
          zone_name: zoneName
        })
      });
    } catch (e) {}

    // Load products inside box
    try {
      const resp = await fetch(`/api/cajas/${box.id_caja}/productos`);
      if (resp.ok) {
        const data = await resp.json();
        setBoxProducts(data);
        
        // Populate initial counted quantities with zeroes or existing quantities
        const initialCounts: Record<number, number> = {};
        data.forEach((item: any) => {
          initialCounts[item.id_producto] = 0;
        });
        setCountedQuantities(initialCounts);
      }
    } catch (e) {
      toast.error("Error al cargar productos del contenedor");
    } finally {
      setLoadingProducts(false);
    }
  };

  // Operator: Submit counts
  const handleSendCounts = async () => {
    if (!activeEvent) return toast.error("No hay un evento de inventario programado activo");
    if (!selectedZone) return toast.error("Selecciona una zona a contar");
    if (Object.keys(countedQuantities).length === 0) return toast.error("No hay cantidades de conteo ingresadas");

    setSendingCount(true);
    const zoneName = `Caja ${selectedZone.numero_caja} (${selectedZone.almacen_nombre || "Sin almacén"})`;
    
    try {
      const resp = await fetch("/api/inventory/count-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: activeEvent.id,
          operator_id: operatorId,
          zone_id: selectedZone.id_caja,
          zone_name: zoneName,
          cantidades: countedQuantities
        })
      });

      if (resp.ok) {
        toast.success("Conteos físicos enviados. Esperando validación gerencial.");
        setSelectedZone(null);
        setBoxProducts([]);
        setCountedQuantities({});
      } else {
        toast.error("Error al enviar el conteo físico");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setSendingCount(false);
    }
  };

  // Manager: Approve / Reject Count Request
  const handleApproval = async (requestId: number, status: "aprobado" | "rechazado") => {
    setApprovingRequestId(requestId);
    try {
      const resp = await fetch("/api/inventory/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          manager_id: "Gerente Principal",
          status,
          comentarios: status === "aprobado" ? "Confirmado por Gerencia" : "Rechazado - Se requiere reconteo"
        })
      });

      if (resp.ok) {
        toast.success(status === "aprobado" ? "Conteo físico aprobado y stock sincronizado" : "Conteo físico rechazado");
        fetchCountRequests();
        fetchReports();
      } else {
        toast.error("Error al registrar aprobación");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setApprovingRequestId(null);
    }
  };

  const getProductGroup = (item: any) => {
    const tipo = (item.productos?.tipo || "").toLowerCase();
    const marca = (item.productos?.marca_sub || "").toLowerCase();
    
    if (tipo === "calzado") {
      if (marca === "guess") {
        return "calzado_guess";
      } else if (marca === "marciano") {
        return "calzado_marciano";
      } else {
        return "calzado_otros";
      }
    } else if (tipo === "ropa") {
      return "ropa";
    } else {
      return "otros";
    }
  };

  const groupedProducts = (() => {
    const groups: Record<string, { label: string; items: any[] }> = {
      calzado_guess: { label: "Calzado - Guess", items: [] },
      calzado_marciano: { label: "Calzado - Marciano", items: [] },
      calzado_otros: { label: "Calzado - Otras Marcas", items: [] },
      ropa: { label: "Ropa", items: [] },
      otros: { label: "Otros / Sin Categoría", items: [] }
    };

    boxProducts.forEach(item => {
      const g = getProductGroup(item);
      groups[g].items.push(item);
    });

    return Object.entries(groups).filter(([_, group]) => group.items.length > 0);
  })();

  const filteredZones = activeSection
    ? zones.filter(box => box.id_zona_seccion === activeSection.id_zona_seccion)
    : zones;

  return (
    <div className="space-y-6">
      {/* Operador Layout */}
      {userRole === "operator" && (
        <div className="space-y-6">
          <div className="bg-white p-5 md:p-6 rounded-3xl border border-neutral-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black uppercase text-neutral-900 leading-none">CONTEO FÍSICO (OPERADOR)</h2>
              <p className="text-xs text-neutral-500 font-medium mt-1">
                Registra cantidades reales en contenedores para validación gerencial
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-neutral-400 uppercase">Operador:</span>
              <Input 
                value={operatorId}
                onChange={e => setOperatorId(e.target.value)}
                className="h-9 w-32 rounded-xl text-xs font-bold border-neutral-200 focus-visible:ring-neutral-400"
              />
            </div>
          </div>

          {!activeEvent ? (
            <div className="space-y-4">
              <Card className="border-dashed border-2 bg-neutral-50/50">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <AlertCircle size={40} className="text-amber-500 mb-4" />
                  <h3 className="text-lg font-bold text-neutral-900">Sin Evento de Inventario Activo</h3>
                  <p className="text-neutral-500 text-sm max-w-xs mt-1">
                    El Gerente debe crear y programar un evento de inventario antes de poder iniciar los conteos físicos.
                  </p>
                </CardContent>
              </Card>

              {/* Simulation Panel for Operator when no event active */}
              <Card className="border border-neutral-800 bg-neutral-950 text-white rounded-3xl overflow-hidden shadow-xl">
                <CardHeader className="bg-neutral-900 pb-4 border-b border-neutral-800">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide text-amber-400">
                    ⚡ Módulo de Simulación (Operador)
                  </CardTitle>
                  <CardDescription className="text-neutral-400 text-xs mt-0.5">
                    Utilidades de prueba para simular eventos de conteo sin salir del rol.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-5 pb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
                  <div className="text-left space-y-1">
                    <p className="text-xs font-bold text-neutral-200 uppercase">Iniciar flujo de inventariado</p>
                    <p className="text-[11px] text-neutral-400">Crea un evento de prueba programado en la base de datos para habilitar el conteo físico.</p>
                  </div>
                  <Button 
                    onClick={handleCreateTestEvent}
                    className="w-full sm:w-auto rounded-xl bg-amber-400 text-neutral-950 hover:bg-amber-300 font-extrabold text-xs px-6 py-2.5 h-11 shrink-0 shadow-lg border-none"
                  >
                    Crear Evento de Prueba
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Scanner & Manual Barcode Input Bar */}
              <Card className="border border-neutral-100 shadow-md rounded-3xl bg-white overflow-hidden p-4">
                <form onSubmit={handleBarcodeSubmit} className="flex flex-col sm:flex-row gap-3 items-center">
                  <div className="flex-1 w-full relative">
                    <Scan size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <Input
                      type="text"
                      placeholder="Escanea o escribe código de Sección (SEC-X) o Caja (CJ-X)..."
                      value={scannedBarcode}
                      onChange={e => setScannedBarcode(e.target.value)}
                      className="pl-10 rounded-xl h-11 bg-neutral-50 border-neutral-200 text-xs font-semibold focus-visible:ring-neutral-400 w-full"
                    />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto shrink-0">
                    <Button 
                      type="submit" 
                      className="rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs px-5 shadow-sm hover:bg-neutral-800"
                    >
                      Buscar
                    </Button>
                    <Button
                      type="button"
                      onClick={isScannerActive ? stopCameraScanner : startCameraScanner}
                      className={`rounded-xl h-11 text-xs font-bold px-4 flex items-center gap-1.5 shadow-sm ${
                        isScannerActive 
                          ? "bg-rose-600 hover:bg-rose-500 text-white" 
                          : "bg-emerald-600 hover:bg-emerald-500 text-white"
                      }`}
                    >
                      {isScannerActive ? <Power size={14} /> : <Camera size={14} />}
                      {isScannerActive ? "Apagar Cámara" : "Iniciar Cámara"}
                    </Button>
                  </div>
                </form>

                {/* Camera View Finder */}
                {isScannerActive && (
                  <div className="mt-4 flex flex-col items-center justify-center p-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-200">
                    <div id="operator-reader" className="w-full max-w-sm rounded-xl overflow-hidden shadow-md border bg-black"></div>
                    <p className="text-[10px] text-neutral-400 mt-2 font-bold uppercase tracking-wider">
                      Coloca el código de barras (SEC-X o CJ-X) dentro de la zona de escaneo
                    </p>
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                {/* Select Zone Section */}
                <div className="md:col-span-2 space-y-4">
                  <Card className="border-none shadow-lg rounded-3xl bg-white overflow-hidden">
                    <CardHeader className="bg-neutral-50 border-b pb-4">
                      <CardTitle className="text-sm font-bold flex items-center gap-1.5 uppercase text-neutral-800">
                        <MapPin size={16} /> Selecciona Caja / Estante a Contar
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 max-h-[450px] overflow-y-auto custom-scrollbar">
                      {/* Active Section Filter Badge */}
                      {activeSection && (
                        <div className="mb-3 px-4 py-2.5 bg-neutral-100 border border-neutral-200 rounded-2xl flex items-center justify-between text-xs font-bold text-neutral-700">
                          <span className="flex items-center gap-1.5 uppercase">
                            <MapPin size={14} className="text-neutral-500" />
                            Filtrado: {activeSection.nombre}
                          </span>
                          <button 
                            onClick={() => {
                              setActiveSection(null);
                              setSelectedZone(null);
                              setBoxProducts([]);
                            }}
                            className="text-neutral-400 hover:text-neutral-900 transition-colors"
                          >
                            <XCircle size={15} />
                          </button>
                        </div>
                      )}

                      <div className="space-y-2">
                        {filteredZones.length === 0 ? (
                          <div className="text-center py-8 text-neutral-400 text-xs">
                            No hay cajas en esta ubicación.
                          </div>
                        ) : (
                          filteredZones.map((box) => (
                            <button
                              key={box.id_caja}
                              onClick={() => handleSelectZone(box)}
                              className={`w-full text-left p-4 rounded-2xl border text-xs font-bold flex flex-col gap-1 transition-all ${
                                selectedZone?.id_caja === box.id_caja
                                  ? "border-neutral-950 bg-neutral-950 text-white shadow-md scale-[1.01]"
                                  : "border-neutral-100 bg-white hover:border-neutral-300 text-neutral-700"
                              }`}
                            >
                              <div className="flex justify-between w-full">
                                <span>CAJA: {box.numero_caja}</span>
                                <Badge className={`${selectedZone?.id_caja === box.id_caja ? "bg-amber-400 text-black border-none" : "bg-neutral-100 text-neutral-700"}`}>
                                  {box.estado.toUpperCase()}
                                </Badge>
                              </div>
                              <span className={`text-[10px] ${selectedZone?.id_caja === box.id_caja ? "text-neutral-400" : "text-neutral-400"}`}>
                                📍 {box.almacen_nombre || "Sin ubicación"} {box.seccion_nombre ? `| ${box.seccion_nombre}` : ""}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Operator active event simulation panel */}
                  <Card className="border border-neutral-800 bg-neutral-950 text-white rounded-3xl overflow-hidden shadow-lg">
                    <CardHeader className="bg-neutral-900 pb-3 border-b border-neutral-800">
                      <CardTitle className="text-xs font-bold flex items-center gap-1.5 uppercase tracking-wider text-amber-400">
                        ⚡ Módulo de Simulación
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-3 pb-4 space-y-2">
                      <p className="text-[11px] text-neutral-400 leading-normal">
                        El evento de inventario ya está activo. Usa la interfaz para ingresar conteos o cambia a Gerente para validar.
                      </p>
                      <Badge className="bg-emerald-500 text-neutral-950 font-bold uppercase text-[9px] hover:bg-emerald-500 border-none">
                        Evento Activo
                      </Badge>
                    </CardContent>
                  </Card>
                </div>

                {/* Counting Form Section */}
                <div className="md:col-span-3">
                  {selectedZone ? (
                    <Card className="border-none shadow-lg rounded-3xl bg-white overflow-hidden">
                      <CardHeader className="bg-neutral-950 text-white pb-6">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Scan size={20} className="text-amber-400" />
                          Conteo en: Caja {selectedZone.numero_caja}
                        </CardTitle>
                        <CardDescription className="text-neutral-400 font-bold text-xs uppercase pt-1">
                          📍 {selectedZone.almacen_nombre || "Sin ubicación"} {selectedZone.seccion_nombre ? `| ${selectedZone.seccion_nombre}` : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-6 space-y-6">
                        {loadingProducts ? (
                          <div className="py-12 flex flex-col items-center justify-center text-neutral-400">
                            <Loader2 className="animate-spin mb-2" />
                            <p>Obteniendo prendas asociadas...</p>
                          </div>
                        ) : boxProducts.length === 0 ? (
                          <div className="py-12 text-center text-neutral-400 space-y-2">
                            <p className="font-semibold text-sm">Este contenedor no registra prendas en sistema.</p>
                            <p className="text-xs">¿Registrar prendas físicas de todos modos? Registra primero prendas en el inventario.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="border rounded-2xl overflow-hidden">
                              <Table>
                                <TableHeader className="bg-neutral-50">
                                  <TableRow>
                                    <TableHead>Prenda (SKU)</TableHead>
                                    <TableHead className="w-[120px] text-right">Cant. Física</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {groupedProducts.map(([groupKey, group]) => (
                                    <React.Fragment key={groupKey}>
                                      {/* Header row for group */}
                                      <TableRow className="bg-neutral-100/50 hover:bg-neutral-100/50 border-y">
                                        <TableCell colSpan={2} className="py-2 pl-4 font-black uppercase text-[10px] tracking-wider text-neutral-500">
                                          {group.label} ({group.items.length})
                                        </TableCell>
                                      </TableRow>
                                      {group.items.map((item: any) => (
                                        <TableRow key={item.id_producto} className="hover:bg-neutral-50/30">
                                          <TableCell className="pl-6 py-2.5">
                                            <div className="flex flex-col">
                                              <span className="font-extrabold text-neutral-900 text-xs">{item.productos.sku}</span>
                                              <span className="text-[9px] text-neutral-400 font-mono mt-0.5">
                                                Talla: {item.productos.talla} | Temporada: {item.productos.temporada} | Marca: {item.productos.marca_sub}
                                              </span>
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-right pr-4 py-2.5">
                                            <Input 
                                              type="number"
                                              min={0}
                                              value={countedQuantities[item.id_producto] ?? 0}
                                              onChange={(e) => setCountedQuantities({
                                                ...countedQuantities,
                                                [item.id_producto]: parseInt(e.target.value) || 0
                                              })}
                                              className="w-20 text-center font-black h-9 border-neutral-200 focus-visible:ring-neutral-400 rounded-lg ml-auto text-xs"
                                            />
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </React.Fragment>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>

                            <div className="flex gap-2 pt-2">
                              <Button 
                                variant="outline" 
                                onClick={() => setSelectedZone(null)} 
                                className="flex-1 rounded-xl h-11"
                              >
                                Cancelar
                              </Button>
                              <Button 
                                disabled={sendingCount}
                                onClick={handleSendCounts} 
                                className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold"
                              >
                                {sendingCount ? <Loader2 className="animate-spin" size={16} /> : "Enviar a Gerencia"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="h-full border-2 border-dashed rounded-3xl flex flex-col items-center justify-center text-neutral-400 text-center p-8 py-24 bg-neutral-50/50">
                      <Scan size={44} strokeWidth={1} className="opacity-30 mb-4" />
                      <p className="font-bold text-sm">Esperando Selección de Zona</p>
                      <p className="text-xs max-w-xs mt-1">Escanea la sección, luego selecciona un contenedor a la izquierda para iniciar el conteo físico.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Gerente Layout */}
      {userRole === "manager" && (
        <div className="space-y-6">
          <div className="bg-white p-5 md:p-6 rounded-3xl border border-neutral-100 shadow-sm">
            <h2 className="text-3xl font-black tracking-tight text-neutral-900 uppercase">
              Control Gerencial de Inventario
            </h2>
            <p className="text-sm text-neutral-500 font-medium">Programa eventos, aprueba conteos y compila informes</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left Panel: Schedulling and live notifications */}
            <div className="lg:col-span-2 space-y-6">
              {/* Agenda Eventos */}
              <Card className="border-none shadow-lg rounded-3xl bg-white overflow-hidden">
                <CardHeader className="bg-neutral-50 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-1.5 uppercase text-neutral-800">
                    <Calendar size={16} /> Programar Evento de Inventario
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={handleCreateEvent} className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-neutral-400">Descripción del Evento</label>
                      <Input 
                        placeholder="Ej: Inventariado de Temporada Invierno"
                        value={newEventDesc}
                        onChange={e => setNewEventDesc(e.target.value)}
                        className="rounded-xl h-10 border-neutral-200"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-neutral-400">Fecha Límite (Opcional)</label>
                      <Input 
                        type="date"
                        value={newEventDate}
                        onChange={e => setNewEventDate(e.target.value)}
                        className="rounded-xl h-10 border-neutral-200"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      disabled={creatingEvent} 
                      className="w-full rounded-xl bg-neutral-900 text-white font-bold h-10 text-xs"
                    >
                      {creatingEvent ? <Loader2 className="animate-spin" size={16} /> : "Programar Evento"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Manager Simulation Panel */}
              <Card className="border border-neutral-800 bg-neutral-950 text-white rounded-3xl overflow-hidden shadow-xl">
                <CardHeader className="bg-neutral-900 pb-4 border-b border-neutral-800">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide text-amber-400">
                    ⚡ Simulador de Eventos y Pruebas
                  </CardTitle>
                  <CardDescription className="text-neutral-400 text-xs mt-0.5">
                    Simula la interacción de operadores y discrepancias de inventario.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-5 pb-5 space-y-4">
                  <div className="flex flex-col gap-2">
                    <Button 
                      type="button"
                      disabled={!!activeEvent}
                      onClick={handleCreateTestEvent}
                      className={`w-full rounded-xl font-extrabold text-xs h-10 border-none shadow-sm ${
                        activeEvent 
                          ? "bg-neutral-800 text-neutral-500 cursor-not-allowed" 
                          : "bg-amber-400 text-neutral-950 hover:bg-amber-300"
                      }`}
                    >
                      Crear Evento de Prueba
                    </Button>
                    
                    <Button 
                      type="button"
                      disabled={!activeEvent || simulatingCount}
                      onClick={handleSimulateDiscrepancy}
                      className={`w-full rounded-xl font-extrabold text-xs h-10 border-none shadow-sm ${
                        !activeEvent 
                          ? "bg-neutral-800 text-neutral-500 cursor-not-allowed" 
                          : "bg-white text-neutral-950 hover:bg-neutral-100"
                      }`}
                    >
                      {simulatingCount ? (
                        <>
                          <Loader2 className="animate-spin mr-1.5 inline-block" size={14} /> Simulando...
                        </>
                      ) : (
                        "Simular Conteo de Operador (Discrepancia)"
                      )}
                    </Button>
                  </div>
                  {activeEvent ? (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 text-[11px] text-neutral-400 space-y-1">
                      <span className="font-bold text-amber-400 uppercase text-[9px] block">Instrucciones de Prueba:</span>
                      <p>
                        Presiona <strong>Simular Conteo (Discrepancia)</strong> para crear de forma ficticia un conteo de operador con discrepancias para una caja aleatoria. Esto actualizará la bandeja de aprobación y notificará en tiempo real.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-amber-500/80 text-center font-semibold">
                      ⚠️ Debe existir un evento de inventario activo para simular conteos.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Actividad en Vivo */}
              <Card className="border-none shadow-lg rounded-3xl bg-white overflow-hidden">
                <CardHeader className="bg-neutral-50 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-1.5 uppercase text-neutral-800">
                    <Bell size={16} /> Actividad de Operadores en Vivo
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-neutral-400 text-xs">
                      No hay actividad registrada en esta sesión.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {notifications.map((notif) => (
                        <div 
                          key={notif.id} 
                          className={`p-3 rounded-2xl border text-xs flex flex-col gap-1 ${
                            notif.tipo === "conteo_enviado" 
                              ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                              : "bg-blue-50 border-blue-100 text-blue-800"
                          }`}
                        >
                          <span className="font-extrabold capitalize">
                            {notif.tipo === "conteo_enviado" ? "📝 Conteo físico recibido" : "📍 Operador en zona"}
                          </span>
                          <p>Operador: <strong className="font-extrabold">{notif.operator_id}</strong> - {notif.zone_name}</p>
                          <span className="text-[9px] text-neutral-400 self-end font-mono">
                            {new Date(notif.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Panel: Approvals and final reports */}
            <div className="lg:col-span-3 space-y-6">
              {/* Bandeja de Aprobación */}
              <Card className="border-none shadow-lg rounded-3xl bg-white overflow-hidden">
                <CardHeader className="bg-neutral-50 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-1.5 uppercase text-neutral-800">
                    <ShieldCheck size={16} /> Bandeja de Aprobación de Conteos Físicos
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {loadingRequests ? (
                    <div className="py-12 flex justify-center text-neutral-400">
                      <Loader2 className="animate-spin" />
                    </div>
                  ) : countRequests.length === 0 ? (
                    <div className="py-12 text-center text-neutral-400 text-sm font-semibold">
                      No hay solicitudes de conteo físico pendientes de validación.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {countRequests.map((req) => (
                        <div key={req.id} className="border border-neutral-100 p-4 rounded-2xl space-y-3 bg-neutral-50/30">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-xs text-neutral-400 font-bold uppercase">Operador: {req.operator_id}</p>
                              <p className="font-extrabold text-sm text-neutral-900 mt-0.5">Zona/Caja ID: {req.zone_id}</p>
                            </div>
                            <Badge className={`capitalize border ${
                              req.estado === "pendiente" ? "bg-amber-50 text-amber-600 border-amber-100" :
                              req.estado === "aprobado" ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                              "bg-rose-50 text-rose-600 border-rose-100"
                            }`}>
                              {req.estado}
                            </Badge>
                          </div>

                          <div className="bg-white border rounded-xl p-3 text-xs space-y-1">
                            <span className="font-bold text-neutral-500 uppercase block text-[9px] mb-1">Cantidades físicas declaradas:</span>
                            {Object.entries(req.cantidades).map(([prodId, qty]) => (
                              <div key={prodId} className="flex justify-between border-b last:border-0 pb-1 last:pb-0 mb-1 last:mb-0">
                                <span className="font-mono">Producto ID: {prodId}</span>
                                <span className="font-bold">{qty as any} unidades</span>
                              </div>
                            ))}
                          </div>

                          {req.estado === "pendiente" && (
                            <div className="flex gap-2">
                              <Button
                                disabled={approvingRequestId === req.id}
                                onClick={() => handleApproval(req.id, "rechazado")}
                                className="flex-1 rounded-xl h-9 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs"
                              >
                                <XCircle size={14} className="mr-1" /> Rechazar
                              </Button>
                              <Button
                                disabled={approvingRequestId === req.id}
                                onClick={() => handleApproval(req.id, "aprobado")}
                                className="flex-1 rounded-xl h-9 bg-neutral-900 hover:bg-neutral-850 text-white font-bold text-xs"
                              >
                                <CheckCircle2 size={14} className="mr-1" /> Aprobar y Sincronizar
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Informes Finales */}
              <Card className="border-none shadow-lg rounded-3xl bg-white overflow-hidden">
                <CardHeader className="bg-neutral-50 border-b pb-4">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm font-bold flex items-center gap-1.5 uppercase text-neutral-800">
                      <FileText size={16} /> Reporte Consolidado de Inventario
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={fetchReports}
                      className="h-8 rounded-xl text-xs"
                    >
                      <RefreshCw size={12} className="mr-1" /> Recargar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {loadingReport ? (
                    <div className="py-12 flex justify-center text-neutral-400">
                      <Loader2 className="animate-spin" />
                    </div>
                  ) : reports.length === 0 ? (
                    <div className="py-12 text-center text-neutral-400 text-sm">
                      No hay registros finalizados de conteo aprobados aún.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="border rounded-2xl overflow-hidden overflow-x-auto max-h-[300px] custom-scrollbar">
                        <Table>
                          <TableHeader className="bg-neutral-50">
                            <TableRow>
                              <TableHead>SKU</TableHead>
                              <TableHead>Tipo / Talla</TableHead>
                              <TableHead>Caja ID</TableHead>
                              <TableHead className="text-right">Cantidad Final</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reports.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell className="font-bold text-neutral-900">{r.productos?.sku || `Prod ID: ${r.producto_id}`}</TableCell>
                                <TableCell className="capitalize">{r.productos?.tipo} / {r.productos?.talla}</TableCell>
                                <TableCell className="font-semibold">Caja {r.zona_id}</TableCell>
                                <TableCell className="text-right font-black text-emerald-600">{r.cantidad_final} uds</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
