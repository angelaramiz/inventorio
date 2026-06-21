import React, { useState, useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Scan, Search, Package, Clock, ShieldAlert, Tag,
  Trash2, ArrowLeftRight, Image as ImageIcon, Loader2, Sparkles, ChevronRight, ChevronDown, SlidersHorizontal, X, MapPin, Layers
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { saveBoxToHistory, getHistory, clearHistory, CajaHistorial } from "../utils/db";
import { fetchCatalogWithCache } from "../utils/pwaDb";

const TALLAS_LETRA = ["SinTalla", "XS", "S", "M", "L", "XL", "XXL"];
const TALLAS_NUMERO = ["SinTalla", "38", "40", "42", "44", "46", "48"];

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
    modelo_grupo?: string;
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
  variantes?: any[];
}

interface ModeloVariante {
  id_producto: number;
  sku: string;
  ean_13: string;
  talla: string;
  temporada: string;
  tipo: string;
  marca_sub: string;
  has_foto: boolean;
  modelo_grupo: string;
  total_cantidad: number;
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

interface ModeloQueryResult {
  modelo_grupo: string;
  variantes: ModeloVariante[];
  total_unidades: number;
}

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

export default function ConsultaDashboard() {
  // Unified Dynamic Scan States
  const [unifiedQuery, setUnifiedQuery] = useState("");
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [isUnifiedScannerActive, setIsUnifiedScannerActive] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Result States
  const [currentBox, setCurrentBox] = useState<CajaHistorial | null>(null);
  const [currentSection, setCurrentSection] = useState<any | null>(null);
  const [currentProduct, setCurrentProduct] = useState<ProductoQueryResult | null>(null);
  const [currentModelo, setCurrentModelo] = useState<ModeloQueryResult | null>(null);
  const [boxFilterResults, setBoxFilterResults] = useState<any[]>([]);
  const [prodResults, setProdResults] = useState<ProductoQueryResult[]>([]);

  // Filter & Loader States
  const [boxFilterTemporada, setBoxFilterTemporada] = useState("");
  const [boxFilterLoading, setBoxFilterLoading] = useState(false);
  const [prodLoading, setProdLoading] = useState(false);
  
  const [filterMarca, setFilterMarca] = useState("");
  const [filterTalla, setFilterTalla] = useState("");
  const [filterTemporada, setFilterTemporada] = useState("");
  const [filterTipo, setFilterTipo] = useState("");

  // Options states
  const [temporadasOpts, setTemporadasOpts] = useState<string[]>([]);
  const [marcasOpts, setMarcasOpts] = useState<string[]>([]);
  const [tiposOpts, setTiposOpts] = useState<string[]>([]);
  
  // Section accordion state
  const [expandedBoxId, setExpandedBoxId] = useState<number | null>(null);

  // Scanner Ref
  const scannerRef = useRef<Html5Qrcode | null>(null);
  
  // IndexedDB History State
  const [history, setHistory] = useState<CajaHistorial[]>([]);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  useEffect(() => {
    loadHistory();
    loadFilterOptions();
    return () => {
      stopAnyScanner();
    };
  }, []);

  const loadFilterOptions = async () => {
    try {
      const [tempVals, marcaVals, tipoVals] = await Promise.all([
        fetchCatalogWithCache("/api/conceptos/temporadas", "temporadas"),
        fetchCatalogWithCache("/api/conceptos/marcas", "marcas"),
        fetchCatalogWithCache("/api/conceptos/tipos", "tipos"),
      ]);
      setTemporadasOpts(tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
      setMarcasOpts(marcaVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
      setTiposOpts(tipoVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
    } catch (err) {
      console.error("Error loading filter options", err);
    }
  };


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
    setIsUnifiedScannerActive(false);
  };

  const startUnifiedScanner = async () => {
    await stopAnyScanner();
    try {
      setIsUnifiedScannerActive(true);
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
        await waitForElement("unified-reader", 20, 50);
        const html5QrCode = new Html5Qrcode("unified-reader");
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
            stopAnyScanner();
            setUnifiedQuery(decodedText);
            handleUnifiedSearch(decodedText);
          },
          () => {}
        );
        toast.success("Cámara de consulta activada");
      } catch (err) {
        toast.error("Error al iniciar cámara o elemento no renderizado");
        setIsUnifiedScannerActive(false);
      }
    } catch (e) {
      setIsUnifiedScannerActive(false);
    }
  };

  const handleUnifiedSearch = async (query: string, fallbackQuery?: string) => {
    if (!query.trim()) return;
    setUnifiedLoading(true);
    // Clear all previous views to allow dynamic result displaying
    setCurrentBox(null);
    setCurrentSection(null);
    setCurrentProduct(null);
    setCurrentModelo(null);
    setBoxFilterResults([]);
    setProdResults([]);
    stopAnyScanner();

    try {
      const resp = await fetch(`/api/consultar-dinamico/${encodeURIComponent(query.trim())}`);
      if (resp.ok) {
        const result = await resp.json();
        if (result.type === "seccion") {
          setCurrentSection(result.data);
          setExpandedBoxId(null);
          toast.success(`Sección ${result.data.section.nombre.toUpperCase()} encontrada`);
        } else if (result.type === "caja") {
          setCurrentBox(result.data);
          toast.success(`Caja ${result.data.numero_caja} encontrada`);
          await saveBoxToHistory(result.data);
          await loadHistory();
        } else if (result.type === "producto") {
          setCurrentProduct(result.data);
          toast.success(`Producto ${result.data.product.sku} encontrado`);
        } else if (result.type === "modelo") {
          setCurrentModelo(result.data);
          toast.success(`Modelo "${result.data.modelo_grupo}" — ${result.data.variantes.length} variante(s) encontradas`);
        }
      } else {
        if (fallbackQuery && fallbackQuery.trim()) {
          toast.info("Código no registrado, buscando por modelo...");
          const fbResp = await fetch(`/api/consultar-dinamico/${encodeURIComponent(fallbackQuery.trim())}`);
          if (fbResp.ok) {
            const result = await fbResp.json();
            if (result.type === "seccion") {
              setCurrentSection(result.data);
            } else if (result.type === "caja") {
              setCurrentBox(result.data);
            } else if (result.type === "producto") {
              setCurrentProduct(result.data);
            } else if (result.type === "modelo") {
              setCurrentModelo(result.data);
              toast.success(`Modelo "${result.data.modelo_grupo}" — ${result.data.variantes.length} variante(s) encontradas`);
            }
          } else {
            const err = await fbResp.json();
            toast.error(err.error || `Ni el código "${query}" ni el modelo "${fallbackQuery}" están registrados`);
          }
        } else {
          const err = await resp.json();
          toast.error(err.error || "Código no identificado en el sistema");
        }
      }
    } catch (err) {
      toast.error("Error al conectar con la base de datos");
    } finally {
      setUnifiedLoading(false);
    }
  };

  const handleOcrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    toast.info("Enviando foto a Inteligencia Artificial...");

    const fd = new FormData();
    fd.append("foto", file);

    try {
      const resp = await fetch("/api/ocr/extract-label", {
        method: "POST",
        body: fd
      });

      if (resp.ok) {
        const data = await resp.json();
        toast.success("Etiqueta analizada con éxito");

        if (data.sku && data.modelo_grupo) {
          setUnifiedQuery(data.sku.trim().toUpperCase());
          handleUnifiedSearch(data.sku.trim().toUpperCase(), data.modelo_grupo.trim().toUpperCase());
        } else {
          const targetSearch = data.sku || data.modelo_grupo;
          if (targetSearch) {
            const cleanSearch = targetSearch.trim().toUpperCase();
            setUnifiedQuery(cleanSearch);
            handleUnifiedSearch(cleanSearch);
          } else {
            toast.warning("No se pudo identificar un código o modelo en la etiqueta");
          }
        }
      } else {
        const err = await resp.json();
        toast.error(err.error || "No se pudo extraer información clara");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error al conectar con el servidor OCR");
    } finally {
      setOcrLoading(false);
      e.target.value = "";
    }
  };

  const handleBoxSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setBoxFilterResults([]);
    setBoxFilterTemporada("");
    setCurrentBox(null);
    setCurrentSection(null);
    setCurrentProduct(null);
    setProdResults([]);

    try {
      const resp = await fetch(`/api/consultar-caja/${encodeURIComponent(searchQuery.trim())}`);
      if (resp.ok) {
        const data = await resp.json();
        setCurrentBox(data);
        toast.success(`Caja ${data.numero_caja} encontrada`);
        await saveBoxToHistory(data);
        await loadHistory();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Caja no encontrada");
      }
    } catch (err) {
      toast.error("Error al conectar con el servidor");
    }
  };

  const handleBoxByTemporada = async (temporada: string) => {
    if (!temporada) {
      setBoxFilterResults([]);
      return;
    }
    setCurrentBox(null);
    setCurrentSection(null);
    setCurrentProduct(null);
    setProdResults([]);

    setBoxFilterLoading(true);
    try {
      const resp = await fetch(`/api/cajas?temporada_default=${encodeURIComponent(temporada)}`);
      if (resp.ok) {
        const data = await resp.json();
        setBoxFilterResults(Array.isArray(data) ? data : []);
        if (data.length === 0) {
          toast.info(`No hay cajas con temporada "${temporada}"`); 
        } else {
          toast.success(`${data.length} caja(s) con temporada "${temporada}"`);
        }
      } else {
        toast.error("Error al buscar cajas por temporada");
      }
    } catch (err) {
      toast.error("Error al conectar con el servidor");
    } finally {
      setBoxFilterLoading(false);
    }
  };

  const handleProdFilterSearch = async (searchQuery?: string) => {
    setProdLoading(true);
    setCurrentBox(null);
    setCurrentSection(null);
    setCurrentProduct(null);
    setBoxFilterResults([]);

    try {
      const params = new URLSearchParams();
      if (searchQuery?.trim()) params.set("q", searchQuery.trim());
      if (filterMarca) params.set("marca", filterMarca);
      if (filterTalla) params.set("talla", filterTalla);
      if (filterTemporada) params.set("temporada", filterTemporada);
      if (filterTipo) params.set("tipo", filterTipo);
      
      const resp = await fetch(`/api/productos?${params.toString()}`);
      if (resp.ok) {
        const productsData = await resp.json();
        const products = Array.isArray(productsData) ? productsData : [];
        const results: ProductoQueryResult[] = products.map((p: any) => ({
          product: p,
          boxes: []
        }));
        setProdResults(results);
        if (results.length === 0) {
          toast.info("No se encontraron productos con esos filtros");
        } else {
          toast.success(`${results.length} producto(s) encontrado(s)`);
        }
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al buscar productos");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setProdLoading(false);
    }
  };

  const clearProdFilters = () => {
    setFilterMarca("");
    setFilterTalla("");
    setFilterTemporada("");
    setFilterTipo("");
    setProdResults([]);
    setCurrentProduct(null);
    setCurrentModelo(null);
  };

  const activeFilterCount = [filterMarca, filterTalla, filterTemporada, filterTipo].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-16">
      {/* Header (Simplified - No tabs switcher) */}
      <header className="sticky top-0 z-50 w-full border-b bg-neutral-900 text-white shadow-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5 font-extrabold text-lg tracking-tight">
            <div className="bg-amber-400 p-1.5 rounded-lg text-black animate-pulse">
              <Scan size={20} />
            </div>
            <span>INVENTORIO <span className="text-amber-400 font-normal">| CONSULTA</span></span>
          </div>
          <span className="text-xs font-semibold text-neutral-450 uppercase tracking-widest hidden md:inline">Panel Unificado de Consulta</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl">
        {/* LEFT COLUMN: Controls, Filters & History */}
        <div className="lg:col-span-4 space-y-6 flex flex-col">
          
          {/* Card 1: Dynamic unified scanner/search */}
          <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="pb-3 bg-neutral-50/50">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Scan size={18} className="text-neutral-500 animate-pulse" />
                Escáner Inteligente
              </CardTitle>
              <CardDescription>Escanea cualquier EAN de prenda, código de caja o sección</CardDescription>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="relative rounded-2xl overflow-hidden border bg-neutral-900 aspect-[4/3] w-full flex flex-col shadow-inner justify-center items-center">
                <div 
                  id="unified-reader" 
                  className={`w-full h-full object-cover ${isUnifiedScannerActive ? "block" : "hidden"}`} 
                />
                {!isUnifiedScannerActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-4 p-4 text-center">
                    <Scan size={36} className="text-neutral-500" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-white">Escáner Apagado</p>
                      <p className="text-[11px] text-neutral-400 max-w-[200px]">Usa la cámara trasera para escanear etiquetas</p>
                    </div>
                    <Button onClick={startUnifiedScanner} variant="outline" size="sm" className="rounded-full bg-white text-black hover:bg-neutral-100 font-semibold border-none shadow-md">
                      Encender Cámara
                    </Button>
                  </div>
                )}
                {isUnifiedScannerActive && (
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

              <div className="flex gap-2">
                <Input 
                  placeholder="SKU, EAN, Caja, Sección o Modelo" 
                  value={unifiedQuery}
                  onChange={e => setUnifiedQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleUnifiedSearch(unifiedQuery)}
                  className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                />
                <Button 
                  onClick={() => handleUnifiedSearch(unifiedQuery)}
                  disabled={unifiedLoading || !unifiedQuery.trim()}
                  className="rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 font-bold shrink-0 px-4 text-white"
                >
                  {unifiedLoading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                </Button>
              </div>

              <div className="flex flex-col gap-2 pt-1.5 border-t border-neutral-100">
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment"
                  onChange={handleOcrFileChange} 
                  className="hidden" 
                  id="ocr-dashboard-input" 
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={ocrLoading || unifiedLoading}
                  onClick={() => document.getElementById("ocr-dashboard-input")?.click()}
                  className="w-full h-10 rounded-xl text-xs bg-amber-400 hover:bg-amber-300 hover:scale-[1.01] text-neutral-950 font-extrabold border-none flex items-center justify-center gap-1.5 transition-all shadow-sm"
                >
                  {ocrLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Analizando etiqueta...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} /> Consultar Etiqueta con IA
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
          {/* Mobile Filter Toggle Button */}
          <Button
            onClick={() => setShowFiltersMobile(!showFiltersMobile)}
            className="lg:hidden w-full rounded-2xl h-11 border border-neutral-200 bg-white text-neutral-800 hover:text-neutral-900 font-bold text-xs flex items-center justify-center gap-2 hover:bg-neutral-50 shadow-sm transition-all"
          >
            <SlidersHorizontal size={15} />
            {showFiltersMobile ? "Ocultar Filtros Avanzados" : "Mostrar Filtros Avanzados"}
            {activeFilterCount > 0 && (
              <span className="ml-1 w-5 h-5 bg-neutral-900 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>

          {/* Wrapper for mobile toggled filters */}
          <div className={`${showFiltersMobile ? "flex" : "hidden lg:flex"} flex-col gap-6`}>
            {/* Card 2: Advanced product filters */}
            <Card className="border border-neutral-100 shadow-md rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="pb-2 bg-neutral-50/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-black uppercase text-neutral-400 tracking-wider flex items-center gap-1.5">
                    <Tag size={14} className="text-neutral-500" /> Filtros de Producto
                  </CardTitle>
                  {activeFilterCount > 0 && (
                    <span className="w-5 h-5 bg-amber-450 text-neutral-950 text-[10px] font-black rounded-full flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-bold text-neutral-500">MARCA</label>
                    <select
                      value={filterMarca}
                      onChange={e => setFilterMarca(e.target.value)}
                      className="bg-white border border-neutral-200 rounded-xl px-2.5 py-2 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      <option value="">Todas las marcas</option>
                      {marcasOpts.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-bold text-neutral-500">TALLA</label>
                    <select
                      value={filterTalla}
                      onChange={e => setFilterTalla(e.target.value)}
                      className="bg-white border border-neutral-200 rounded-xl px-2.5 py-2 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      <option value="">Todas las tallas</option>
                      {[...TALLAS_LETRA, ...TALLAS_NUMERO.filter(t => t !== "SinTalla")].filter((v, i, arr) => arr.indexOf(v) === i).map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-bold text-neutral-500">TEMPORADA</label>
                    <select
                      value={filterTemporada}
                      onChange={e => setFilterTemporada(e.target.value)}
                      className="bg-white border border-neutral-200 rounded-xl px-2.5 py-2 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      <option value="">Todas las temporadas</option>
                      {temporadasOpts.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-bold text-neutral-500">TIPO</label>
                    <select
                      value={filterTipo}
                      onChange={e => setFilterTipo(e.target.value)}
                      className="bg-white border border-neutral-200 rounded-xl px-2.5 py-2 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 uppercase"
                    >
                      <option value="">Todos los tipos</option>
                      {tiposOpts.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => handleProdFilterSearch(unifiedQuery)}
                    disabled={prodLoading}
                    className="flex-1 rounded-xl h-9 bg-neutral-900 hover:bg-neutral-800 text-xs font-bold text-white gap-1.5"
                  >
                    {prodLoading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                    Filtrar Productos
                  </Button>
                  {activeFilterCount > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearProdFilters}
                      className="rounded-xl h-9 text-xs font-bold text-neutral-500 hover:text-red-500 hover:bg-red-50 gap-1"
                    >
                      <X size={12} /> Limpiar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Card 3: Box season filter */}
            <Card className="border border-neutral-100 shadow-md rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="pb-2 bg-neutral-50/50">
                <CardTitle className="text-sm font-black uppercase text-neutral-400 tracking-wider flex items-center gap-1.5">
                  <Package size={14} className="text-neutral-500" /> Filtros de Caja
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-neutral-450">Filtrar por Temporada de Caja</p>
                  <div className="flex gap-2 items-center">
                    <select
                      value={boxFilterTemporada}
                      onChange={e => {
                        setBoxFilterTemporada(e.target.value);
                        handleBoxByTemporada(e.target.value);
                      }}
                      className="flex-1 rounded-xl h-10 px-3 bg-neutral-50 border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                    >
                      <option value="">Todas las temporadas</option>
                      {temporadasOpts.map(t => (
                        <option key={t} value={t}>{t.toUpperCase()}</option>
                      ))}
                    </select>
                    {boxFilterLoading && <Loader2 className="animate-spin text-neutral-400" size={16} />}
                    {boxFilterTemporada && !boxFilterLoading && (
                      <button
                        onClick={() => { setBoxFilterTemporada(""); setBoxFilterResults([]); }}
                        className="text-neutral-400 hover:text-red-500 p-1"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Card 4: Consultation History */}
          <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white flex-1 flex flex-col min-h-[250px]">
            <CardHeader className="pb-3 bg-neutral-50/50 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-black uppercase text-neutral-400 tracking-wider flex items-center gap-2">
                  <Clock size={16} className="text-neutral-500" />
                  Historial de Cajas
                </CardTitle>
                <CardDescription className="text-[10px]">Cajas consultadas recientemente</CardDescription>
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
                <div className="flex flex-col items-center justify-center py-12 text-neutral-455 text-center">
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
                        setCurrentSection(null);
                        setCurrentProduct(null);
                        setBoxFilterResults([]);
                        setProdResults([]);
                        setUnifiedQuery(box.sku || box.numero_caja);
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
        </div>

        {/* RIGHT COLUMN: Query Result (Renders dynamically based on active results state) */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            
            {/* 1. BOX RESULT DISPLAY */}
            {currentBox && (
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

                    <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
                      <Badge className={`rounded-full px-3 py-1 text-xs uppercase font-extrabold border ${
                        currentBox.estado === 'llena' ? 'bg-rose-500 text-white border-rose-600' :
                        currentBox.estado === 'activa' ? 'bg-amber-400 text-neutral-900 border-amber-500' :
                        'bg-neutral-100 text-neutral-600 border-neutral-200'
                      }`}>
                        {currentBox.estado}
                      </Badge>
                      <div className="text-[10px] text-neutral-200 bg-neutral-800 px-3 py-1.5 rounded-xl border border-neutral-700 font-extrabold uppercase shrink-0">
                        Cantidad: {currentBox.productos.reduce((sum, item) => sum + (item.cantidad || 0), 0)} uds
                      </div>
                      <div className="text-[10px] text-neutral-400 bg-neutral-800 px-3 py-1.5 rounded-xl border border-neutral-800 font-medium font-mono shrink-0">
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
            )}

            {/* 2. BOX FILTER RESULTS DISPLAY */}
            {!currentBox && boxFilterResults.length > 0 && (
              <motion.div
                key="box-filter-results"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-black uppercase tracking-wider text-neutral-500">
                    {boxFilterResults.length} CAJA(S) · TEMPORADA: {boxFilterTemporada.toUpperCase()}
                  </h3>
                  <button
                    onClick={() => { setBoxFilterTemporada(""); setBoxFilterResults([]); }}
                    className="text-[10px] font-bold text-neutral-400 hover:text-red-500 flex items-center gap-1"
                  >
                    <X size={10} /> Limpiar
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {boxFilterResults.map((b: any) => (
                    <button
                      key={b.id_caja}
                      onClick={() => handleBoxSearch(b.numero_caja)}
                      className="bg-white border border-neutral-100 hover:border-neutral-900 rounded-2xl p-4 flex gap-3 items-center text-left transition-all group shadow-sm hover:shadow-md"
                    >
                      <div className={`p-2.5 rounded-xl text-white shadow-sm flex-shrink-0 ${
                        b.estado === 'llena' ? 'bg-rose-500' : b.estado === 'activa' ? 'bg-amber-400 text-neutral-950' : 'bg-neutral-700'
                      }`}>
                        <Package size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm text-neutral-900">Caja {b.numero_caja}</p>
                        <p className="text-[10px] font-mono text-neutral-400 truncate">{b.sku || "Sin SKU"}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${
                            b.estado === 'llena' ? 'bg-rose-50 text-rose-600' : b.estado === 'activa' ? 'bg-amber-50 text-amber-700' : 'bg-neutral-100 text-neutral-500'
                          }`}>{b.estado}</span>
                          <span className="text-[9px] font-black uppercase bg-neutral-100 px-1.5 py-0.5 rounded-md">{b.total_unidades || 0} uds</span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-neutral-300 group-hover:text-neutral-700 flex-shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* 3. SECTION RESULT DISPLAY */}
            {!currentBox && boxFilterResults.length === 0 && currentSection && (
              <motion.div
                key={`sec-${currentSection.section.id_zona_seccion}`}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
                  <div className="bg-neutral-900 text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-amber-400 p-2.5 rounded-2xl text-black">
                        <MapPin size={28} />
                      </div>
                      <div>
                        <h2 className="text-2xl font-black leading-none uppercase">Sección: {currentSection.section.nombre}</h2>
                        <div className="flex flex-wrap gap-2 items-center mt-1.5">
                          <span className="text-[10px] font-black text-amber-400 bg-neutral-800 px-2.5 py-1 rounded border border-neutral-700 uppercase flex items-center gap-1">
                            <span>📍 Almacén:</span> <strong>{currentSection.section.almacen_nombre}</strong>
                          </span>
                          <span className="text-[10px] font-black text-neutral-300 bg-neutral-800 px-2.5 py-1 rounded border border-neutral-700 uppercase flex items-center gap-1">
                            <span>🚪 Pasillo/Zona:</span> <strong>{currentSection.section.pasillo_nombre}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-1.5 items-center bg-neutral-800 p-3 rounded-2xl border border-neutral-700 max-w-xs">
                      <div className="w-full text-[9px] font-black uppercase text-neutral-400 tracking-wider mb-1">Etiquetas / Tags</div>
                      <Badge variant="outline" className="text-[9px] font-extrabold uppercase border-neutral-700 text-neutral-200">
                        Tipo: {currentSection.section.tags?.tipo_producto || "todos"}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] font-extrabold uppercase border-neutral-700 text-neutral-200">
                        Género: {currentSection.section.tags?.genero || "todos"}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] font-extrabold uppercase border-neutral-700 text-neutral-200">
                        Marca: {currentSection.section.tags?.marca || "todos"}
                      </Badge>
                    </div>
                  </div>

                  <CardContent className="p-6 space-y-6">
                    {/* Accordion List of Boxes inside this Section */}
                    <div>
                      <h3 className="text-xs font-black uppercase text-neutral-400 tracking-wider mb-3">Cajas en esta Sección ({currentSection.boxes.length})</h3>
                      {currentSection.boxes.length === 0 ? (
                        <p className="text-xs text-neutral-400 italic bg-neutral-50/50 p-4 rounded-xl border border-neutral-100">
                          No hay cajas ubicadas físicamente en esta sección.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {currentSection.boxes.map((b: any) => {
                            const isExpanded = expandedBoxId === b.id_caja;
                            const boxProducts = Array.isArray(currentSection.productos) 
                              ? currentSection.productos.filter((item: any) => item.id_caja === b.id_caja)
                              : [];
                            
                            return (
                              <div key={b.id_caja} className="flex flex-col border border-neutral-100 rounded-2xl overflow-hidden shadow-sm bg-neutral-50/20">
                                <div className="p-4 flex gap-3 items-center justify-between">
                                  <div
                                    onClick={() => setExpandedBoxId(isExpanded ? null : b.id_caja)}
                                    className="flex-1 flex gap-3 items-center cursor-pointer select-none"
                                  >
                                    <div className={`p-2 rounded-lg text-white ${
                                      b.estado === 'llena' ? 'bg-rose-500' : b.estado === 'activa' ? 'bg-amber-400 text-neutral-905' : 'bg-neutral-700'
                                    }`}>
                                      <Package size={16} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-extrabold text-xs text-neutral-950">Caja {b.numero_caja}</p>
                                      <p className="text-[9px] font-mono text-neutral-400 truncate">{b.sku || "Sin SKU"}</p>
                                      <div className="flex gap-1.5 mt-0.5">
                                        <span className="text-[9px] font-extrabold text-neutral-500 uppercase">{b.estado}</span>
                                        <span className="text-[9px] text-neutral-300">|</span>
                                        <span className="text-[9px] font-extrabold text-neutral-500">{b.total_unidades || 0} uds</span>
                                      </div>
                                    </div>
                                    {isExpanded ? <ChevronDown size={16} className="text-neutral-400" /> : <ChevronRight size={16} className="text-neutral-400" />}
                                  </div>
                                  
                                  {/* Button to view the full details of this specific box */}
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    onClick={() => handleBoxSearch(b.numero_caja)}
                                    className="rounded-lg h-7 px-2 text-[9px] font-bold border-neutral-200 text-neutral-600 hover:text-neutral-900 shadow-sm shrink-0"
                                  >
                                    Detalle
                                  </Button>
                                </div>

                                {isExpanded && (
                                  <div className="bg-white border-t p-3 space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar">
                                    {boxProducts.length === 0 ? (
                                      <p className="text-[10px] text-neutral-450 italic p-2 text-center bg-neutral-50 rounded-xl">No hay productos en esta caja.</p>
                                    ) : (
                                      boxProducts.map((item: any) => (
                                        <div key={item.id_producto} className="flex items-center justify-between text-xs py-1.5 border-b border-neutral-50 last:border-none">
                                          <div className="flex items-center gap-2">
                                            {item.productos?.has_foto ? (
                                              <img 
                                                src={`/api/productos/${item.id_producto}/image`} 
                                                className="w-8 h-8 object-cover rounded-lg border bg-white" 
                                                alt="" 
                                              />
                                            ) : (
                                              <div className="w-8 h-8 bg-neutral-100 rounded-lg border flex items-center justify-center text-neutral-400">
                                                <ImageIcon size={12} />
                                              </div>
                                            )}
                                            <div className="flex flex-col">
                                              <span className="font-bold text-neutral-800 text-[11px]">{item.productos?.sku}</span>
                                              <span className="text-[9px] text-neutral-400 bg-neutral-50 px-1 rounded w-max">Talla {item.productos?.talla}</span>
                                            </div>
                                          </div>
                                          <span className="font-black text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded-lg text-[10px]">{item.cantidad} uds</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Flat list of all Products in this Section */}
                    <div>
                      <h3 className="text-xs font-black uppercase text-neutral-400 tracking-wider mb-3">Productos en esta Sección</h3>
                      {(!currentSection.productos || currentSection.productos.length === 0) ? (
                        <div className="flex flex-col items-center justify-center py-10 text-neutral-400 border border-dashed rounded-2xl bg-neutral-50/20">
                          <ShieldAlert size={28} className="mb-2 text-neutral-300" />
                          <p className="font-bold text-xs">No hay productos en esta sección</p>
                        </div>
                      ) : (
                        <div className="border rounded-2xl overflow-hidden overflow-x-auto w-full">
                          <Table>
                            <TableHeader className="bg-neutral-50/50">
                              <TableRow>
                                <TableHead className="w-[60px]">Foto</TableHead>
                                <TableHead>Producto (SKU)</TableHead>
                                <TableHead>Detalles</TableHead>
                                <TableHead>Caja Contenedora</TableHead>
                                <TableHead className="text-right">Cantidad</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {currentSection.productos.map((item: any) => {
                                const box = Array.isArray(currentSection.boxes) 
                                  ? currentSection.boxes.find((b: any) => b.id_caja === item.id_caja)
                                  : null;
                                return (
                                  <TableRow key={`${item.id_caja}-${item.id_producto}`} className="bg-white hover:bg-neutral-50/20">
                                    <TableCell className="py-2">
                                      {item.productos?.has_foto ? (
                                        <img 
                                          src={`/api/productos/${item.id_producto}/image`}
                                          alt="Producto"
                                          loading="lazy"
                                          className="w-10 h-10 object-cover rounded-lg shadow-sm border"
                                        />
                                      ) : (
                                        <div className="w-10 h-10 bg-neutral-100 flex items-center justify-center rounded-lg border text-neutral-400">
                                          <ImageIcon size={14} />
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <div className="flex flex-col">
                                        <span className="font-extrabold text-neutral-900 text-xs">{item.productos?.sku}</span>
                                        <span className="text-[9px] text-neutral-500 font-mono">{item.productos?.ean_13 || "Sin EAN"}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <div className="flex flex-wrap gap-1">
                                        <Badge variant="secondary" className="text-[9px] py-0 px-1 font-bold uppercase">{item.productos?.tipo}</Badge>
                                        <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold uppercase bg-white">{item.productos?.talla}</Badge>
                                        {item.productos?.marca_sub && (
                                          <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold uppercase bg-white text-neutral-500">{item.productos?.marca_sub}</Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-2 font-bold text-xs text-neutral-700">
                                      {box ? `Caja ${box.numero_caja}` : `ID Caja: ${item.id_caja}`}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-black text-xs pr-6 py-2 text-neutral-800">
                                      {item.cantidad}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* 4. MODELO GROUP RESULT DISPLAY */}
            {!currentBox && boxFilterResults.length === 0 && !currentSection && !currentProduct && currentModelo && (
              <motion.div
                key={`modelo-${currentModelo.modelo_grupo}`}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
                  <div className="bg-neutral-900 text-white p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-amber-400 p-2.5 rounded-2xl text-black">
                          <Layers size={28} />
                        </div>
                        <div>
                          <h2 className="text-2xl font-black tracking-tight leading-none">Modelo: {currentModelo.modelo_grupo.toUpperCase()}</h2>
                          <p className="text-xs text-neutral-400 mt-1">{currentModelo.variantes.length} variante(s) en el sistema</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="text-[10px] text-neutral-200 bg-neutral-800 px-3 py-1.5 rounded-xl border border-neutral-700 font-extrabold uppercase">
                          Total en Stock: {currentModelo.total_unidades} uds
                        </div>
                        <div className="text-[10px] text-emerald-400 bg-neutral-800 px-3 py-1.5 rounded-xl border border-neutral-700 font-extrabold uppercase">
                          {currentModelo.variantes.filter(v => v.total_cantidad > 0).length} con existencia
                        </div>
                      </div>
                    </div>
                  </div>

                  <CardContent className="p-6 space-y-4">
                    <h3 className="text-xs font-black uppercase text-neutral-400 tracking-wider">Variantes por Talla</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {currentModelo.variantes.map((v) => (
                        <div
                          key={v.id_producto}
                          className={`rounded-2xl border p-4 flex flex-col gap-3 transition-all ${
                            v.total_cantidad > 0
                              ? "bg-white border-neutral-100 shadow-sm hover:shadow-md"
                              : "bg-neutral-50/50 border-neutral-100 opacity-70"
                          }`}
                        >
                          {/* Variant header */}
                          <div className="flex items-center gap-3">
                            {v.has_foto ? (
                              <img
                                src={`/api/productos/${v.id_producto}/image`}
                                alt={v.sku}
                                className="w-14 h-14 object-cover rounded-xl border shadow-sm flex-shrink-0"
                              />
                            ) : (
                              <div className="w-14 h-14 bg-neutral-100 flex items-center justify-center rounded-xl border text-neutral-400 flex-shrink-0">
                                <ImageIcon size={20} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <button
                                onClick={() => { setUnifiedQuery(v.sku); handleUnifiedSearch(v.sku); }}
                                className="font-black text-sm text-neutral-900 truncate hover:underline text-left w-full"
                              >
                                {v.sku}
                              </button>
                              <p className="text-[10px] font-mono text-neutral-400">{v.ean_13 || "Sin EAN"}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                <span className="text-[9px] font-black uppercase bg-neutral-100 px-1.5 py-0.5 rounded-md">Talla {v.talla || "SinTalla"}</span>
                                <span className="text-[9px] font-black uppercase bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-md">{v.temporada}</span>
                                {v.marca_sub && <span className="text-[9px] font-black uppercase bg-neutral-100 px-1.5 py-0.5 rounded-md">{v.marca_sub}</span>}
                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${
                                  v.total_cantidad > 0
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-rose-50 text-rose-600 border-rose-200"
                                }`}>
                                  Stock: {v.total_cantidad}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Variant box locations */}
                          {v.boxes.length > 0 && (
                            <div className="border-t border-neutral-100 pt-2 space-y-1.5">
                              <p className="text-[9px] font-black uppercase text-neutral-400 tracking-wider mb-1">Ubicación en Cajas</p>
                              {v.boxes.map((b, bi) => (
                                <div key={bi} className="flex items-center justify-between text-[10px]">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleBoxSearch(b.cajas.numero_caja)}
                                      className="font-bold text-neutral-800 hover:underline"
                                    >
                                      Caja {b.cajas.numero_caja}
                                    </button>
                                    {b.cajas.almacen_nombre && (
                                      <span className="text-neutral-400 font-mono">
                                        · {b.cajas.almacen_nombre}{b.cajas.seccion_nombre ? ` | ${b.cajas.seccion_nombre}` : ""}
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-black text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded-lg">{b.cantidad} uds</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {v.boxes.length === 0 && (
                            <p className="text-[9px] text-neutral-400 italic border-t border-neutral-100 pt-2">Sin asignar a ninguna caja</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* 5. PRODUCT RESULT DISPLAY */}
            {!currentBox && boxFilterResults.length === 0 && !currentSection && !currentModelo && currentProduct && (
              <motion.div
                key={`prod-${currentProduct.product.id_producto}`}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
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
                        <Badge variant="secondary" className="bg-amber-400 hover:bg-amber-450 text-neutral-955 font-black uppercase text-[10px]">
                          {currentProduct.product.tipo}
                        </Badge>
                      </div>
                      
                      <p className="text-xs text-neutral-400 font-mono">EAN-13: {currentProduct.product.ean_13 || "N/A"}</p>
                      
                      <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start pt-1.5">
                        <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300">
                          Talla {currentProduct.product.talla || "SinTalla"}
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
                                  <button 
                                    onClick={() => handleBoxSearch(b.cajas.numero_caja)}
                                    className="hover:underline text-left text-neutral-900 font-extrabold"
                                  >
                                    Caja {b.cajas.numero_caja}
                                  </button>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-neutral-500">
                                  {b.cajas.sku || "N/A"}
                                </TableCell>
                                <TableCell className="font-extrabold text-[10px] text-neutral-600 uppercase">
                                  {b.cajas.seccion_nombre ? `${b.cajas.almacen_nombre} | ${b.cajas.seccion_nombre}` : (b.cajas.almacen_nombre || "Sin Ubicación")}
                                </TableCell>
                                <TableCell>
                                  <Badge className={`rounded-full px-2 py-0.5 text-[10px] uppercase font-bold border ${
                                    b.cajas.estado === 'llena' ? 'bg-rose-500 text-white border-rose-600' :
                                    b.cajas.estado === 'activa' ? 'bg-amber-400 text-neutral-905 border-amber-500' :
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

                    {/* Variants list (same modelo_grupo) */}
                    {currentProduct.variantes && currentProduct.variantes.length > 0 && (
                      <div className="pt-6 border-t border-neutral-100 mt-6">
                        <h3 className="text-xs font-black uppercase text-neutral-450 tracking-wider mb-4 flex items-center gap-1.5">
                          <Layers size={14} className="text-amber-500" />
                          Otras Variantes en Tallas (Mismo Estilo: {currentProduct.product.modelo_grupo})
                        </h3>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {currentProduct.variantes.map((v: any) => (
                            <button
                              key={v.id_producto}
                              onClick={async () => {
                                setUnifiedQuery(v.sku);
                                handleUnifiedSearch(v.sku);
                              }}
                              className="bg-neutral-50/50 hover:bg-neutral-100/50 border hover:border-neutral-900 rounded-xl p-3 flex gap-2.5 items-center text-left transition-all"
                            >
                              {v.has_foto ? (
                                <img 
                                  src={`/api/productos/${v.id_producto}/image`}
                                  alt=""
                                  className="w-10 h-10 object-cover rounded-lg border bg-white"
                                />
                              ) : (
                                <div className="w-10 h-10 bg-white rounded-lg border flex items-center justify-center text-neutral-450">
                                  <ImageIcon size={14} />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-extrabold text-[11px] text-neutral-955 truncate leading-tight">{v.sku}</p>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  <span className="text-[9px] font-black uppercase bg-white border px-1.5 py-0.5 rounded text-neutral-600">Talla {v.talla}</span>
                                  <span className="text-[9px] font-black uppercase bg-white border px-1.5 py-0.5 rounded text-neutral-400">{v.marca_sub}</span>
                                  <span className={`text-[9px] font-black uppercase border px-1.5 py-0.5 rounded ${
                                    (v.total_cantidad || 0) > 0 
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-250" 
                                      : "bg-rose-50 text-rose-700 border-rose-200"
                                  }`}>
                                    Stock: {v.total_cantidad || 0} uds
                                  </span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* 6. PRODUCT FILTER RESULTS GRID DISPLAY */}
            {!currentBox && boxFilterResults.length === 0 && !currentSection && !currentProduct && !currentModelo && prodResults.length > 0 && (
              <motion.div
                key="prod-filter-results"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-black uppercase tracking-wider text-neutral-500">{prodResults.length} RESULTADO(S)</h3>
                  <button onClick={clearProdFilters} className="text-[10px] font-bold text-neutral-400 hover:text-red-500 flex items-center gap-1">
                    <X size={10} /> Limpiar
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {prodResults.map((r) => (
                    <button
                      key={r.product.id_producto}
                      onClick={() => {
                        setUnifiedQuery(r.product.sku);
                        handleUnifiedSearch(r.product.sku);
                      }}
                      className="bg-white border border-neutral-100 hover:border-neutral-900 rounded-2xl p-3 flex gap-3 items-center text-left transition-all group shadow-sm hover:shadow-md"
                    >
                      {r.product.has_foto ? (
                        <img
                          src={`/api/productos/${r.product.id_producto}/image`}
                          alt={r.product.sku}
                          className="w-14 h-14 object-cover rounded-xl border shadow-sm flex-shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 bg-neutral-100 flex items-center justify-center rounded-xl text-neutral-400 border flex-shrink-0">
                          <ImageIcon size={20} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm text-neutral-900 truncate">{r.product.sku}</p>
                        <p className="text-[10px] font-mono text-neutral-400 truncate">{r.product.ean_13 || "Sin EAN"}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="text-[9px] font-black uppercase bg-neutral-100 px-1.5 py-0.5 rounded-md">{r.product.talla || "SinTalla"}</span>
                          <span className="text-[9px] font-black uppercase bg-amber-55 text-amber-800 px-1.5 py-0.5 rounded-md">{r.product.temporada}</span>
                          {r.product.marca_sub && <span className="text-[9px] font-black uppercase bg-neutral-100 px-1.5 py-0.5 rounded-md">{r.product.marca_sub}</span>}
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-neutral-300 group-hover:text-neutral-700 flex-shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* 7. UNIFIED EMPTY PLACEHOLDER DISPLAY */}
            {!currentBox && boxFilterResults.length === 0 && !currentSection && !currentProduct && !currentModelo && prodResults.length === 0 && (
              <motion.div
                key="empty-unified"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center text-center p-12 border-2 border-dashed rounded-[2.5rem] bg-white border-neutral-200 min-h-[450px]"
              >
                <div className="bg-neutral-50 p-5 rounded-full border border-neutral-200 mb-4 text-neutral-400 animate-pulse">
                  <Scan size={54} strokeWidth={1} />
                </div>
                <h3 className="text-xl font-bold text-neutral-800">Esperando Consulta</h3>
                <p className="text-sm text-neutral-450 max-w-sm mt-2">
                  Usa la cámara para escanear, escribe en el buscador dinámico (ej. Caja <span className="font-mono text-neutral-700 bg-neutral-150 px-1 rounded">CJ-X</span>, Sección <span className="font-mono text-neutral-700 bg-neutral-150 px-1 rounded">SEC-X</span>, EAN/SKU de prenda, o el <span className="font-mono text-neutral-700 bg-neutral-150 px-1 rounded">modelo</span> para ver todas las tallas de un estilo).
                </p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </main>
    </div>
  );
}
