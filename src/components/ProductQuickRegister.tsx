import React, { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Save, X, Loader2, Plus, Trash2, Scan, Box, Home, MapPin, Layers } from "lucide-react";
import { toast } from "sonner";
import { Producto, Temporada, TipoProducto } from "../types";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { fetchCatalogWithCache } from "../utils/pwaDb";

interface Props {
  ean: string;
  defaultQty?: number;
  defaultTemporada?: string;
  defaultTipo?: string;
  onClose: () => void;
  onSuccess: (product: Producto, qty: number) => void;
  onSuccessGroup?: (products: Producto[]) => void;
  initialIsGroup?: boolean;
  defaultCajaId?: number;
  defaultNivelId?: number;
  defaultSeccionId?: number;
  defaultAlmacenId?: number;
}

interface Variacion {
  sku: string;
  talla: string;
  cantidad: number | "";
}

const TALLAS_LETRA = ["SinTalla", "XS", "S", "M", "L", "XL", "XXL"];
const TALLAS_NUMERO = ["SinTalla", "38", "40", "42", "44", "46", "48"];

export default function ProductQuickRegister({
  ean,
  defaultQty = 1,
  defaultTemporada,
  defaultTipo,
  onClose,
  onSuccess,
  onSuccessGroup,
  initialIsGroup = false,
  defaultCajaId,
  defaultNivelId,
  defaultSeccionId,
  defaultAlmacenId
}: Props) {
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState<number | "">(defaultQty);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [isGroup, setIsGroup] = useState(initialIsGroup);
  const [tallaTipo, setTallaTipo] = useState<"letra" | "numero">("letra");
  const [tallaValue, setTallaValue] = useState("SinTalla");

  const [formData, setFormData] = useState({
    sku: ean,
    ean_13: ean,
    talla: "SinTalla",
    temporada: (defaultTemporada || "todouso") as Temporada,
    tipo: (defaultTipo || "otro") as TipoProducto,
    marca_sub: "Guess",
    modelo_grupo: ""
  });

  // Variations for group mode
  const [variaciones, setVariaciones] = useState<Variacion[]>([
    { sku: ean, talla: "SinTalla", cantidad: defaultQty }
  ]);

  const [activeScanRowIndex, setActiveScanRowIndex] = useState<number | null>(null);
  const rowScannerRef = useRef<Html5Qrcode | null>(null);

  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>(["Guess", "Marciano", "GuessEco"]);

  // Locations list for container selection
  const [zones, setZones] = useState<any[]>([]);
  const [pasillos, setPasillos] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [niveles, setNiveles] = useState<any[]>([]);
  const [cajas, setCajas] = useState<any[]>([]);

  // Selected container IDs
  const [selectedAlmacenId, setSelectedAlmacenId] = useState(defaultAlmacenId?.toString() || "");
  const [selectedPasilloId, setSelectedPasilloId] = useState("");
  const [selectedSeccionId, setSelectedSeccionId] = useState(defaultSeccionId?.toString() || "");
  const [selectedNivelId, setSelectedNivelId] = useState(defaultNivelId?.toString() || "");
  const [selectedCajaId, setSelectedCajaId] = useState(defaultCajaId?.toString() || "");

  // Check if target container is pre-specified by parent view
  const hasPredefinedContainer = !!(defaultCajaId || defaultNivelId || defaultSeccionId || defaultAlmacenId);

  useEffect(() => {
    setFormData(prev => ({ ...prev, talla: tallaValue }));
    // Update first variation talla as well
    setVariaciones(prev => {
      const updated = [...prev];
      if (updated[0]) {
        updated[0].talla = tallaValue;
      }
      return updated;
    });
  }, [tallaValue]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [tempVals, tipoVals, marcaVals, respZones, respPasillos, respSections, respNiveles, respBoxes] = await Promise.all([
          fetchCatalogWithCache("/api/conceptos/temporadas", "temporadas"),
          fetchCatalogWithCache("/api/conceptos/tipos", "tipos"),
          fetchCatalogWithCache("/api/conceptos/marcas", "marcas"),
          fetch("/api/almacen/zonas"),
          fetch("/api/almacen/pasillos"),
          fetch("/api/almacen/secciones"),
          fetch("/api/almacen/niveles"),
          fetch("/api/cajas")
        ]);

        setZones(await respZones.json());
        setPasillos(await respPasillos.json());
        setSections(await respSections.json());
        setNiveles(await respNiveles.json());
        setCajas(await respBoxes.json());
        
        const tempNames = tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        const tipoNames = tipoVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        const marcaNames = marcaVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        
        setTemporadas(tempNames);
        setTipos(tipoNames);
        if (marcaNames.length > 0) {
          setMarcas(marcaNames);
        }

        
        setFormData(prev => ({
          ...prev,
          temporada: defaultTemporada && tempNames.includes(defaultTemporada) 
            ? defaultTemporada 
            : (tempNames.includes("todouso") ? "todouso" : (tempNames[0] || "")),
          tipo: defaultTipo && tipoNames.includes(defaultTipo.toLowerCase()) 
            ? defaultTipo.toLowerCase() 
            : (tipoNames.includes("otro") ? "otro" : (tipoNames[0] || "")),
          marca_sub: prev.marca_sub || marcaNames[0] || "Guess"
        }));
      } catch (err) {
        console.error("Error loading dynamic concepts", err);
      }
    };
    loadOptions();
  }, []);

  // Inherit container tags (like tipo_producto_exacto) when selected container changes
  useEffect(() => {
    if (selectedCajaId && cajas.length > 0) {
      const box = cajas.find(c => c.id_caja === parseInt(selectedCajaId));
      if (box && box.tags) {
        const { tipo_producto, tipo_producto_exacto } = box.tags;
        if (tipo_producto === "ropa" && tipo_producto_exacto && tipo_producto_exacto !== "todos") {
          setFormData(prev => ({ ...prev, tipo: tipo_producto_exacto }));
        } else if (tipo_producto && tipo_producto !== "todos") {
          setFormData(prev => ({ ...prev, tipo: tipo_producto }));
        }
      }
    } else if (selectedNivelId && niveles.length > 0) {
      const lvl = niveles.find(n => n.id_zona_nivel === parseInt(selectedNivelId));
      if (lvl && lvl.tags) {
        const { tipo_producto, tipo_producto_exacto } = lvl.tags;
        if (tipo_producto === "ropa" && tipo_producto_exacto && tipo_producto_exacto !== "todos") {
          setFormData(prev => ({ ...prev, tipo: tipo_producto_exacto }));
        } else if (tipo_producto && tipo_producto !== "todos") {
          setFormData(prev => ({ ...prev, tipo: tipo_producto }));
        }
      }
    }
  }, [selectedCajaId, selectedNivelId, cajas, niveles]);

  const handleTallaTipoChange = (val: "letra" | "numero") => {
    setTallaTipo(val);
    const defaultVal = val === "letra" ? "M" : "40";
    setTallaValue(defaultVal);
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      toast.error("No se pudo acceder a la cámara");
      setShowCamera(false);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    const targetSize = 400;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > height) {
      if (width > targetSize) {
        height *= targetSize / width;
        width = targetSize;
      }
    } else {
      if (height > targetSize) {
        width *= targetSize / height;
        height = targetSize;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/webp", 0.7);
      
      const estimatedSize = (dataUrl.length * 3) / 4;
      if (estimatedSize > 180000) {
        const superCompressed = canvas.toDataURL("image/webp", 0.5);
        setPhoto(superCompressed);
      } else {
        setPhoto(dataUrl);
      }
      
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  // Row camera scanner controls
  const startRowScanner = (rowIndex: number) => {
    setActiveScanRowIndex(rowIndex);
    setTimeout(async () => {
      try {
        const qrCode = new Html5Qrcode("row-scanner-reader");
        rowScannerRef.current = qrCode;
        await qrCode.start(
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
            setVariaciones(prev => {
              const updated = [...prev];
              if (updated[rowIndex]) {
                updated[rowIndex].sku = decodedText;
              }
              return updated;
            });
            stopRowScanner();
            toast.success(`SKU escaneado: ${decodedText}`);
          },
          () => {}
        );
      } catch (err) {
        console.error("Error starting row scanner", err);
        toast.error("No se pudo iniciar el escáner de fila");
        setActiveScanRowIndex(null);
      }
    }, 150);
  };

  const stopRowScanner = async () => {
    if (rowScannerRef.current) {
      try {
        if (rowScannerRef.current.isScanning) {
          await rowScannerRef.current.stop();
        }
        rowScannerRef.current.clear();
      } catch (e) {
        console.error(e);
      }
      rowScannerRef.current = null;
    }
    setActiveScanRowIndex(null);
  };

  // Variations list actions
  const addVariation = () => {
    setVariaciones(prev => [...prev, { sku: "", talla: tallaValue, cantidad: 1 }]);
  };

  const removeVariation = (index: number) => {
    if (variaciones.length <= 1) return;
    setVariaciones(prev => prev.filter((_, idx) => idx !== index));
  };

  const updateVariationField = (index: number, field: keyof Variacion, value: any) => {
    setVariaciones(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isGroup) {
      if (!formData.modelo_grupo.trim()) {
        return toast.error("El Modelo de Grupo es obligatorio para registro grupal");
      }
      const invalidVar = variaciones.find(v => !v.sku.trim());
      if (invalidVar) {
        return toast.error("Todas las variaciones deben tener un SKU asignado");
      }
      setLoading(true);
      try {
        const fd = new FormData();
        fd.append("modelo_grupo", formData.modelo_grupo);
        fd.append("temporada", formData.temporada);
        fd.append("tipo", formData.tipo);
        fd.append("marca_sub", formData.marca_sub);
        const sanitizedVariaciones = variaciones.map(v => ({
          ...v,
          cantidad: v.cantidad === "" ? 1 : v.cantidad
        }));
        fd.append("variaciones", JSON.stringify(sanitizedVariaciones));

        if (photo) {
          const res = await fetch(photo);
          const blob = await res.blob();
          fd.append("foto", blob, "captura.webp");
        }

        // Add container association
        if (selectedCajaId) fd.append("id_caja", selectedCajaId);
        else if (selectedNivelId) fd.append("id_zona_nivel", selectedNivelId);
        else if (selectedSeccionId) fd.append("id_zona_seccion", selectedSeccionId);
        else if (selectedAlmacenId) fd.append("id_zona_almacen", selectedAlmacenId);

        const resp = await fetch("/api/productos/grupo", {
          method: "POST",
          body: fd
        });

        if (resp.ok) {
          const result = await resp.json();
          toast.success("Grupo de productos registrado exitosamente");
          if (onSuccessGroup) {
            onSuccessGroup(result.products);
          } else {
            onSuccess(result.products[0], cantidad === "" ? 1 : cantidad);
          }
        } else {
          const error = await resp.json();
          toast.error(error.error || "Fallo en registro grupal");
        }
      } catch (err) {
        toast.error("Error de conexión");
      } finally {
        setLoading(false);
      }
    } else {
      // Individual product registration
      if (!formData.sku) return toast.error("El SKU es obligatorio");

      setLoading(true);
      try {
        const fd = new FormData();
        fd.append("sku", formData.sku);
        fd.append("ean_13", formData.ean_13);
        fd.append("talla", formData.talla);
        fd.append("temporada", formData.temporada);
        fd.append("tipo", formData.tipo);
        fd.append("marca_sub", formData.marca_sub);
        fd.append("modelo_grupo", formData.modelo_grupo || "sin modelo");
        
        if (photo) {
          const res = await fetch(photo);
          const blob = await res.blob();
          fd.append("foto", blob, "captura.webp");
        }

        const resp = await fetch("/api/productos", {
          method: "POST",
          body: fd
        });

        if (resp.ok) {
          const product = await resp.json();
          toast.success("Artículo registrado correctamente");
          onSuccess(product, cantidad === "" ? 1 : cantidad);
        } else {
          const error = await resp.json();
          toast.error(error.error || "Fallo en registro");
        }
      } catch (err) {
        toast.error("Error de conexión");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-2xl sm:max-w-2xl gap-0 w-[95vw] rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="bg-neutral-955 text-white p-6 shrink-0 flex flex-row items-center justify-between relative">
          <button 
            type="button" 
            onClick={onClose} 
            className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors z-50"
            title="Cerrar"
          >
            <X size={18} />
          </button>
          <div>
            <DialogTitle className="text-xl font-black flex items-center gap-3 uppercase tracking-tight">
              <div className="bg-amber-400 p-1.5 rounded-lg text-black">
                <Layers size={18} />
              </div>
              {isGroup ? "Registro de Grupo de Productos" : "Registro Express de Producto"}
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-400 mt-1">
              {isGroup ? "Crea múltiples variaciones con una sola foto y modelo" : "Registra un artículo de forma individual"}
            </DialogDescription>
          </div>

          <div className="pr-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsGroup(!isGroup);
                if (!isGroup && formData.modelo_grupo === "sin modelo") {
                  setFormData(prev => ({ ...prev, modelo_grupo: "" }));
                }
              }}
              className="rounded-xl h-9 bg-neutral-900 border-neutral-700 hover:bg-neutral-800 text-white text-xs font-black uppercase tracking-wider"
            >
              {isGroup ? "Modo Individual" : "Modo Grupo"}
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
          {/* Photo Capture Section */}
          <div className="flex justify-center flex-col items-center">
            {photo ? (
              <div className="relative group">
                <img src={photo} alt="Preview" className="w-40 h-40 object-cover rounded-2xl shadow-md border-2 border-white" />
                <button 
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} />
                </button>
              </div>
            ) : showCamera ? (
              <div className="relative w-40 h-40 bg-black rounded-2xl overflow-hidden mx-auto">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                  <Button type="button" onClick={capturePhoto} className="rounded-full h-9 w-9 bg-white text-black hover:bg-neutral-200 shadow-xl border-2 border-neutral-900/10 flex items-center justify-center p-0">
                    <div className="h-6 w-6 rounded-full border border-black"></div>
                  </Button>
                </div>
              </div>
            ) : (
              <button 
                type="button"
                onClick={startCamera}
                className="w-40 h-40 bg-neutral-100 border-2 border-dashed border-neutral-300 rounded-2xl flex flex-col items-center justify-center text-neutral-400 hover:bg-neutral-50 hover:border-neutral-400 transition-all group"
              >
                <Camera size={32} className="mb-2 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-semibold">Tomar Foto</span>
              </button>
            )}
            <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider mt-2">
              {isGroup ? "Foto compartida para todo el grupo" : "Foto del producto"}
            </span>
          </div>

          {/* Group Details / Core Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-neutral-50/50 p-4 rounded-2xl border">
            <h4 className="md:col-span-2 text-xs font-black uppercase text-neutral-900 border-b pb-1.5 mb-1 flex items-center gap-1.5">
              <Layers size={14} className="text-neutral-500" />
              Detalles Generales del {isGroup ? "Grupo" : "Producto"}
            </h4>

            {isGroup ? (
              <div className="space-y-1 md:col-span-2">
                <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Modelo de Grupo (Requerido) *</label>
                <Input 
                  value={formData.modelo_grupo} 
                  onChange={e => setFormData({...formData, modelo_grupo: e.target.value})}
                  placeholder="Ej: M12345, ANA-PLAYERA"
                  className="rounded-xl bg-white border-neutral-200 uppercase font-bold"
                  required
                />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">SKU / EAN-13 *</label>
                  <Input 
                    value={formData.sku} 
                    onChange={e => setFormData({...formData, sku: e.target.value, ean_13: e.target.value})}
                    placeholder="Código de barras"
                    className="rounded-xl bg-white border-neutral-200"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Modelo de Grupo (Opcional)</label>
                  <Input 
                    value={formData.modelo_grupo} 
                    onChange={e => setFormData({...formData, modelo_grupo: e.target.value})}
                    placeholder="sin modelo"
                    className="rounded-xl bg-white border-neutral-200"
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Marca</label>
              <Select value={formData.marca_sub} onValueChange={(v) => setFormData({...formData, marca_sub: v})}>
                <SelectTrigger className="rounded-xl bg-white border-neutral-200">
                  <SelectValue placeholder="Seleccionar marca" />
                </SelectTrigger>
                <SelectContent>
                  {marcas.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Tipo de Prenda</label>
              <Select value={formData.tipo} onValueChange={(v: any) => setFormData({...formData, tipo: v})}>
                <SelectTrigger className="rounded-xl bg-white border-neutral-200 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Temporada</label>
              <Select value={formData.temporada} onValueChange={(v: any) => setFormData({...formData, temporada: v})}>
                <SelectTrigger className="rounded-xl bg-white border-neutral-200 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {temporadas.map(temp => (
                    <SelectItem key={temp} value={temp} className="capitalize">{temp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Tipo de Talla</label>
              <Select value={tallaTipo} onValueChange={(v: any) => handleTallaTipoChange(v)}>
                <SelectTrigger className="rounded-xl bg-white border-neutral-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="letra">Letras (S, M, L...)</SelectItem>
                  <SelectItem value="numero">Números (38, 40, 42...)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Individual Mode Fields: Talla & Cantidad */}
          {!isGroup && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Talla</label>
                {tallaTipo === "letra" ? (
                  <Select value={tallaValue} onValueChange={setTallaValue}>
                    <SelectTrigger className="rounded-xl bg-neutral-50 border-neutral-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TALLAS_LETRA.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input 
                    type="text"
                    value={tallaValue === "SinTalla" ? "" : tallaValue}
                    onChange={e => setTallaValue(e.target.value.toUpperCase())}
                    placeholder="Ej: 38, 40.5, 42..."
                    className="rounded-xl bg-neutral-50 border-neutral-200"
                  />
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Cantidad Inicial</label>
                <Input 
                  type="number"
                  min={1}
                  value={cantidad} 
                  onChange={e => {
                    const val = e.target.value;
                    setCantidad(val === "" ? "" : (parseInt(val) || 1));
                  }}
                  placeholder="1"
                  className="rounded-xl bg-neutral-55 border-neutral-200"
                />
              </div>
            </div>
          )}

          {/* Group Mode: Dynamic Variations Section */}
          {isGroup && (
            <div className="space-y-3 bg-neutral-50/30 p-4 rounded-2xl border">
              <div className="flex justify-between items-center border-b pb-2">
                <h4 className="text-xs font-black uppercase text-neutral-900 flex items-center gap-1.5">
                  <Plus size={14} className="text-neutral-500" />
                  Variaciones de Producto
                </h4>
                <Button 
                  type="button" 
                  onClick={addVariation} 
                  variant="outline" 
                  size="sm"
                  className="rounded-xl h-8 text-[10px] uppercase font-black tracking-wider border-neutral-300"
                >
                  + Agregar Variación
                </Button>
              </div>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {variaciones.map((vari, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-white p-3 rounded-xl border shadow-sm">
                    {/* Scan Trigger */}
                    <Button 
                      type="button" 
                      onClick={() => startRowScanner(idx)} 
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9 bg-neutral-50 hover:bg-neutral-900 hover:text-white border shrink-0 rounded-lg"
                      title="Escanear SKU para esta fila"
                    >
                      <Scan size={14} />
                    </Button>

                    {/* SKU input */}
                    <div className="flex-1 min-w-0">
                      <Input 
                        placeholder="SKU o Código de Barras"
                        value={vari.sku}
                        onChange={e => updateVariationField(idx, "sku", e.target.value)}
                        className="h-9 rounded-lg text-xs font-semibold"
                      />
                    </div>

                    {/* Talla select */}
                    <div className="w-24 shrink-0">
                      {tallaTipo === "letra" ? (
                        <select
                          value={vari.talla}
                          onChange={e => updateVariationField(idx, "talla", e.target.value)}
                          className="w-full h-9 rounded-lg border text-xs px-2 bg-neutral-50 font-semibold outline-none"
                        >
                          {TALLAS_LETRA.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      ) : (
                        <Input 
                          placeholder="Talla"
                          value={vari.talla === "SinTalla" ? "" : vari.talla}
                          onChange={e => updateVariationField(idx, "talla", e.target.value.toUpperCase())}
                          className="w-full h-9 rounded-lg text-xs font-semibold"
                        />
                      )}
                    </div>

                    {/* Cantidad input */}
                    <div className="w-16 shrink-0">
                      <Input 
                        type="number"
                        min={1}
                        value={vari.cantidad}
                        onChange={e => {
                          const val = e.target.value;
                          updateVariationField(idx, "cantidad", val === "" ? "" : (parseInt(val) || 1));
                        }}
                        className="h-9 rounded-lg text-xs text-center font-bold"
                      />
                    </div>

                    {/* Delete button */}
                    <Button 
                      type="button"
                      onClick={() => removeVariation(idx)}
                      disabled={variaciones.length <= 1}
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9 text-neutral-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg shrink-0 disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group Mode: Container Association Selection */}
          {isGroup && !hasPredefinedContainer && (
            <div className="space-y-4 bg-neutral-50/50 p-4 rounded-2xl border">
              <h4 className="text-xs font-black uppercase text-neutral-900 border-b pb-1.5 flex items-center gap-1.5">
                <Box size={14} className="text-neutral-500" />
                Ubicación / Contenedor Destino (Opcional)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Almacen select */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Almacén Principal</label>
                  <select
                    value={selectedAlmacenId}
                    onChange={e => {
                      setSelectedAlmacenId(e.target.value);
                      setSelectedPasilloId("");
                      setSelectedSeccionId("");
                      setSelectedNivelId("");
                      setSelectedCajaId("");
                    }}
                    className="w-full h-10 rounded-xl border bg-white px-2 outline-none font-semibold"
                  >
                    <option value="">Ninguno / Libre</option>
                    {zones.map(z => (
                      <option key={z.id_zona_almacen} value={z.id_zona_almacen}>{z.nombre.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                {/* Pasillo select */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Pasillo / Subzona</label>
                  <select
                    value={selectedPasilloId}
                    onChange={e => {
                      setSelectedPasilloId(e.target.value);
                      setSelectedSeccionId("");
                      setSelectedNivelId("");
                      setSelectedCajaId("");
                    }}
                    disabled={!selectedAlmacenId}
                    className="w-full h-10 rounded-xl border bg-white px-2 outline-none font-semibold disabled:opacity-50"
                  >
                    <option value="">Ninguno</option>
                    {pasillos
                      .filter(p => p.id_zona_almacen === parseInt(selectedAlmacenId))
                      .map(p => (
                        <option key={p.id_zona_pasillo} value={p.id_zona_pasillo}>{p.nombre.toUpperCase()}</option>
                      ))}
                  </select>
                </div>

                {/* Seccion select */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Sección Física</label>
                  <select
                    value={selectedSeccionId}
                    onChange={e => {
                      setSelectedSeccionId(e.target.value);
                      setSelectedNivelId("");
                      setSelectedCajaId("");
                    }}
                    disabled={!selectedPasilloId}
                    className="w-full h-10 rounded-xl border bg-white px-2 outline-none font-semibold disabled:opacity-50"
                  >
                    <option value="">Ninguna</option>
                    {sections
                      .filter(s => s.id_zona_pasillo === parseInt(selectedPasilloId))
                      .map(s => (
                        <option key={s.id_zona_seccion} value={s.id_zona_seccion}>{s.nombre.toUpperCase()}</option>
                      ))}
                  </select>
                </div>

                {/* Nivel select */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Nivel (Nivel 4)</label>
                  <select
                    value={selectedNivelId}
                    onChange={e => {
                      setSelectedNivelId(e.target.value);
                      setSelectedCajaId("");
                    }}
                    disabled={!selectedSeccionId}
                    className="w-full h-10 rounded-xl border bg-white px-2 outline-none font-semibold disabled:opacity-50"
                  >
                    <option value="">Ninguno</option>
                    {niveles
                      .filter(n => n.id_zona_seccion === parseInt(selectedSeccionId))
                      .map(n => (
                        <option key={n.id_zona_nivel} value={n.id_zona_nivel}>{n.nombre.toUpperCase()}</option>
                      ))}
                  </select>
                </div>

                {/* Caja select */}
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Caja (Nivel 5)</label>
                  <select
                    value={selectedCajaId}
                    onChange={e => setSelectedCajaId(e.target.value)}
                    disabled={!selectedSeccionId}
                    className="w-full h-10 rounded-xl border bg-white px-2 outline-none font-semibold disabled:opacity-50"
                  >
                    <option value="">Asociar directamente a Nivel / Sección</option>
                    {cajas
                      .filter(b => {
                        if (b.numero_caja?.toUpperCase().startsWith("NIVEL:")) return false;
                        if (selectedNivelId) return b.id_zona_nivel === parseInt(selectedNivelId);
                        return b.id_zona_seccion === parseInt(selectedSeccionId);
                      })
                      .map(b => (
                        <option key={b.id_caja} value={b.id_caja}>CAJA {b.numero_caja} ({b.estado.toUpperCase()})</option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          )}
          
          {isGroup && hasPredefinedContainer && (
            <div className="p-3 bg-neutral-100 rounded-xl border text-xs text-neutral-600 font-bold flex items-center gap-2">
              <Box size={16} className="text-neutral-500" />
              <span>El grupo se asociará automáticamente al contenedor actual.</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl h-12">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="flex-1 rounded-xl h-12 bg-neutral-900 group text-white">
              {loading ? <Loader2 className="animate-spin mr-2 text-white" /> : <Save className="mr-2 group-hover:scale-110 transition-transform" />}
              Guardar {isGroup ? "Grupo" : "Artículo"}
            </Button>
          </div>
        </form>
      </DialogContent>

      {/* Row Camera Scanner Overlay Modal */}
      {activeScanRowIndex !== null && (
        <Dialog open={true} onOpenChange={(open) => !open && stopRowScanner()}>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white border shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-md font-black uppercase text-neutral-900 flex items-center gap-2">
                <Scan size={18} className="text-neutral-700" />
                Escaneo de SKU
              </DialogTitle>
              <DialogDescription className="text-xs text-neutral-500">
                Apunta al código de barras del producto para la fila {activeScanRowIndex + 1}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center justify-center p-4 bg-neutral-100 rounded-xl border relative min-h-[250px]">
              <div id="row-scanner-reader" className="w-full h-full"></div>
              <Button onClick={stopRowScanner} variant="outline" className="mt-4 w-full rounded-xl">
                Cancelar Escaneo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
