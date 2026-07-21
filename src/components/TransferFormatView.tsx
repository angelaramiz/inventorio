import { useState, useRef, useCallback } from "react";
import { Upload, X, QrCode, List, Package, Download, Plus, Trash2, ChevronRight, Camera, ImagePlus } from "lucide-react";
import { toast } from "sonner";

interface TransferItem {
  id: string;
  modelo_grupo?: string;
  codigo_color?: string;
  talla?: string;
  marca?: string;
  sku?: string;
  tipo_producto?: string;
  cantidad: number;
  containerId?: string;
}

const modeloCompuesto = (item: TransferItem) =>
  item.modelo_grupo && item.codigo_color ? `${item.modelo_grupo}-${item.codigo_color}`
    : item.modelo_grupo || item.codigo_color || "";

interface TransferContainer {
  id: string;
  name: string;
}

type TabType = "scanner" | "listado" | "contenedores";

export default function TransferFormatView() {
  const [config, setConfig] = useState<{ storeNumber: string; storeName: string; concept: string } | null>(null);
  const [storeNumber, setStoreNumber] = useState("");
  const [storeName, setStoreName] = useState("");
  const [concept, setConcept] = useState("");
  const [showSetup, setShowSetup] = useState(true);

  const [activeTab, setActiveTab] = useState<TabType>("scanner");
  const [items, setItems] = useState<TransferItem[]>([]);
  const [containers, setContainers] = useState<TransferContainer[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const serverUrl = localStorage.getItem("serverUrl") || "";

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const base = serverUrl || window.location.origin;
    const res = await fetch(`${base}${path}`, { headers: { ...init?.headers }, ...init });
    if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || `Error ${res.status}`); }
    return res.json();
  }, [serverUrl]);

  const processImage = async (file: File) => {
    const formData = new FormData();
    formData.append("foto", file, file.name || "label.jpg");
    try {
      const result = await api("/api/ocr/extract-label", { method: "POST", body: formData });
      setItems(prev => [...prev, {
        id: crypto.randomUUID(),
        modelo_grupo: result.modelo_grupo,
        codigo_color: result.codigo_color,
        talla: result.talla,
        marca: result.marca,
        sku: result.sku,
        tipo_producto: result.tipo_producto || "ropa",
        cantidad: 1,
      }]);
      return true;
    } catch { return false; }
  };

  const addImages = async (files: FileList) => {
    setIsScanning(true);
    let ok = 0;
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    for (let i = 0; i < arr.length; i++) {
      toast.loading(`Procesando ${i + 1}/${arr.length}...`, { id: "batch-ocr" });
      if (await processImage(arr[i])) ok++;
    }
    toast.dismiss("batch-ocr");
    toast.success(`${ok} producto(s) agregado(s)`);
    setIsScanning(false);
  };

  const buildCsv = () => {
    if (!config) return "";
    const date = new Date().toISOString().slice(0, 16).replace("T", " ");
    const lines = [
      `Tienda: ${config.storeNumber} - ${config.storeName}`,
      `Concepto: ${config.concept}`,
      `Fecha: ${date}`,
      `Total productos: ${items.length}`,
      "",
      `UPC,Modelo,Talla,Cantidad,Concepto`,
    ];
    for (const item of items) {
      const mc = item.modelo_grupo && item.codigo_color ? `${item.modelo_grupo}-${item.codigo_color}` : item.modelo_grupo || item.codigo_color || "";
      lines.push(`${item.sku || ""},${mc},${item.talla || ""},${item.cantidad || 1},${config.concept}`);
    }
    return lines.join("\n");
  };

  const downloadCsv = () => {
    const csv = buildCsv();
    if (!csv) { toast.error("No hay datos"); return; }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transferencia_${config?.storeNumber || "export"}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── Setup dialog ─────────────────────────────────────────────
  if (showSetup || !config) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <QrCode size={28} className="text-orange-600" />
            <div>
              <h1 className="text-xl font-black text-neutral-900">Transferencia a Tienda</h1>
              <p className="text-sm text-neutral-500">Configura los datos de la transferencia</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Número de Tienda *</label>
              <input value={storeNumber} onChange={e => setStoreNumber(e.target.value.slice(0, 10))}
                placeholder="Ej: 05029" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Nombre de Tienda *</label>
              <input value={storeName} onChange={e => setStoreName(e.target.value)}
                placeholder="Ej: Tienda Centro" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Concepto (columna final CSV)</label>
              <input value={concept} onChange={e => setConcept(e.target.value)}
                placeholder="Ej: apoyo a venta" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <button onClick={() => {
              if (!storeNumber.trim() || !storeName.trim()) { toast.error("Completa todos los campos"); return; }
              setConfig({ storeNumber: storeNumber.trim(), storeName: storeName.trim(), concept: concept.trim() });
              setShowSetup(false);
            }} className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700">
              Comenzar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between py-4 border-b border-neutral-200">
        <div className="flex items-center gap-3">
          <QrCode size={24} className="text-orange-600" />
          <div>
            <h1 className="text-lg font-black text-neutral-900">Tienda: {config.storeNumber} — {config.storeName}</h1>
            <p className="text-xs text-neutral-500">Concepto: {config.concept} · {items.length} productos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCsv} className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => setShowSetup(true)} className="px-3 py-2 border border-neutral-200 rounded-xl text-xs font-bold hover:bg-neutral-50">
            Configurar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 my-4 p-1 bg-neutral-100 rounded-xl">
        {(["scanner", "listado", "contenedores"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === tab ? "bg-white text-purple-700 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
            }`}>
            {tab === "scanner" ? <Camera size={14} /> : tab === "listado" ? <List size={14} /> : <Package size={14} />}
            {tab === "scanner" ? "Escáner" : tab === "listado" ? "Listado" : "Contenedores"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "scanner" && (
        <div>
          <div className="flex gap-3 mb-4">
            <button onClick={() => fileInputRef.current?.click()} disabled={isScanning}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-neutral-900 text-white rounded-xl text-sm font-bold hover:bg-neutral-800 disabled:opacity-50">
              <Camera size={16} /> Cámara
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={isScanning}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-neutral-600 text-white rounded-xl text-sm font-bold hover:bg-neutral-500 disabled:opacity-50">
              <ImagePlus size={16} /> Galería
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => e.target.files && addImages(e.target.files)} />

          {isScanning && (
            <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-xl mb-4">
              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-purple-700 font-bold">Analizando...</span>
            </div>
          )}

          {items.length === 0 ? (
            <div className="text-center py-20 text-neutral-400">
              <Camera size={48} className="mx-auto mb-3" />
              <p className="font-bold">Escanea etiquetas para agregar</p>
              <p className="text-sm">Usa cámara o selecciona imágenes</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-bold text-neutral-500">Últimos escaneados ({items.length})</p>
              {[...items].reverse().slice(0, 20).map(item => (
                <div key={item.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-neutral-100">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-neutral-900">{item.modelo_grupo || "SIN MODELO"}</p>
                    <div className="flex gap-3 text-xs text-neutral-500">
                      {item.codigo_color && <span>Color: {item.codigo_color}</span>}
                      {item.talla && <span>Talla: {item.talla}</span>}
                    </div>
                    {item.sku && <p className="text-xs text-purple-700 font-mono">SKU: {item.sku}</p>}
                  </div>
                  <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                    className="p-1 text-neutral-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "listado" && (
        <div>
          {items.length === 0 ? (
            <div className="text-center py-20 text-neutral-400">
              <List size={48} className="mx-auto mb-3" />
              <p className="font-bold">No hay productos</p>
              <p className="text-sm">Escanea productos en la pestaña Escáner</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-bold text-neutral-500">{items.length} productos · {new Set(items.map(i => i.modelo_grupo)).size} modelos</p>
              {Object.entries(items.reduce((acc, item) => {
                const k = item.modelo_grupo || "SIN MODELO";
                (acc[k] = acc[k] || []).push(item);
                return acc;
              }, {} as Record<string, TransferItem[]>)).map(([modelo, modelItems]: [string, TransferItem[]]) => (
                <div key={modelo} className="bg-white rounded-xl border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-black text-neutral-900">{modelo || "SIN MODELO"}</h3>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-bold">{modelItems.length}</span>
                  </div>
                  {modelItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 py-1.5 border-b border-neutral-50 last:border-0">
                      <div className="flex-1 text-sm">
                        {item.talla && <span className="font-bold">Talla: {item.talla} </span>}
                        {item.codigo_color && <span className="text-neutral-500">Color: {item.codigo_color} </span>}
                        {item.sku && <span className="text-xs text-neutral-400">SKU: {item.sku}</span>}
                      </div>
                      <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                        className="text-neutral-300 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "contenedores" && (
        <ContainersPanel
          items={items}
          containers={containers}
          config={config}
          onAddContainer={name => setContainers(prev => prev.some(c => c.name === name) ? prev : [...prev, { id: crypto.randomUUID(), name }])}
          onRemoveContainer={id => setContainers(prev => prev.filter(c => c.id !== id))}
          onAssignItem={(itemId, containerId) => setItems(prev => prev.map(i => i.id === itemId ? { ...i, containerId } : i))}
          onUnassignItem={itemId => setItems(prev => prev.map(i => i.id === itemId ? { ...i, containerId: undefined } : i))}
        />
      )}
    </div>
  );
}

function ContainersPanel({
  items, containers, config, onAddContainer, onRemoveContainer, onAssignItem, onUnassignItem,
}: {
  items: TransferItem[];
  containers: TransferContainer[];
  config: { storeNumber: string; storeName: string; concept: string };
  onAddContainer: (name: string) => void;
  onRemoveContainer: (id: string) => void;
  onAssignItem: (itemId: string, containerId: string) => void;
  onUnassignItem: (itemId: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [pickerContainer, setPickerContainer] = useState<string | null>(null);

  const unassigned = items.filter(i => !i.containerId);

  const printReport = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const date = new Date().toLocaleString();
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de Transferencia</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 11px; padding: 40px; color: #333; }
  h1 { font-size: 18px; font-weight: 900; }
  h2 { font-size: 14px; font-weight: 700; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th { text-align: left; padding: 6px 8px; background: #f3e8ff; border-bottom: 2px solid #7c3aed; font-size: 10px; text-transform: uppercase; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .barcode { font-family: 'Libre Barcode 128', 'Code128', monospace; font-size: 22px; letter-spacing: 1px; }
  .summary { margin-top: 20px; padding-top: 12px; border-top: 2px solid #333; font-weight: bold; }
  .footer { margin-top: 40px; font-size: 10px; color: #999; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>Transferencia a Tienda</h1>
<p><strong>Tienda:</strong> ${config.storeNumber} — ${config.storeName}<br>
<strong>Concepto:</strong> ${config.concept}<br>
<strong>Fecha:</strong> ${date}<br>
<strong>Total:</strong> ${items.length} productos · ${containers.length} contenedor(es)</p>
<hr>`;

    for (const container of containers) {
      const containerItems = items.filter(i => i.containerId === container.id);
      if (containerItems.length === 0) continue;
      html += `<h2>Contenedor: ${container.name}</h2>
<table><thead><tr><th>UPC</th><th>Modelo</th><th>Talla</th><th>Cant.</th><th>Código</th></tr></thead><tbody>`;
      for (const item of containerItems) {
        const mc = item.modelo_grupo && item.codigo_color ? `${item.modelo_grupo}-${item.codigo_color}` : item.modelo_grupo || item.codigo_color || "";
        html += `<tr><td>${item.sku || ""}</td><td>${mc}</td><td>${item.talla || ""}</td><td>${item.cantidad || 1}</td><td class="barcode">${item.sku || mc || "N/A"}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    html += `<div class="summary">Resumen: ${items.length} productos · ${containers.length} contenedores</div>
<div class="footer">Generado: ${date}</div>
<script>window.print();</script></body></html>`;
    w.document.write(html);
    w.document.close();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-neutral-500">{containers.length} contenedor(es)</span>
        <div className="flex gap-2">
          {containers.length > 0 && (
            <button onClick={printReport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold hover:bg-purple-200">
              <Download size={14} /> PDF
            </button>
          )}
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700">
            <Plus size={14} /> Crear
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-purple-200 space-y-3">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre del contenedor"
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-purple-400" />
          <div className="flex gap-2">
            <button onClick={() => { if (newName.trim()) { onAddContainer(newName.trim()); setNewName(""); setShowCreate(false); } }}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold">Crear</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border border-neutral-200 rounded-lg text-xs">Cancelar</button>
          </div>
        </div>
      )}

      {containers.length === 0 ? (
        <div className="text-center py-20 text-neutral-400">
          <Package size={48} className="mx-auto mb-3" />
          <p className="font-bold">Crea contenedores para organizar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {containers.map(container => {
            const containerItems = items.filter(i => i.containerId === container.id);
            return (
              <div key={container.id} className="bg-white rounded-xl border border-neutral-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-purple-600" />
                    <h3 className="font-bold text-neutral-900">{container.name}</h3>
                    <span className="text-xs text-neutral-400">({containerItems.length})</span>
                  </div>
                  <button onClick={() => onRemoveContainer(container.id)} className="text-neutral-300 hover:text-red-500"><Trash2 size={14} /></button>
                </div>

                {containerItems.length === 0 ? (
                  <p className="text-xs text-neutral-300 ml-7">Sin productos asignados</p>
                ) : (
                  containerItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 ml-7 py-1.5 border-b border-neutral-50 last:border-0">
                      <div className="flex-1">
                        <p className="text-xs font-bold">{item.modelo_grupo}</p>
                        <p className="text-xs text-neutral-500">{item.talla && `Talla: ${item.talla}`} {item.codigo_color && `· Color: ${item.codigo_color}`}</p>
                      </div>
                      <button onClick={() => onUnassignItem(item.id)} className="text-red-300 hover:text-red-500"><X size={12} /></button>
                    </div>
                  ))
                )}

                {unassigned.length > 0 && (
                  <button onClick={() => setPickerContainer(container.id)}
                    className="mt-2 flex items-center gap-1 ml-7 text-xs text-purple-600 hover:text-purple-800 font-bold">
                    <Plus size={12} /> Asignar producto
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pickerContainer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setPickerContainer(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto p-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm mb-3">Asignar a {containers.find(c => c.id === pickerContainer)?.name}</h3>
            {unassigned.length === 0 ? (
              <p className="text-xs text-neutral-400">No hay productos sin asignar</p>
            ) : (
              unassigned.map(item => (
                <div key={item.id} onClick={() => { onAssignItem(item.id, pickerContainer); setPickerContainer(null); }}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-purple-50 cursor-pointer border-b border-neutral-50">
                  <div>
                    <p className="text-sm font-bold">{item.modelo_grupo || "SIN MODELO"}</p>
                    <p className="text-xs text-neutral-500">Talla: {item.talla || "—"} · Color: {item.codigo_color || "—"}</p>
                  </div>
                  <ChevronRight size={16} className="text-purple-400" />
                </div>
              ))
            )}
            <button onClick={() => setPickerContainer(null)} className="mt-3 w-full py-2 text-center text-xs text-neutral-500 font-bold">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
