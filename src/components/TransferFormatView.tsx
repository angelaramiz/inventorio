import { useState, useEffect } from "react";
import { QrCode, List, Package, Download, Plus, Trash2, Camera, History, Check, Edit3, Eye, Truck, ChevronRight, X, Save, RotateCcw, ArrowLeft, Store, Search } from "lucide-react";
import { toast } from "sonner";

enum TransferStatus {
  ACTIVA = "ACTIVA",
  ESPERA_VOBO = "ESPERA_VOBO",
  CONFIRMADO = "CONFIRMADO",
  ESPERA_RECOLECCION = "ESPERA_RECOLECCION",
  ENVIADO = "ENVIADO",
}

const STATUS_LABELS: Record<TransferStatus, string> = {
  [TransferStatus.ACTIVA]: "Activa",
  [TransferStatus.ESPERA_VOBO]: "Espera VoBo",
  [TransferStatus.CONFIRMADO]: "Confirmado",
  [TransferStatus.ESPERA_RECOLECCION]: "Espera Recolección",
  [TransferStatus.ENVIADO]: "Enviado",
};

const STATUS_COLORS: Record<TransferStatus, string> = {
  [TransferStatus.ACTIVA]: "text-amber-600 bg-amber-50",
  [TransferStatus.ESPERA_VOBO]: "text-blue-600 bg-blue-50",
  [TransferStatus.CONFIRMADO]: "text-emerald-600 bg-emerald-50",
  [TransferStatus.ESPERA_RECOLECCION]: "text-purple-600 bg-purple-50",
  [TransferStatus.ENVIADO]: "text-neutral-600 bg-neutral-100",
};

const STATUS_ICONS: Record<TransferStatus, typeof Edit3> = {
  [TransferStatus.ACTIVA]: Edit3,
  [TransferStatus.ESPERA_VOBO]: Eye,
  [TransferStatus.CONFIRMADO]: Check,
  [TransferStatus.ESPERA_RECOLECCION]: Truck,
  [TransferStatus.ENVIADO]: Check,
};

interface TransferStore {
  storeNumber: string;
  storeName: string;
}

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

interface TransferContainer {
  id: string;
  name: string;
}

interface TransferDestination {
  id: string;
  store: TransferStore;
  concept: string;
  items: TransferItem[];
  containers: TransferContainer[];
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
}

const modeloCompuesto = (item: TransferItem) =>
  item.modelo_grupo && item.codigo_color ? `${item.modelo_grupo}-${item.codigo_color}` : item.modelo_grupo || item.codigo_color || "";

function loadDestinations(): TransferDestination[] {
  try { return JSON.parse(localStorage.getItem("transfer_destinations") || "[]"); } catch { return []; }
}

function saveDestinations(d: TransferDestination[]) {
  localStorage.setItem("transfer_destinations", JSON.stringify(d));
}

function loadSavedStores(): TransferStore[] {
  try { return JSON.parse(localStorage.getItem("transfer_saved_stores") || "[]"); } catch { return []; }
}

function saveSavedStores(s: TransferStore[]) {
  localStorage.setItem("transfer_saved_stores", JSON.stringify(s));
}

function loadHistory(): TransferDestination[] {
  try { return JSON.parse(localStorage.getItem("transfer_history") || "[]"); } catch { return []; }
}

function saveHistory(h: TransferDestination[]) {
  localStorage.setItem("transfer_history", JSON.stringify(h));
}

type TabType = "scanner" | "listado" | "contenedores";

export default function TransferFormatView() {
  const [destinations, setDestinations] = useState<TransferDestination[]>(loadDestinations);
  const [history, setHistory] = useState<TransferDestination[]>(loadHistory);
  const [savedStores, setSavedStores] = useState<TransferStore[]>(loadSavedStores);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedDest, setSelectedDest] = useState<TransferDestination | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Setup form
  const [storeNumber, setStoreNumber] = useState("");
  const [storeName, setStoreName] = useState("");
  const [concept, setConcept] = useState("");
  const [storeSearch, setStoreSearch] = useState("");

  // Detail view state
  const [items, setItems] = useState<TransferItem[]>([]);
  const [containers, setContainers] = useState<TransferContainer[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("scanner");

  const persist = (dests: TransferDestination[], hist: TransferDestination[], stores: TransferStore[]) => {
    saveDestinations(dests); saveHistory(hist); saveSavedStores(stores);
    setDestinations(dests); setHistory(hist); setSavedStores(stores);
  };

  const updateStatus = (destId: string, status: TransferStatus) => {
    const newDests = destinations.map(d => d.id === destId ? { ...d, status, updatedAt: new Date().toISOString() } : d);
    if (status === TransferStatus.ENVIADO) {
      const moved = newDests.filter(d => d.id === destId);
      const rest = newDests.filter(d => d.id !== destId);
      persist(rest, [...moved, ...history], savedStores);
    } else {
      persist(newDests, history, savedStores);
    }
  };

  const deleteDest = (destId: string) => {
    persist(destinations.filter(d => d.id !== destId), history, savedStores);
    setConfirmDeleteId(null);
  };

  const deleteHistoryItem = (destId: string) => {
    persist(destinations, history.filter(d => d.id !== destId), savedStores);
  };

  const openDest = (dest: TransferDestination) => {
    setSelectedDest(dest);
    setItems(dest.items);
    setContainers(dest.containers);
    setActiveTab("scanner");
  };

  const saveDetail = () => {
    if (!selectedDest) return;
    const updated = { ...selectedDest, items, containers, updatedAt: new Date().toISOString() };
    const newDests = destinations.map(d => d.id === selectedDest.id ? updated : d);
    persist(newDests, history, savedStores);
    setSelectedDest(updated);
    toast.success("Transferencia guardada");
  };

  const addManualItem = (item: TransferItem) => {
    setItems(prev => [...prev, item]);
    setShowManualEntry(false);
  };

  const buildCsv = () => {
    if (!selectedDest) return "";
    const date = new Date().toISOString().slice(0, 16).replace("T", " ");
    const lines = [
      `Tienda: ${selectedDest.store.storeNumber} - ${selectedDest.store.storeName}`,
      `Concepto: ${selectedDest.concept}`,
      `Fecha: ${date}`,
      `Total productos: ${items.length}`,
      "",
      "UPC,Modelo,Talla,Cantidad,Concepto",
    ];
    for (const item of items) {
      const mc = modeloCompuesto(item);
      lines.push(`${item.sku || ""},${mc},${item.talla || ""},${item.cantidad || 1},${selectedDest.concept}`);
    }
    return lines.join("\n");
  };

  const downloadCsv = () => {
    const csv = buildCsv();
    if (!csv) { toast.error("No hay datos"); return; }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transferencia_${selectedDest?.store.storeNumber || "export"}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── Status Picker Dialog ──────────────────────────────────────
  if (showStatusPicker) {
    const currentDest = destinations.find(d => d.id === showStatusPicker);
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowStatusPicker(null)}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-black text-neutral-900 mb-4">Cambiar Estado</h2>
          <div className="space-y-2">
            {Object.values(TransferStatus).map(status => {
              const Icon = STATUS_ICONS[status];
              const isSelected = currentDest?.status === status;
              return (
                <button key={status} onClick={() => { updateStatus(showStatusPicker, status); setShowStatusPicker(null); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isSelected ? "bg-purple-50 ring-2 ring-purple-400" : "bg-neutral-50 hover:bg-neutral-100"}`}>
                  <Icon size={18} className={`${isSelected ? "text-purple-600" : "text-neutral-500"}`} />
                  <div className="flex-1">
                    <span className="font-bold text-sm text-neutral-900">{STATUS_LABELS[status]}</span>
                    {isSelected && <span className="text-xs text-purple-600 ml-2 font-bold">Actual</span>}
                  </div>
                  {isSelected && <Check size={16} className="text-purple-600" />}
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowStatusPicker(null)} className="w-full mt-4 py-2.5 text-sm font-bold text-neutral-500 hover:text-neutral-800">Cerrar</button>
        </div>
      </div>
    );
  }

  // ── Setup Dialog ──────────────────────────────────────────────
  if (showSetup) {
    const filteredStores = storeSearch.trim()
      ? savedStores.filter(s => `${s.storeNumber} ${s.storeName}`.toLowerCase().includes(storeSearch.toLowerCase()))
      : savedStores;
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSetup(false)}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-6">
            <QrCode size={24} className="text-orange-600" />
            <div>
              <h2 className="text-xl font-black text-neutral-900">Nueva Transferencia</h2>
              <p className="text-sm text-neutral-500">Datos de la tienda destino</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Buscar tienda guardada</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={storeSearch} onChange={e => setStoreSearch(e.target.value)}
                  placeholder="Nombre o número..." className="w-full pl-9 pr-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
              </div>
              {filteredStores.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                  {filteredStores.slice(0, 5).map(s => (
                    <button key={s.storeNumber} onClick={() => { setStoreNumber(s.storeNumber); setStoreName(s.storeName); setStoreSearch(""); }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-neutral-50 hover:bg-purple-50 text-sm font-medium">
                      {s.storeNumber} — {s.storeName}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              <label className="text-xs font-bold text-neutral-600 block mb-1">Concepto</label>
              <input value={concept} onChange={e => setConcept(e.target.value)}
                placeholder="Ej: apoyo a venta" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <button onClick={() => {
              if (!storeNumber.trim() || !storeName.trim()) { toast.error("Completa todos los campos"); return; }
              const newDest: TransferDestination = {
                id: crypto.randomUUID(),
                store: { storeNumber: storeNumber.trim(), storeName: storeName.trim() },
                concept: concept.trim(),
                items: [], containers: [],
                status: TransferStatus.ACTIVA,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              const newStores = savedStores.some(s => s.storeNumber === storeNumber.trim())
                ? savedStores : [...savedStores, { storeNumber: storeNumber.trim(), storeName: storeName.trim() }];
              persist([newDest, ...destinations], history, newStores);
              setShowSetup(false);
              setStoreNumber(""); setStoreName(""); setConcept(""); setStoreSearch("");
              toast.success("Transferencia creada");
            }} className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700">
              Crear Transferencia
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Delete Confirmation ───────────────────────────────────────
  if (confirmDeleteId) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDeleteId(null)}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-black text-neutral-900 mb-2">¿Eliminar transferencia?</h2>
          <p className="text-sm text-neutral-500 mb-4">Esta acción no se puede deshacer.</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDeleteId(null)} className="flex-1 py-2.5 border border-neutral-200 rounded-xl text-sm font-bold">Cancelar</button>
            <button onClick={() => deleteDest(confirmDeleteId)} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700">Eliminar</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View ──────────────────────────────────────────────
  if (selectedDest) {
    return (
      <div className="max-w-full mx-auto px-4 pb-20">
        {/* Header */}
        <div className="flex items-center justify-between py-4 border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <button onClick={() => { saveDetail(); setSelectedDest(null); }} className="p-1 hover:bg-neutral-100 rounded-lg">
              <ArrowLeft size={20} className="text-neutral-500" />
            </button>
            <div>
              <h1 className="text-lg font-black text-neutral-900">
                {selectedDest.store.storeNumber} — {selectedDest.store.storeName}
              </h1>
              <p className="text-xs text-neutral-500">Concepto: {selectedDest.concept} · {items.length} productos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_COLORS[selectedDest.status]}`}>
              {STATUS_LABELS[selectedDest.status]}
            </span>
            <button onClick={() => setShowStatusPicker(selectedDest.id)}
              className="px-3 py-1.5 border border-neutral-200 rounded-xl text-xs font-bold hover:bg-neutral-50">
              Cambiar
            </button>
          </div>
        </div>

        {/* Save bar */}
        <div className="flex gap-2 mt-3">
          <button onClick={downloadCsv} className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700">
            <Download size={14} /> CSV
          </button>
          <button onClick={saveDetail} className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700">
            <Save size={14} /> Guardar
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 my-4 p-1 bg-neutral-100 rounded-xl">
          {(["scanner", "listado", "contenedores"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === tab ? "bg-white text-purple-700 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
              {tab === "scanner" ? <Camera size={14} /> : tab === "listado" ? <List size={14} /> : <Package size={14} />}
              {tab === "scanner" ? "Escáner" : tab === "listado" ? "Listado" : "Contenedores"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "scanner" && (
          <div>
            <div className="flex gap-3 mb-4">
              <button onClick={() => setShowManualEntry(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700">
                <Plus size={16} /> Agregar Manual
              </button>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-20 text-neutral-400">
                <Camera size={48} className="mx-auto mb-3" />
                <p className="font-bold">Agrega productos manualmente</p>
                <p className="text-sm">Usa el botón Manual para capturar cada producto</p>
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
                        {item.cantidad > 1 && <span>Cant: {item.cantidad}</span>}
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
                {(Object.entries(items.reduce((acc, item) => {
                  const k = item.modelo_grupo || "SIN MODELO";
                  (acc[k] = acc[k] || []).push(item);
                  return acc;
                }, {} as Record<string, TransferItem[]>)) as [string, TransferItem[]][]).map(([modelo, modelItems]) => (
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
                          {item.cantidad > 1 && <span className="text-xs text-purple-600 font-bold ml-2">x{item.cantidad}</span>}
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
            config={selectedDest.store}
            concept={selectedDest.concept}
            onAddContainer={name => setContainers(prev => prev.some(c => c.name === name) ? prev : [...prev, { id: crypto.randomUUID(), name }])}
            onRemoveContainer={id => setContainers(prev => prev.filter(c => c.id !== id))}
            onAssignItem={(itemId, containerId) => setItems(prev => prev.map(i => i.id === itemId ? { ...i, containerId } : i))}
            onUnassignItem={itemId => setItems(prev => prev.map(i => i.id === itemId ? { ...i, containerId: undefined } : i))}
          />
        )}
      </div>
    );
  }

  // ── Manual Entry Modal ──────────────────────────────────────
  if (showManualEntry) {
    return <ManualEntryModal onSave={addManualItem} onCancel={() => setShowManualEntry(false)} />;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MAIN LIST VIEW
  // ═══════════════════════════════════════════════════════════════
  const list = showHistory ? history : destinations;

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 py-6">
        <QrCode size={28} className="text-orange-600" />
        <div className="flex-1">
          <h1 className="text-xl font-black text-neutral-900">Transferencias</h1>
          <p className="text-xs text-neutral-500">{destinations.length} activa(s) · {history.length} historial</p>
        </div>
        <button onClick={() => { setStoreNumber(""); setStoreName(""); setConcept(""); setShowSetup(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700">
          <Plus size={16} /> Nueva
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowHistory(false)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${!showHistory ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
          Activas ({destinations.length})
        </button>
        <button onClick={() => setShowHistory(true)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${showHistory ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
          Historial ({history.length})
        </button>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-20 text-neutral-400">
          <Package size={48} className="mx-auto mb-3" />
          <p className="font-bold">{showHistory ? "No hay transferencias enviadas" : "No hay transferencias activas"}</p>
          <p className="text-sm">Crea una nueva con el botón +</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(dest => {
            const Icon = STATUS_ICONS[dest.status];
            return (
              <div key={dest.id} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0" onClick={() => !showHistory && openDest(dest)} style={{ cursor: showHistory ? "default" : "pointer" }}>
                    <h3 className="font-black text-neutral-900 text-base truncate">
                      {dest.store.storeNumber} — {dest.store.storeName}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">Concepto: {dest.concept}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400">
                      <span>{dest.items.length} productos</span>
                      <span>{new Date(dest.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    {!showHistory && (
                      <>
                        <button onClick={() => setShowStatusPicker(dest.id)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${STATUS_COLORS[dest.status]} hover:opacity-80 flex items-center gap-1`}>
                          <Icon size={12} /> {STATUS_LABELS[dest.status]}
                        </button>
                        <button onClick={() => setConfirmDeleteId(dest.id)}
                          className="p-1.5 text-neutral-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    {showHistory && (
                      <button onClick={() => deleteHistoryItem(dest.id)}
                        className="p-1.5 text-neutral-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {!showHistory && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-neutral-100">
                    <button onClick={() => openDest(dest)}
                      className="flex-1 py-2 bg-neutral-900 text-white rounded-xl text-xs font-bold hover:bg-neutral-800">
                      Abrir
                    </button>
                    <button onClick={() => setShowStatusPicker(dest.id)}
                      className="flex-1 py-2 border border-neutral-200 rounded-xl text-xs font-bold hover:bg-neutral-50">
                      Cambiar Estado
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MANUAL ENTRY MODAL
// ═══════════════════════════════════════════════════════════════════
function ManualEntryModal({ onSave, onCancel }: { onSave: (item: TransferItem) => void; onCancel: () => void }) {
  const [modelo, setModelo] = useState("");
  const [color, setColor] = useState("");
  const [talla, setTalla] = useState("");
  const [marca, setMarca] = useState("");
  const [sku, setSku] = useState("");
  const [cantidad, setCantidad] = useState(1);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-6">
          <Plus size={24} className="text-orange-600" />
          <h2 className="text-xl font-black text-neutral-900">Registro Manual</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-neutral-600 block mb-1">Modelo *</label>
            <input value={modelo} onChange={e => setModelo(e.target.value)}
              placeholder="Ej: ND5DJD5615" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Color</label>
              <input value={color} onChange={e => setColor(e.target.value)}
                placeholder="Ej: JBLK" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Talla</label>
              <input value={talla} onChange={e => setTalla(e.target.value)}
                placeholder="Ej: M" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">Marca</label>
              <input value={marca} onChange={e => setMarca(e.target.value)}
                placeholder="Ej: Nike" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-600 block mb-1">SKU</label>
              <input value={sku} onChange={e => setSku(e.target.value)}
                placeholder="Ej: 123456789012" className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-neutral-600 block mb-1">Cantidad</label>
            <input type="number" min={1} max={9999} value={cantidad} onChange={e => setCantidad(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onCancel} className="flex-1 py-2.5 border border-neutral-200 rounded-xl text-sm font-bold">Cancelar</button>
            <button onClick={() => {
              if (!modelo.trim()) { toast.error("El modelo es obligatorio"); return; }
              onSave({
                id: crypto.randomUUID(),
                modelo_grupo: modelo.trim().toUpperCase(),
                codigo_color: color.trim().toUpperCase() || undefined,
                talla: talla.trim().toUpperCase() || undefined,
                marca: marca.trim() || undefined,
                sku: sku.trim() || undefined,
                cantidad: cantidad,
              });
            }} className="flex-1 py-2.5 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700">
              Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CONTAINERS PANEL
// ═══════════════════════════════════════════════════════════════════
function ContainersPanel({
  items, containers, config, concept, onAddContainer, onRemoveContainer, onAssignItem, onUnassignItem,
}: {
  items: TransferItem[];
  containers: TransferContainer[];
  config: { storeNumber: string; storeName: string };
  concept: string;
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
<strong>Concepto:</strong> ${concept}<br>
<strong>Fecha:</strong> ${date}<br>
<strong>Total:</strong> ${items.length} productos · ${containers.length} contenedor(es)</p>
<hr>`;

    for (const container of containers) {
      const containerItems = items.filter(i => i.containerId === container.id);
      if (containerItems.length === 0) continue;
      html += `<h2>Contenedor: ${container.name}</h2>
<table><thead><tr><th>UPC</th><th>Modelo</th><th>Talla</th><th>Cant.</th><th>Código</th></tr></thead><tbody>`;
      for (const item of containerItems) {
        const mc = modeloCompuesto(item);
        html += `<tr><td>${item.sku || ""}</td><td>${mc}</td><td>${item.talla || ""}</td><td>${item.cantidad || 1}</td><td class="barcode">${item.sku || mc || "N/A"}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    if (unassigned.length > 0) {
      html += `<h2>Sin contenedor</h2>
<table><thead><tr><th>UPC</th><th>Modelo</th><th>Talla</th><th>Cant.</th></tr></thead><tbody>`;
      for (const item of unassigned) {
        const mc = modeloCompuesto(item);
        html += `<tr><td>${item.sku || ""}</td><td>${mc}</td><td>${item.talla || ""}</td><td>${item.cantidad || 1}</td></tr>`;
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
        <div>
          <p className="text-xs font-bold text-neutral-500">{containers.length} contenedor(es)</p>
          <p className="text-xs text-neutral-400">{unassigned.length} producto(s) sin asignar</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700">
            <Plus size={14} /> Contenedor
          </button>
          <button onClick={printReport} className="flex items-center gap-1 px-3 py-2 bg-neutral-900 text-white rounded-xl text-xs font-bold hover:bg-neutral-800">
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="flex gap-2 mb-4">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Nombre del contenedor" autoFocus
            className="flex-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
            onKeyDown={e => { if (e.key === "Enter" && newName.trim()) { onAddContainer(newName.trim()); setNewName(""); setShowCreate(false); } }} />
          <button onClick={() => { if (newName.trim()) { onAddContainer(newName.trim()); setNewName(""); setShowCreate(false); } }}
            className="px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold">Crear</button>
          <button onClick={() => setShowCreate(false)} className="px-3 py-2 border border-neutral-200 rounded-xl text-xs font-bold">Cancelar</button>
        </div>
      )}

      <div className="space-y-3">
        {containers.length === 0 && items.length > 0 && (
          <div className="p-4 bg-amber-50 rounded-xl text-sm text-amber-700 font-medium">
            Crea contenedores para organizar los productos y generar el PDF de transferencia.
          </div>
        )}

        {containers.map(container => {
          const containerItems = items.filter(i => i.containerId === container.id);
          return (
            <div key={container.id} className="bg-white rounded-xl border border-neutral-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-purple-600" />
                  <h3 className="font-bold text-sm text-neutral-900">{container.name}</h3>
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-bold">{containerItems.length}</span>
                </div>
                <button onClick={() => onRemoveContainer(container.id)}
                  className="p-1 text-neutral-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
              {containerItems.length === 0 ? (
                <p className="text-xs text-neutral-400 italic">Arrastra productos desde el listado</p>
              ) : (
                <div className="space-y-1">
                  {containerItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-2 py-1.5 bg-neutral-50 rounded-lg">
                      <div className="flex-1 text-xs">
                        <span className="font-bold">{modeloCompuesto(item)}</span>
                        {item.talla && <span className="text-neutral-500 ml-2">Talla: {item.talla}</span>}
                        {item.cantidad > 1 && <span className="text-purple-600 font-bold ml-2">x{item.cantidad}</span>}
                      </div>
                      <button onClick={() => onUnassignItem(item.id)}
                        className="text-neutral-400 hover:text-red-500"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setPickerContainer(pickerContainer === container.id ? null : container.id)}
                className="mt-2 text-xs font-bold text-purple-600 hover:text-purple-800">
                + Agregar productos
              </button>
              {pickerContainer === container.id && unassigned.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1 p-2 bg-neutral-50 rounded-lg">
                  {unassigned.map(item => (
                    <button key={item.id} onClick={() => { onAssignItem(item.id, container.id); setPickerContainer(null); }}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-purple-50 text-xs">
                      <span className="font-medium">{modeloCompuesto(item)}</span>
                      {item.talla && <span className="text-neutral-500 ml-2">Talla: {item.talla}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
