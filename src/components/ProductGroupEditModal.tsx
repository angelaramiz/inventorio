import React, { useState, useEffect, FormEvent, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Loader2, Image as ImageIcon, Trash2, Layers, Search, CheckCircle, AlertCircle, Edit, Scan, X } from "lucide-react";
import { toast } from "sonner";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Producto, Temporada, TipoProducto } from "../types";
import { fetchCatalogWithCache } from "../utils/pwaDb";

interface Props {
  uniqueModels: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductGroupEditModal({ uniqueModels, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  
  // Resolved state
  const [resolvedModel, setResolvedModel] = useState<string | null>(null);
  const [groupProducts, setGroupProducts] = useState<Producto[]>([]);
  const [activeTab, setActiveTab] = useState<"express" | "advanced">("express");

  // Camera scanner states
  const [isScannerActive, setIsScannerActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Express edit options
  const [updateModelName, setUpdateModelName] = useState(false);
  const [updateTemporada, setUpdateTemporada] = useState(false);
  const [updateTipo, setUpdateTipo] = useState(false);
  const [updateMarca, setUpdateMarca] = useState(false);
  const [updateFoto, setUpdateFoto] = useState(false);

  // Express values
  const [newModelName, setNewModelName] = useState("");
  const [temporadaVal, setTemporadaVal] = useState<Temporada>("todouso");
  const [tipoVal, setTipoVal] = useState<TipoProducto>("otro");
  const [marcaVal, setMarcaVal] = useState("Guess");
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [deleteFoto, setDeleteFoto] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Advanced edit values
  const [advancedProducts, setAdvancedProducts] = useState<{ id_producto: number; sku: string; ean_13: string; talla: string }[]>([]);

  // Concept options
  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>(["Guess", "Marciano", "GuessEco"]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [tempVals, tiposVals, marcaVals] = await Promise.all([
          fetchCatalogWithCache("/api/conceptos/temporadas", "temporadas"),
          fetchCatalogWithCache("/api/conceptos/tipos", "tipos"),
          fetchCatalogWithCache("/api/conceptos/marcas", "marcas")
        ]);
        
        setTemporadas(tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
        setTipos(tiposVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
        
        const marcaNames = marcaVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        if (marcaNames.length > 0) {
          setMarcas(marcaNames);
        }
      } catch (err) {
        console.error("Error loading concepts", err);
      }
    };
    loadOptions();
  }, []);


  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop();
          }
        } catch (e) {}
      }
    };
  }, []);

  const startScanner = async () => {
    try {
      setIsScannerActive(true);
      await new Promise(resolve => setTimeout(resolve, 100)); // wait for DOM to update
      try {
        const html5QrCode = new Html5Qrcode("group-edit-reader");
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
          async (decodedText) => {
            await stopScanner();
            setSearchQuery(decodedText);
            // Auto validate the scanned code
            setIsValidating(true);
            try {
              const verifyResp = await fetch(`/api/verificar/${decodedText.trim()}`);
              if (verifyResp.ok) {
                const verifyData = await verifyResp.json();
                if (verifyData.exists && verifyData.product) {
                  const modelName = verifyData.product.modelo_grupo;
                  if (modelName && modelName !== "sin modelo") {
                    await loadProductsForModel(modelName);
                    return;
                  }
                }
              }
              await loadProductsForModel(decodedText.trim());
            } catch (err) {
              toast.error("Error al validar el código escaneado");
            } finally {
              setIsValidating(false);
            }
          },
          () => {}
        );
        toast.success("Cámara de escaneo iniciada");
      } catch (err) {
        toast.error("Error al iniciar cámara");
        setIsScannerActive(false);
      }
    } catch (e) {
      setIsScannerActive(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {}
      scannerRef.current = null;
    }
    setIsScannerActive(false);
  };

  const handleValidateModelOrSku = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsValidating(true);
    setResolvedModel(null);
    setGroupProducts([]);

    const query = searchQuery.trim();

    try {
      // 1. Try to verify if it is a Product SKU/EAN first
      const verifyResp = await fetch(`/api/verificar/${query}`);
      if (verifyResp.ok) {
        const verifyData = await verifyResp.json();
        if (verifyData.exists && verifyData.product) {
          const modelName = verifyData.product.modelo_grupo;
          if (modelName && modelName !== "sin modelo") {
            // Successfully found model name from SKU, now fetch group products
            await loadProductsForModel(modelName);
            setSearchQuery(""); // clear search input upon success
            return;
          }
        }
      }

      // 2. If product verification fails or has no model, try to search directly for products belonging to this model group
      await loadProductsForModel(query);
    } catch (err) {
      toast.error("Error al validar el código");
    } finally {
      setIsValidating(false);
    }
  };

  const loadProductsForModel = async (modelName: string) => {
    const resp = await fetch(`/api/productos?modelo_grupo=${encodeURIComponent(modelName)}`);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        setResolvedModel(modelName);
        setGroupProducts(data);
        setAdvancedProducts(
          data.map((p) => ({
            id_producto: p.id_producto,
            sku: p.sku,
            ean_13: p.ean_13 || "",
            talla: p.talla || ""
          }))
        );
        toast.success(`Modelo "${modelName.toUpperCase()}" validado con ${data.length} productos.`);
      } else {
        toast.error(`No se encontraron productos con el modelo o SKU "${modelName}".`);
      }
    } else {
      toast.error("Error al conectar con la base de datos de productos");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 200 * 1024) {
        toast.error("La imagen debe pesar menos de 200KB");
        return;
      }
      setFotoFile(file);
      setDeleteFoto(false);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAdvancedProdChange = (id_producto: number, field: "sku" | "ean_13" | "talla", value: string) => {
    setAdvancedProducts((prev) =>
      prev.map((ap) => (ap.id_producto === id_producto ? { ...ap, [field]: value } : ap))
    );
  };

  const handleSaveExpress = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolvedModel) return;

    const hasAnyFieldSelected = updateModelName || updateTemporada || updateTipo || updateMarca || updateFoto;
    if (!hasAnyFieldSelected) return toast.error("Debe activar al menos un campo para actualizar");

    setLoading(true);
    
    const bodyFormData = new FormData();
    bodyFormData.append("modelo_grupo_origen", resolvedModel);

    if (updateModelName && newModelName.trim()) {
      bodyFormData.append("modelo_grupo_nuevo", newModelName.trim());
    }
    if (updateTemporada) {
      bodyFormData.append("temporada", temporadaVal);
    }
    if (updateTipo) {
      bodyFormData.append("tipo", tipoVal);
    }
    if (updateMarca) {
      bodyFormData.append("marca_sub", marcaVal);
    }
    if (updateFoto) {
      if (deleteFoto) {
        bodyFormData.append("delete_foto", "true");
      } else if (fotoFile) {
        bodyFormData.append("foto", fotoFile);
      }
    }

    try {
      const resp = await fetch("/api/productos/group-edit", {
        method: "PUT",
        body: bodyFormData
      });

      if (resp.ok) {
        const result = await resp.json();
        toast.success(`Edición express aplicada: Se actualizaron ${result.count} productos.`);
        onSuccess();
        onClose();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAdvanced = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolvedModel) return;

    // Validate that no product has an empty SKU
    const hasEmptySku = advancedProducts.some((p) => !p.sku.trim());
    if (hasEmptySku) {
      return toast.error("Todos los productos deben tener un SKU válido");
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/productos/bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: advancedProducts })
      });

      if (resp.ok) {
        toast.success("Edición avanzada guardada con éxito");
        onSuccess();
        onClose();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al guardar los cambios");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl sm:max-w-2xl gap-0 w-[95vw] rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl flex flex-col h-[85vh] max-h-[85vh]">
        <DialogHeader className="bg-neutral-955 text-white p-6 shrink-0 relative">
          <button 
            type="button" 
            onClick={onClose} 
            className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors z-50"
            title="Cerrar"
          >
            <X size={18} />
          </button>
          <DialogTitle className="text-xl font-black flex items-center gap-3 uppercase tracking-tight">
            <div className="bg-amber-400 p-1.5 rounded-lg text-black">
              <Layers size={18} />
            </div>
            Edición por Modelo (Grupo)
          </DialogTitle>
        </DialogHeader>

        {/* BUSCADOR DE MODELO O SKU */}
        <div className="p-6 pb-4 border-b bg-neutral-50/50 shrink-0">
          <form onSubmit={handleValidateModelOrSku} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 text-neutral-400" size={18} />
              <Input
                placeholder="Escribe el modelo o escanea el SKU de una prenda..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 rounded-xl h-11 bg-white border-neutral-200 focus-visible:ring-neutral-400"
                disabled={isValidating}
              />
              <button
                type="button"
                onClick={() => {
                  if (isScannerActive) {
                    stopScanner();
                  } else {
                    startScanner();
                  }
                }}
                className={`absolute right-3.5 top-3 text-neutral-400 hover:text-neutral-950 transition-colors ${
                  isScannerActive ? "text-amber-500 hover:text-amber-600" : ""
                }`}
                title="Abrir Escáner"
              >
                <Scan size={18} />
              </button>
            </div>
            <Button
              type="submit"
              disabled={isValidating || !searchQuery.trim()}
              className="rounded-xl h-11 bg-neutral-900 text-white font-bold px-5"
            >
              {isValidating ? <Loader2 className="animate-spin" size={16} /> : "Validar"}
            </Button>
          </form>

          {isScannerActive && (
            <div className="mt-3 relative rounded-2xl overflow-hidden border bg-neutral-950 aspect-[4/3] max-h-48 w-full mx-auto animate-in fade-in duration-200">
              <div id="group-edit-reader" className="w-full h-full object-cover" />
            </div>
          )}

          {resolvedModel ? (
            <div className="flex items-center gap-2 mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs font-semibold">
              <CheckCircle size={16} className="shrink-0" />
              <span>
                Modelo Cargado: <strong className="font-extrabold">{resolvedModel.toUpperCase()}</strong> ({groupProducts.length} productos en el grupo)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-3 p-3 bg-neutral-100 border rounded-xl text-neutral-500 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>Ingresa un modelo o escanea un código para cargar y habilitar los editores.</span>
            </div>
          )}
        </div>

        {/* EDITORS - ONLY VISIBLE IF MODEL RESOLVED */}
        {resolvedModel ? (
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            {/* TABS SELECTOR */}
            <div className="flex border-b shrink-0 bg-neutral-50/20 px-6">
              <button
                type="button"
                onClick={() => {
                  stopScanner();
                  setActiveTab("express");
                }}
                className={`py-3 px-4 font-bold text-xs uppercase tracking-wider border-b-2 transition-colors ${
                  activeTab === "express"
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-neutral-400 hover:text-neutral-900"
                }`}
              >
                Edición Express
              </button>
              <button
                type="button"
                onClick={() => {
                  stopScanner();
                  setActiveTab("advanced");
                }}
                className={`py-3 px-4 font-bold text-xs uppercase tracking-wider border-b-2 transition-colors ${
                  activeTab === "advanced"
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-neutral-400 hover:text-neutral-900"
                }`}
              >
                Edición Avanzada (Tabla)
              </button>
            </div>

            {/* TAB CONTENTS */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0 animate-in fade-in duration-200">
              {activeTab === "express" ? (
                <form onSubmit={handleSaveExpress} className="space-y-4">
                  <p className="text-[10.5px] font-black text-neutral-400 uppercase tracking-wider">Campos a Actualizar</p>

                  {/* UPDATE MODEL NAME */}
                  <div className="space-y-2 border-b pb-3 border-neutral-50">
                    <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={updateModelName} 
                        onChange={e => setUpdateModelName(e.target.checked)} 
                        className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                      />
                      Cambiar Nombre del Modelo
                    </label>
                    {updateModelName && (
                      <Input 
                        value={newModelName}
                        onChange={e => setNewModelName(e.target.value)}
                        placeholder="Nuevo nombre del modelo (ej: M12345)"
                        className="rounded-xl bg-neutral-50 animate-in slide-in-from-top-2 duration-150 h-10"
                        required
                      />
                    )}
                  </div>

                  {/* UPDATE TEMPORADA */}
                  <div className="space-y-2 border-b pb-3 border-neutral-50">
                    <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={updateTemporada} 
                        onChange={e => setUpdateTemporada(e.target.checked)} 
                        className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                      />
                      Cambiar Temporada
                    </label>
                    {updateTemporada && (
                      <Select value={temporadaVal} onValueChange={(v: any) => setTemporadaVal(v)}>
                        <SelectTrigger className="rounded-xl bg-neutral-50 h-10 animate-in slide-in-from-top-2 duration-150 capitalize">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {temporadas.map(temp => (
                            <SelectItem key={temp} value={temp} className="capitalize">{temp}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* UPDATE TIPO */}
                  <div className="space-y-2 border-b pb-3 border-neutral-50">
                    <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={updateTipo} 
                        onChange={e => setUpdateTipo(e.target.checked)} 
                        className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                      />
                      Cambiar Tipo de Prenda
                    </label>
                    {updateTipo && (
                      <Select value={tipoVal} onValueChange={(v: any) => setTipoVal(v)}>
                        <SelectTrigger className="rounded-xl bg-neutral-50 h-10 animate-in slide-in-from-top-2 duration-150 capitalize">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {tipos.map(t => (
                            <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* UPDATE MARCA */}
                  <div className="space-y-2 border-b pb-3 border-neutral-50">
                    <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={updateMarca} 
                        onChange={e => setUpdateMarca(e.target.checked)} 
                        className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                      />
                      Cambiar Marca
                    </label>
                    {updateMarca && (
                      <Select value={marcaVal} onValueChange={v => setMarcaVal(v)}>
                        <SelectTrigger className="rounded-xl bg-neutral-50 h-10 animate-in slide-in-from-top-2 duration-150">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {marcas.map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* UPDATE FOTO */}
                  <div className="space-y-2 pb-1">
                    <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={updateFoto} 
                        onChange={e => setUpdateFoto(e.target.checked)} 
                        className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                      />
                      Cambiar/Eliminar Imagen del Grupo
                    </label>
                    {updateFoto && (
                      <div className="space-y-3 bg-neutral-50 p-4 rounded-2xl border border-neutral-100 animate-in slide-in-from-top-2 duration-150">
                        <div className="flex gap-2">
                          <Button 
                            type="button"
                            variant={deleteFoto ? "default" : "outline"}
                            onClick={() => {
                              setDeleteFoto(true);
                              setFotoFile(null);
                              setImagePreview(null);
                            }}
                            className={`flex-1 text-xs rounded-xl h-9 font-bold ${deleteFoto ? "bg-rose-600 hover:bg-rose-700 text-white" : ""}`}
                          >
                            <Trash2 size={13} className="mr-1" /> Eliminar Foto Existente
                          </Button>
                          <label className={`flex-1 flex items-center justify-center gap-1 text-xs rounded-xl h-9 font-bold border cursor-pointer hover:bg-neutral-100 transition-colors bg-white ${!deleteFoto && imagePreview ? "border-neutral-900" : "border-neutral-200"}`}>
                            <ImageIcon size={13} />
                            {fotoFile ? "Cambiar Foto" : "Subir Foto"}
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={handleFileChange} 
                              className="hidden" 
                            />
                          </label>
                        </div>
                        {imagePreview && (
                          <div className="relative w-full h-32 rounded-xl overflow-hidden border">
                            <img 
                              src={imagePreview} 
                              alt="Vista previa" 
                              className="w-full h-full object-cover" 
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4 border-t shrink-0">
                    <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl h-11">
                      Cancelar
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={loading || !(updateModelName || updateTemporada || updateTipo || updateMarca || updateFoto)} 
                      className="flex-1 rounded-xl h-11 bg-neutral-900 animate-in fade-in"
                    >
                      {loading ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />}
                      Aplicar Cambios Express
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleSaveAdvanced} className="flex flex-col h-full min-h-0 space-y-4 animate-in fade-in">
                  <div className="flex-1 overflow-auto rounded-xl border max-h-[35vh]">
                    <Table>
                      <TableHeader className="bg-neutral-50 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-[180px]">SKU</TableHead>
                          <TableHead className="w-[180px]">EAN-13</TableHead>
                          <TableHead className="w-[120px]">Talla</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {advancedProducts.map((p) => (
                          <TableRow key={p.id_producto}>
                            <TableCell className="py-1.5">
                              <Input
                                value={p.sku}
                                onChange={(e) => handleAdvancedProdChange(p.id_producto, "sku", e.target.value)}
                                className="h-8 rounded-lg text-xs"
                                required
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                value={p.ean_13}
                                onChange={(e) => handleAdvancedProdChange(p.id_producto, "ean_13", e.target.value)}
                                className="h-8 rounded-lg text-xs"
                                placeholder="EAN opcional"
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                value={p.talla}
                                onChange={(e) => handleAdvancedProdChange(p.id_producto, "talla", e.target.value)}
                                className="h-8 rounded-lg text-xs text-center font-bold"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex gap-3 pt-4 border-t shrink-0">
                    <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl h-11">
                      Cancelar
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={loading || advancedProducts.length === 0} 
                      className="flex-1 rounded-xl h-11 bg-neutral-900"
                    >
                      {loading ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />}
                      Guardar Cambios Avanzados
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400 bg-white">
            <Layers size={48} className="opacity-15 mb-3" />
            <p className="text-sm font-semibold">Esperando código...</p>
            <p className="text-xs text-neutral-500 text-center max-w-[280px] mt-1">
              Ingresa el identificador del modelo o escanea el SKU de un producto en el buscador superior para comenzar.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
