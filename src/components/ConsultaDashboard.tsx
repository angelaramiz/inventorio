import React, { useState, useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Scan, Search, Package, Clock, ShieldAlert, Tag,
  Trash2, ArrowLeftRight, Image as ImageIcon, Loader2, Sparkles, ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { saveBoxToHistory, getHistory, clearHistory, CajaHistorial } from "../utils/db";

interface ProductoQueryResult {
  product: {
    id_producto: number;
    sku: string;
    ean_13: string;
    talla: string;
    temporada: string;
    tipo: string;
    marca_sub: string;
    has_foto: boolean;
  };
  boxes: {
    cantidad: number;
    cajas: {
      id_caja: number;
      numero_caja: string;
      sku: string | null;
      estado: string;
      seccion_nombre?: string | null;
      almacen_nombre?: string | null;
    };
  }[];
}

export default function ConsultaDashboard() {
  const [activeTab, setActiveTab] = useState<"cajas" | "productos">("cajas");
  
  // Box States
  const [boxQuery, setBoxQuery] = useState("");
  const [boxLoading, setBoxLoading] = useState(false);
  const [currentBox, setCurrentBox] = useState<CajaHistorial | null>(null);
  const [isBoxScannerActive, setIsBoxScannerActive] = useState(false);
  
  // Product States
  const [prodQuery, setProdQuery] = useState("");
  const [prodLoading, setProdLoading] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<ProductoQueryResult | null>(null);
  const [isProdScannerActive, setIsProdScannerActive] = useState(false);
  
  // Scanner Ref
  const scannerRef = useRef<Html5Qrcode | null>(null);
  
  // History State (Box queries)
  const [history, setHistory] = useState<CajaHistorial[]>([]);

  useEffect(() => {
    loadHistory();
    return () => {
      stopAnyScanner();
    };
  }, []);

  // Stop scanner when switching tabs
  useEffect(() => {
    stopAnyScanner();
  }, [activeTab]);

  const loadHistory = async () => {
    try {
      const records = await getHistory();
      setHistory(records);
    } catch (err) {
      console.error("Error reading IndexedDB history:", err);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm("¿Estás seguro de vaciar el historial local?")) return;
    try {
      await clearHistory();
      setHistory([]);
      toast.success("Historial limpiado");
    } catch (err) {
      toast.error("Error al limpiar historial");
    }
  };

  const stopAnyScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (e) {}
      scannerRef.current = null;
    }
    setIsBoxScannerActive(false);
    setIsProdScannerActive(false);
  };

  const handleBoxSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setBoxLoading(true);
    try {
      const resp = await fetch(`/api/consultar-caja/${encodeURIComponent(searchQuery.trim())}`);
      if (resp.ok) {
        const data = await resp.json();
        setCurrentBox(data);
        toast.success(`Caja ${data.numero_caja} encontrada`);
        
        // Save to IndexedDB history
        await saveBoxToHistory(data);
        await loadHistory();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Caja no encontrada");
      }
    } catch (err) {
      toast.error("Error al conectar con el servidor");
    } finally {
      setBoxLoading(false);
    }
  };

  const handleProdSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setProdLoading(true);
    try {
      const resp = await fetch(`/api/consultar-producto/${encodeURIComponent(searchQuery.trim())}`);
      if (resp.ok) {
        const data = await resp.json();
        setCurrentProduct(data);
        toast.success(`Producto ${data.product.sku} encontrado`);
      } else {
        const err = await resp.json();
        toast.error(err.error || "Producto no encontrado");
      }
    } catch (err) {
      toast.error("Error al conectar con el servidor");
    } finally {
      setProdLoading(false);
    }
  };

  // Start Box Scanner
  const startBoxScanner = async () => {
    await stopAnyScanner();
    try {
      let html5QrCode = new Html5Qrcode("dashboard-reader-box");
      scannerRef.current = html5QrCode;
      setIsBoxScannerActive(true);

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
          stopAnyScanner();
          setBoxQuery(decodedText);
          handleBoxSearch(decodedText);
        },
        () => {}
      );
      toast.success("Cámara de cajas iniciada");
    } catch (err) {
      toast.error("No se pudo iniciar la cámara");
      setIsBoxScannerActive(false);
      scannerRef.current = null;
    }
  };

  // Start Product Scanner
  const startProdScanner = async () => {
    await stopAnyScanner();
    try {
      let html5QrCode = new Html5Qrcode("dashboard-reader-prod");
      scannerRef.current = html5QrCode;
      setIsProdScannerActive(true);

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
          stopAnyScanner();
          setProdQuery(decodedText);
          handleProdSearch(decodedText);
        },
        () => {}
      );
      toast.success("Cámara de productos iniciada");
    } catch (err) {
      toast.error("No se pudo iniciar la cámara");
      setIsProdScannerActive(false);
      scannerRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-16">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-neutral-900 text-white shadow-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5 font-extrabold text-lg tracking-tight">
            <div className="bg-amber-400 p-1.5 rounded-lg text-black animate-pulse">
              <Scan size={20} />
            </div>
            <span>INVENTORIO <span className="text-amber-400 font-normal">| CONSULTA</span></span>
          </div>

          {/* Tab Selection Switcher */}
          <div className="flex bg-neutral-800 p-1 rounded-xl border border-neutral-700">
            <button
              onClick={() => setActiveTab("cajas")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === "cajas" 
                  ? "bg-amber-400 text-neutral-950 shadow-md" 
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Package size={14} />
              Cajas
            </button>
            <button
              onClick={() => setActiveTab("productos")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === "productos" 
                  ? "bg-amber-400 text-neutral-950 shadow-md" 
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Tag size={14} />
              Productos
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl">
        
        {/* LEFT COLUMN: Controls & History */}
        <div className="lg:col-span-4 space-y-6 flex flex-col">
          
          {/* TAB 1: BOX CONTROLS */}
          {activeTab === "cajas" && (
            <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="pb-3 bg-neutral-50/50">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Search size={18} className="text-neutral-500" />
                  Buscar Caja
                </CardTitle>
                <CardDescription>Escanea o escribe el número o SKU de la caja</CardDescription>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                {/* Scanner Container */}
                <div className="relative rounded-2xl overflow-hidden border bg-neutral-900 aspect-[4/3] w-full flex flex-col shadow-inner justify-center items-center">
                  <div 
                    id="dashboard-reader-box" 
                    className={`w-full h-full object-cover ${isBoxScannerActive ? "block" : "hidden"}`} 
                  />
                  {!isBoxScannerActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-4 p-4 text-center">
                      <Scan size={36} className="text-neutral-500" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-white">Escáner Desactivado</p>
                        <p className="text-[11px] text-neutral-400 max-w-[200px]">Usa la cámara trasera para escanear el código de barra de la caja</p>
                      </div>
                      <Button onClick={startBoxScanner} variant="outline" size="sm" className="rounded-full bg-white text-black hover:bg-neutral-100 font-semibold border-none">
                        Activar Cámara
                      </Button>
                    </div>
                  )}
                  {isBoxScannerActive && (
                    <Button 
                      onClick={stopAnyScanner}
                      variant="destructive"
                      size="sm"
                      className="absolute bottom-3 right-3 rounded-xl text-xs font-bold shadow-lg"
                    >
                      Apagar Cámara
                    </Button>
                  )}
                </div>

                {/* Manual Input */}
                <div className="flex gap-2">
                  <Input 
                    placeholder="Número o SKU de la caja" 
                    value={boxQuery}
                    onChange={e => setBoxQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleBoxSearch(boxQuery)}
                    className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                  />
                  <Button 
                    onClick={() => handleBoxSearch(boxQuery)}
                    disabled={boxLoading || !boxQuery.trim()}
                    className="rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 font-bold shrink-0 px-4"
                  >
                    {boxLoading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TAB 2: PRODUCT CONTROLS */}
          {activeTab === "productos" && (
            <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="pb-3 bg-neutral-50/50">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Search size={18} className="text-neutral-500" />
                  Buscar Producto
                </CardTitle>
                <CardDescription>Escanea o escribe el SKU o EAN-13 del producto</CardDescription>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                {/* Scanner Container */}
                <div className="relative rounded-2xl overflow-hidden border bg-neutral-900 aspect-[4/3] w-full flex flex-col shadow-inner justify-center items-center">
                  <div 
                    id="dashboard-reader-prod" 
                    className={`w-full h-full object-cover ${isProdScannerActive ? "block" : "hidden"}`} 
                  />
                  {!isProdScannerActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-4 p-4 text-center">
                      <Scan size={36} className="text-neutral-500" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-white">Escáner Desactivado</p>
                        <p className="text-[11px] text-neutral-400 max-w-[200px]">Escanea el código de barras (SKU o EAN-13) de una prenda</p>
                      </div>
                      <Button onClick={startProdScanner} variant="outline" size="sm" className="rounded-full bg-white text-black hover:bg-neutral-100 font-semibold border-none">
                        Activar Cámara
                      </Button>
                    </div>
                  )}
                  {isProdScannerActive && (
                    <Button 
                      onClick={stopAnyScanner}
                      variant="destructive"
                      size="sm"
                      className="absolute bottom-3 right-3 rounded-xl text-xs font-bold shadow-lg"
                    >
                      Apagar Cámara
                    </Button>
                  )}
                </div>

                {/* Manual Input */}
                <div className="flex gap-2">
                  <Input 
                    placeholder="SKU o EAN-13 del producto" 
                    value={prodQuery}
                    onChange={e => setProdQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleProdSearch(prodQuery)}
                    className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                  />
                  <Button 
                    onClick={() => handleProdSearch(prodQuery)}
                    disabled={prodLoading || !prodQuery.trim()}
                    className="rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 font-bold shrink-0 px-4"
                  >
                    {prodLoading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Consultation History (Show only on Boxes tab for IndexedDB requirement) */}
          {activeTab === "cajas" && (
            <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white flex-1 flex flex-col">
              <CardHeader className="pb-3 bg-neutral-50/50 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Clock size={18} className="text-neutral-500" />
                    Historial de Cajas
                  </CardTitle>
                  <CardDescription>Cajas guardadas en IndexedDB</CardDescription>
                </div>
                {history.length > 0 && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleClearHistory}
                    className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                    title="Limpiar Historial"
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-4 flex-1 overflow-y-auto max-h-[300px]">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-neutral-400 text-center">
                    <Clock size={36} strokeWidth={1} className="mb-2 opacity-50" />
                    <span className="text-xs font-semibold">Sin consultas previas</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {history.map((box) => (
                      <button
                        key={box.id_caja}
                        onClick={() => {
                          setCurrentBox(box);
                          setBoxQuery(box.sku || box.numero_caja);
                        }}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all group ${
                          currentBox?.id_caja === box.id_caja
                            ? "bg-neutral-900 border-neutral-950 text-white shadow-md scale-[0.98]"
                            : "bg-white border-neutral-100 hover:border-neutral-300 text-neutral-800"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-lg ${
                            currentBox?.id_caja === box.id_caja ? "bg-neutral-800" : "bg-neutral-50"
                          }`}>
                            <Package size={16} />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-extrabold text-sm">Caja {box.numero_caja}</span>
                            <span className={`text-[10px] font-mono leading-none ${
                              currentBox?.id_caja === box.id_caja ? "text-neutral-400" : "text-neutral-500"
                            }`}>{box.sku || "Sin SKU"}</span>
                          </div>
                        </div>
                        <ChevronRight size={14} className="opacity-40 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT COLUMN: Query Result */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            
            {/* BOX RESULT RENDER */}
            {activeTab === "cajas" && (
              currentBox ? (
                <motion.div
                  key={`box-${currentBox.id_caja}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
                    <div className="bg-neutral-900 text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-amber-400 p-2.5 rounded-2xl text-black">
                          <Package size={28} />
                        </div>
                        <div>
                          <h2 className="text-2xl font-black leading-none">Caja {currentBox.numero_caja}</h2>
                          <div className="flex flex-wrap gap-2 items-center mt-1">
                            <span className="text-xs text-neutral-400 font-mono">SKU: {currentBox.sku || "N/A"}</span>
                            {currentBox.almacen_nombre && (
                              <span className="text-[10px] font-black text-amber-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 uppercase">
                                📍 {currentBox.almacen_nombre} {currentBox.seccion_nombre ? `| ${currentBox.seccion_nombre}` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-start sm:self-auto">
                        <Badge className={`rounded-full px-3 py-1 text-xs uppercase font-extrabold border ${
                          currentBox.estado === 'llena' ? 'bg-rose-500 text-white border-rose-600' :
                          currentBox.estado === 'activa' ? 'bg-amber-400 text-neutral-900 border-amber-500' :
                          'bg-neutral-100 text-neutral-600 border-neutral-200'
                        }`}>
                          {currentBox.estado}
                        </Badge>
                        <div className="text-[10px] text-neutral-400 bg-neutral-800 px-3 py-1.5 rounded-xl border border-neutral-800 font-medium font-mono">
                          Leído: {new Date(currentBox.consultado_at || new Date()).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>

                    <CardContent className="p-6">
                      <h3 className="text-sm font-black uppercase text-neutral-400 tracking-wider mb-4">Contenido de la Caja</h3>
                      {currentBox.productos.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-neutral-400 border border-dashed rounded-2xl">
                          <Package size={40} className="mb-2 opacity-35" />
                          <p className="font-bold text-sm">Esta caja no contiene productos</p>
                        </div>
                      ) : (
                        <div className="border rounded-2xl overflow-hidden overflow-x-auto w-full">
                          <Table>
                            <TableHeader className="bg-neutral-50/50">
                              <TableRow>
                                <TableHead className="w-[80px]">Foto</TableHead>
                                <TableHead>Producto (SKU)</TableHead>
                                <TableHead>Detalles</TableHead>
                                <TableHead className="text-right">Cantidad</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {currentBox.productos.map((item) => (
                                <TableRow key={item.id_producto} className="bg-white hover:bg-neutral-50/20">
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
                                      <span className="font-extrabold text-neutral-900">{item.productos.sku}</span>
                                      <span className="text-[10px] text-neutral-500 font-mono">{item.productos.ean_13 || "Sin EAN"}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                      <Badge variant="secondary" className="text-[10px] font-bold uppercase">{item.productos.tipo}</Badge>
                                      <Badge variant="outline" className="text-[10px] font-bold uppercase bg-white">{item.productos.talla}</Badge>
                                      <Badge variant="outline" className="text-[10px] font-bold uppercase bg-white text-neutral-500">{item.productos.temporada}</Badge>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-black text-sm pr-6">
                                    {item.cantidad}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <motion.div
                  key="empty-box"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center text-center p-12 border-2 border-dashed rounded-[2.5rem] bg-white border-neutral-200 min-h-[400px]"
                >
                  <div className="bg-neutral-50 p-4 rounded-full border mb-4 text-neutral-400">
                    <Package size={48} strokeWidth={1} />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-800">Esperando Consulta de Caja</h3>
                  <p className="text-sm text-neutral-400 max-w-sm mt-1">
                    Inicia la cámara a la izquierda o escribe un código manual para consultar los productos que hay en una caja.
                  </p>
                </motion.div>
              )
            )}

            {/* PRODUCT RESULT RENDER */}
            {activeTab === "productos" && (
              currentProduct ? (
                <motion.div
                  key={`prod-${currentProduct.product.id_producto}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  {/* Product card summary */}
                  <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
                    <div className="bg-neutral-900 text-white p-6 flex flex-col sm:flex-row gap-5 items-center">
                      <div className="relative">
                        {currentProduct.product.has_foto ? (
                          <img 
                            src={`/api/productos/${currentProduct.product.id_producto}/image`}
                            alt="Producto"
                            className="w-24 h-24 object-cover rounded-2xl border-2 border-white/10 shadow-lg"
                          />
                        ) : (
                          <div className="w-24 h-24 bg-neutral-800 flex items-center justify-center rounded-2xl border border-neutral-700 text-neutral-400">
                            <ImageIcon size={32} />
                          </div>
                        )}
                      </div>

                      <div className="text-center sm:text-left flex-1 space-y-1">
                        <div className="flex flex-wrap gap-2 justify-center sm:justify-start items-center">
                          <h2 className="text-2xl font-black tracking-tight">{currentProduct.product.sku}</h2>
                          <Badge variant="secondary" className="bg-amber-400 hover:bg-amber-400 text-neutral-950 font-black uppercase text-[10px]">
                            {currentProduct.product.tipo}
                          </Badge>
                        </div>
                        
                        <p className="text-xs text-neutral-400 font-mono">EAN-13: {currentProduct.product.ean_13 || "N/A"}</p>
                        
                        <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start pt-1.5">
                          <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300">
                            Talla {currentProduct.product.talla || "Única"}
                          </span>
                          <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300">
                            Colección: {currentProduct.product.temporada}
                          </span>
                          {currentProduct.product.marca_sub && (
                            <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300">
                              Marca: {currentProduct.product.marca_sub}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <CardContent className="p-6">
                      <h3 className="text-sm font-black uppercase text-neutral-400 tracking-wider mb-4">Ubicación en Cajas</h3>
                      
                      {currentProduct.boxes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-neutral-400 border border-dashed rounded-2xl bg-neutral-50/30">
                          <ShieldAlert size={40} className="mb-2 text-neutral-300" />
                          <p className="font-extrabold text-sm text-neutral-600">Este producto no se encuentra en ninguna caja</p>
                          <p className="text-xs text-neutral-400 mt-0.5">Actualmente no hay unidades asignadas de este producto.</p>
                        </div>
                      ) : (
                        <div className="border rounded-2xl overflow-hidden overflow-x-auto w-full">
                          <Table>
                            <TableHeader className="bg-neutral-50/50">
                              <TableRow>
                                <TableHead>Caja Contenedora</TableHead>
                                <TableHead>SKU de Caja</TableHead>
                                <TableHead>Ubicación</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Cantidad Almacenada</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {currentProduct.boxes.map((b) => (
                                <TableRow key={b.cajas.id_caja} className="bg-white hover:bg-neutral-50/20">
                                  <TableCell className="font-extrabold text-neutral-900 text-sm">
                                    Caja {b.cajas.numero_caja}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs text-neutral-500">
                                    {b.cajas.sku || "N/A"}
                                  </TableCell>
                                  <TableCell className="font-extrabold text-[10px] text-neutral-600 uppercase">
                                    {b.cajas.seccion_nombre ? `${b.cajas.almacen_nombre} | ${b.cajas.seccion_nombre}` : "Sin Ubicación"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge className={`rounded-full px-2 py-0.5 text-[10px] uppercase font-bold border ${
                                      b.cajas.estado === 'llena' ? 'bg-rose-500 text-white border-rose-600' :
                                      b.cajas.estado === 'activa' ? 'bg-amber-400 text-neutral-900 border-amber-500' :
                                      'bg-neutral-100 text-neutral-600 border-neutral-200'
                                    }`}>
                                      {b.cajas.estado}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-black text-sm pr-6 text-neutral-800">
                                    {b.cantidad} {b.cantidad === 1 ? 'unidad' : 'unidades'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <motion.div
                  key="empty-prod"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center text-center p-12 border-2 border-dashed rounded-[2.5rem] bg-white border-neutral-200 min-h-[400px]"
                >
                  <div className="bg-neutral-50 p-4 rounded-full border mb-4 text-neutral-400">
                    <Tag size={48} strokeWidth={1} />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-800">Esperando Consulta de Producto</h3>
                  <p className="text-sm text-neutral-400 max-w-sm mt-1">
                    Inicia la cámara a la izquierda o escribe un código manual para consultar en qué cajas se encuentra guardado un producto.
                  </p>
                </motion.div>
              )
            )}

          </AnimatePresence>
        </div>

      </main>
    </div>
  );
}
