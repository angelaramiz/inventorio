import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Save, X, Loader2, Plus, Upload, FileText, CheckCircle2, AlertTriangle, Box } from "lucide-react";
import { toast } from "sonner";
import { fetchCatalogWithCache } from "../utils/pwaDb";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductCSVImportModal({ onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);

  // Locations list for container selection
  const [zones, setZones] = useState<any[]>([]);
  const [pasillos, setPasillos] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [niveles, setNiveles] = useState<any[]>([]);
  const [cajas, setCajas] = useState<any[]>([]);

  // Selected container IDs
  const [selectedAlmacenId, setSelectedAlmacenId] = useState("");
  const [selectedPasilloId, setSelectedPasilloId] = useState("");
  const [selectedSeccionId, setSelectedSeccionId] = useState("");
  const [selectedNivelId, setSelectedNivelId] = useState("");
  const [selectedCajaId, setSelectedCajaId] = useState("");

  const standardFields = [
    { key: "sku", label: "SKU / Código (Obligatorio)", synonyms: ["sku", "upc", "ean_13", "codigo", "barcode"] },
    { key: "ean_13", label: "EAN-13 (Opcional)", synonyms: ["ean_13", "ean", "ean13"] },
    { key: "talla", label: "Talla / Size (Opcional)", synonyms: ["talla", "tallas", "size", "sizes", "medida"] },
    { key: "modelo_grupo", label: "Modelo / Grupo (Opcional)", synonyms: ["modelo", "modelo_grupo", "grupo", "model"] },
    { key: "marca_sub", label: "Marca (Opcional)", synonyms: ["marca", "marca_sub", "brand", "marca/sub"] },
    { key: "tipo", label: "Tipo / Categoría (Opcional)", synonyms: ["tipo", "prenda", "categoria", "category", "tipo_prenda"] },
    { key: "temporada", label: "Temporada (Opcional)", synonyms: ["temporada", "season"] },
    { key: "cantidad", label: "Cantidad / Stock (Opcional)", synonyms: ["cantidad", "qty", "stock", "cant", "unidades"] }
  ];

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const [respZones, respPasillos, respSections, respNiveles, respBoxes] = await Promise.all([
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
      } catch (err) {
        console.error("Error loading location options", err);
      }
    };
    loadLocations();
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      processCSVFile(file);
    } else {
      toast.error("Por favor, sube únicamente un archivo .csv");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processCSVFile(file);
    }
  };

  const processCSVFile = (file: File) => {
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file, "UTF-8");
  };

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/);
    const result: string[][] = [];
    for (let line of lines) {
      if (!line.trim()) continue;
      const row: string[] = [];
      let inQuotes = false;
      let current = "";
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          row.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      row.push(current);
      result.push(row.map(cell => cell.trim().replace(/^"|"$/g, '')));
    }

    if (result.length < 2) {
      toast.error("El archivo CSV está vacío o le faltan líneas de datos");
      return;
    }

    const csvHeaders = result[0].map(h => h.toLowerCase());
    setHeaders(result[0]);

    // Map fields automatically based on synonyms
    const initialMapping: Record<string, string> = {};
    standardFields.forEach(field => {
      const matchedIdx = csvHeaders.findIndex(header => 
        field.synonyms.includes(header) || 
        header.includes(field.key) || 
        field.key.includes(header)
      );
      if (matchedIdx !== -1) {
        initialMapping[field.key] = result[0][matchedIdx];
      }
    });

    setMapping(initialMapping);

    const rowsData = result.slice(1).map(row => {
      const obj: Record<string, string> = {};
      result[0].forEach((header, idx) => {
        obj[header] = row[idx] || "";
      });
      return obj;
    });

    setParsedRows(rowsData);
  };

  const handleMappingChange = (fieldKey: string, csvHeader: string) => {
    setMapping(prev => ({
      ...prev,
      [fieldKey]: csvHeader
    }));
  };

  const handleSubmit = async () => {
    const skuHeader = mapping["sku"];
    if (!skuHeader) {
      return toast.error("Debes mapear obligatoriamente la columna SKU / Código");
    }

    setLoading(true);

    // Map parsed rows to API expected body
    const formattedProducts = parsedRows.map(row => {
      const p: Record<string, any> = {};
      standardFields.forEach(field => {
        const mappedHeader = mapping[field.key];
        if (mappedHeader) {
          p[field.key] = row[mappedHeader];
        }
      });
      return p;
    });

    try {
      const resp = await fetch("/api/productos/bulk-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: formattedProducts,
          id_caja: selectedCajaId || null,
          id_zona_nivel: selectedNivelId || null,
          id_zona_seccion: selectedSeccionId || null,
          id_zona_almacen: selectedAlmacenId || null
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        toast.success(`Importación masiva exitosa. ${data.count} productos procesados.`);
        onSuccess();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al procesar el archivo CSV");
      }
    } catch (e) {
      toast.error("Error al conectar con el servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-4xl sm:max-w-4xl gap-0 w-[95vw] rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="bg-neutral-955 text-white p-6 shrink-0 flex flex-row items-center justify-between relative">
          <button 
            type="button" 
            onClick={onClose} 
            className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors z-50"
          >
            <X size={18} />
          </button>
          <div>
            <DialogTitle className="text-xl font-black flex items-center gap-3 uppercase tracking-tight">
              <div className="bg-amber-400 p-1.5 rounded-lg text-black">
                <Upload size={18} />
              </div>
              Importación Masiva de Productos (CSV)
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-400 mt-1">
              Carga tu archivo de inventario en lote y asócialo a ubicaciones
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
          {/* Drag & Drop Area */}
          {!csvFile ? (
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById("csv-file-picker")?.click()}
              className={`border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all ${dragOver ? "border-amber-400 bg-amber-50/10" : "border-neutral-200 hover:bg-neutral-50/50"}`}
            >
              <input 
                type="file" 
                id="csv-file-picker" 
                accept=".csv" 
                className="hidden" 
                onChange={handleFileChange} 
              />
              <div className="p-4 bg-neutral-100 rounded-full mb-3 text-neutral-500">
                <FileText size={36} />
              </div>
              <p className="text-sm font-bold text-neutral-800">Arrastra tu archivo .csv aquí</p>
              <p className="text-xs text-neutral-500 mt-1">O haz clic para explorar en tu equipo</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* File Info */}
              <div className="flex items-center justify-between bg-neutral-100 p-4 rounded-2xl border">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-neutral-200 rounded-lg text-neutral-700">
                    <FileText size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-neutral-900">{csvFile.name}</p>
                    <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">{parsedRows.length} filas detectadas</p>
                  </div>
                </div>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    setCsvFile(null);
                    setParsedRows([]);
                    setHeaders([]);
                  }}
                  className="rounded-xl h-8 text-[10px] uppercase font-black tracking-wider border-neutral-300"
                >
                  Cambiar archivo
                </Button>
              </div>

              {/* Column Mapping Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase text-neutral-950 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-neutral-500" />
                  1. Mapeo de Columnas
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-neutral-50/50 p-4 rounded-2xl border text-xs">
                  {standardFields.map(field => {
                    const mappedValue = mapping[field.key] || "";
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black text-neutral-500 px-1 block">
                          {field.label}
                        </label>
                        <select
                          value={mappedValue}
                          onChange={e => handleMappingChange(field.key, e.target.value)}
                          className={`w-full h-9 rounded-xl border px-2 outline-none font-semibold ${!mappedValue && field.key === "sku" ? "border-rose-500 bg-rose-50/10 text-rose-900" : "bg-white"}`}
                        >
                          <option value="">-- No incluir (Usa valor por defecto) --</option>
                          {headers.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Destination Container Selector */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase text-neutral-950 flex items-center gap-2">
                  <Box size={14} className="text-neutral-500" />
                  2. Ubicación / Contenedor Destino para el Stock (Opcional)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-neutral-50/50 p-4 rounded-2xl border text-xs">
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

              {/* Data Preview Table */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase text-neutral-950 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-neutral-500" />
                  3. Vista Previa de Datos (Primeras 5 Filas)
                </h3>
                <div className="border rounded-2xl overflow-hidden overflow-x-auto bg-white shadow-sm">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50 border-b">
                        {headers.map(h => (
                          <th key={h} className="p-3 font-bold text-neutral-700 capitalize border-r last:border-r-0">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="border-b last:border-b-0 hover:bg-neutral-50/50">
                          {headers.map(h => (
                            <td key={h} className="p-3 text-neutral-600 border-r last:border-r-0 font-medium">{row[h] || "-"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 p-6 bg-neutral-50 border-t shrink-0">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl h-12">
            Cancelar
          </Button>
          <Button 
            type="button" 
            disabled={loading || !csvFile || !mapping["sku"]} 
            onClick={handleSubmit} 
            className="flex-1 rounded-xl h-12 bg-neutral-900 group text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin mr-2 text-white" /> : <Save className="mr-2 group-hover:scale-110 transition-transform" />}
            Importar Productos
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
