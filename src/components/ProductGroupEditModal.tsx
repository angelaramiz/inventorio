import React, { useState, useEffect, FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Image as ImageIcon, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import { Temporada, TipoProducto } from "../types";

interface Props {
  uniqueModels: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductGroupEditModal({ uniqueModels, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  
  // Fields to update toggles
  const [updateModelName, setUpdateModelName] = useState(false);
  const [updateTemporada, setUpdateTemporada] = useState(false);
  const [updateTipo, setUpdateTipo] = useState(false);
  const [updateMarca, setUpdateMarca] = useState(false);
  const [updateFoto, setUpdateFoto] = useState(false);

  // Field values
  const [newModelName, setNewModelName] = useState("");
  const [temporadaVal, setTemporadaVal] = useState<Temporada>("todouso");
  const [tipoVal, setTipoVal] = useState<TipoProducto>("otro");
  const [marcaVal, setMarcaVal] = useState("Guess");
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [deleteFoto, setDeleteFoto] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>(["Guess", "Marciano", "GuessEco"]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [respTemp, respTipos, respMarcas] = await Promise.all([
          fetch("/api/conceptos/temporadas"),
          fetch("/api/conceptos/tipos"),
          fetch("/api/conceptos/marcas")
        ]);
        const tempVals = await respTemp.json();
        const tiposVals = await respTipos.json();
        const marcaVals = await respMarcas.json();
        
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedModel) return toast.error("Debe seleccionar un modelo de grupo");

    const hasAnyFieldSelected = updateModelName || updateTemporada || updateTipo || updateMarca || updateFoto;
    if (!hasAnyFieldSelected) return toast.error("Debe activar al menos un campo para actualizar");

    setLoading(true);
    
    // Use FormData to support file upload
    const bodyFormData = new FormData();
    bodyFormData.append("modelo_grupo_origen", selectedModel);

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
        body: bodyFormData // Browser automatically sets Content-Type to multipart/form-data
      });

      if (resp.ok) {
        const result = await resp.json();
        toast.success(`Se actualizaron ${result.count} productos de forma exitosa`);
        onSuccess();
        onClose();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar productos del grupo");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md sm:max-w-md gap-0 w-[95vw] rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="bg-neutral-950 text-white p-6 shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-3 uppercase tracking-tight">
            <div className="bg-amber-400 p-1.5 rounded-lg text-black">
              <Layers size={18} />
            </div>
            Edición por Modelo (Grupo)
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          {/* SELECT TARGET MODEL */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Selecciona el Modelo a Modificar</label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="rounded-xl bg-neutral-50 h-11">
                <SelectValue placeholder="Elige un modelo..." />
              </SelectTrigger>
              <SelectContent>
                {uniqueModels.map(m => (
                  <SelectItem key={m} value={m}>{m.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t border-neutral-100 pt-3 space-y-4">
            <p className="text-[10.5px] font-bold text-neutral-500 uppercase tracking-wider px-1">Campos a Actualizar</p>

            {/* UPDATE MODEL NAME */}
            <div className="space-y-2 border-b pb-3 border-neutral-50">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={updateModelName} 
                    onChange={e => setUpdateModelName(e.target.checked)} 
                    className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                  />
                  Cambiar Nombre del Modelo
                </label>
              </div>
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
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={updateTemporada} 
                    onChange={e => setUpdateTemporada(e.target.checked)} 
                    className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                  />
                  Cambiar Temporada
                </label>
              </div>
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
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={updateTipo} 
                    onChange={e => setUpdateTipo(e.target.checked)} 
                    className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                  />
                  Cambiar Tipo de Prenda
                </label>
              </div>
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
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={updateMarca} 
                    onChange={e => setUpdateMarca(e.target.checked)} 
                    className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                  />
                  Cambiar Marca
                </label>
              </div>
              {updateMarca && (
                <Select value={marcaVal} onValueChange={setMarcaVal}>
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
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={updateFoto} 
                    onChange={e => setUpdateFoto(e.target.checked)} 
                    className="w-4 h-4 rounded text-neutral-900 border-neutral-350 focus:ring-neutral-950" 
                  />
                  Cambiar/Eliminar Imagen del Grupo
                </label>
              </div>
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
          </div>

          <div className="flex gap-3 pt-4 border-t border-neutral-100">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl h-12">
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !selectedModel || !(updateModelName || updateTemporada || updateTipo || updateMarca || updateFoto)} 
              className="flex-1 rounded-xl h-12 bg-neutral-900 group"
            >
              {loading ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2 group-hover:scale-110 transition-transform" />}
              Aplicar Cambios
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
