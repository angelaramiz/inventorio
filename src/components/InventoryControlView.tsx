import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ClipboardList, Calendar, Bell, ShieldCheck, User, CheckCircle2, 
  XCircle, Loader2, AlertCircle, FileText, Download, Scan, Plus, MapPin,
  RefreshCw, X, Camera, Power, ChevronDown, ChevronRight, Home, Network, Layers
} from "lucide-react";
import { toast } from "sonner";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

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

const parseRgba = (colorStr: string): [number, number, number, number] => {
  const str = colorStr.trim().toLowerCase();
  if (str === 'transparent') return [0, 0, 0, 0];
  if (str === 'white') return [255, 255, 255, 1];
  if (str === 'black') return [0, 0, 0, 1];
  
  const rgbMatch = str.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/i) ||
                   str.match(/rgba?\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*[\/,]\s*([0-9.]+))?\s*\)/i);
  if (rgbMatch) {
    return [
      parseFloat(rgbMatch[1]),
      parseFloat(rgbMatch[2]),
      parseFloat(rgbMatch[3]),
      rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1
    ];
  }
  
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        1
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        1
      ];
    }
    if (hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        parseInt(hex.slice(6, 8), 16) / 255
      ];
    }
  }
  
  return [0, 0, 0, 1];
};

const resolveColorMix = (colorMixStr: string): string => {
  try {
    const regex = /color-mix\(\s*in\s+srgb\s*,\s*([^,]+?)(?:\s+([0-9.]+)%)?\s*,\s*([^,)]+?)(?:\s+([0-9.]+)%)?\s*\)/gi;
    
    return colorMixStr.replace(regex, (match, color1Str, w1Str, color2Str, w2Str) => {
      const c1 = parseRgba(color1Str);
      const c2 = parseRgba(color2Str);
      
      let w1 = w1Str !== undefined ? parseFloat(w1Str) / 100 : null;
      let w2 = w2Str !== undefined ? parseFloat(w2Str) / 100 : null;
      
      if (w1 === null && w2 === null) {
        w1 = 0.5;
        w2 = 0.5;
      } else if (w1 !== null && w2 === null) {
        w2 = 1 - w1;
      } else if (w1 === null && w2 !== null) {
        w1 = 1 - w2;
      }
      
      const r = Math.round(c1[0] * w1 + c2[0] * w2);
      const g = Math.round(c1[1] * w1 + c2[1] * w2);
      const b = Math.round(c1[2] * w1 + c2[2] * w2);
      const a = c1[3] * w1 + c2[3] * w2;
      
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    });
  } catch (err) {
    console.error("Error resolving color-mix:", err);
    return colorMixStr;
  }
};

const oklabToRgbString = (L: number, a: number, b: number, alpha: number): string => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l_3 = l_ * l_ * l_;
  const m_3 = m_ * m_ * m_;
  const s_3 = s_ * s_ * s_;

  let rL = +4.0767416621 * l_3 - 3.3077115913 * m_3 + 0.2309699292 * s_3;
  let gL = -1.2684380046 * l_3 + 2.6097574011 * m_3 - 0.3413193965 * s_3;
  let bL = -0.0041960863 * l_3 - 0.7034186147 * m_3 + 1.7076147010 * s_3;

  const toSRGB = (c: number) => {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };

  const rVal = Math.round(toSRGB(rL) * 255);
  const gVal = Math.round(toSRGB(gL) * 255);
  const bVal = Math.round(toSRGB(bL) * 255);

  return `rgba(${rVal}, ${gVal}, ${bVal}, ${alpha})`;
};

const colorToRgb = (colorStr: string): string => {
  if (!colorStr || typeof colorStr !== 'string') return colorStr;
  
  let result = colorStr;
  
  if (result.includes('oklch')) {
    const oklchRegex = /oklch\(\s*([0-9.%]+)(?:\s+|\s*,\s*)([0-9.]+)(?:\s+|\s*,\s*)([0-9.]+)(?:\s*[\/,]\s*([0-9.]+))?\s*\)/gi;
    result = result.replace(oklchRegex, (match, p1, p2, p3, p4) => {
      try {
        let L = parseFloat(p1);
        if (p1.includes('%')) {
          L = parseFloat(p1) / 100;
        }
        const C = parseFloat(p2);
        const H = parseFloat(p3);
        const alpha = p4 !== undefined ? parseFloat(p4) : 1;

        const hRad = (H * Math.PI) / 180;
        const a = C * Math.cos(hRad);
        const b = C * Math.sin(hRad);

        return oklabToRgbString(L, a, b, alpha);
      } catch (e) {
        return match;
      }
    });
  }
  
  if (result.includes('oklab')) {
    const oklabRegex = /oklab\(\s*([0-9.%]+)(?:\s+|\s*,\s*)([-0-9.]+)(?:\s+|\s*,\s*)([-0-9.]+)(?:\s*[\/,]\s*([0-9.]+))?\s*\)/gi;
    result = result.replace(oklabRegex, (match, p1, p2, p3, p4) => {
      try {
        let L = parseFloat(p1);
        if (p1.includes('%')) {
          L = parseFloat(p1) / 100;
        }
        const a = parseFloat(p2);
        const b = parseFloat(p3);
        const alpha = p4 !== undefined ? parseFloat(p4) : 1;

        return oklabToRgbString(L, a, b, alpha);
      } catch (e) {
        return match;
      }
    });
  }

  if (result.includes('color-mix')) {
    result = resolveColorMix(result);
  }

  if (result.includes('color(')) {
    const colorRegex = /color\(\s*(?:srgb|display-p3)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)(?:\s*[\/,]\s*([0-9.]+))?\s*\)/gi;
    result = result.replace(colorRegex, (match, rStr, gStr, bStr, aStr) => {
      try {
        const r = Math.round(Math.max(0, Math.min(1, parseFloat(rStr))) * 255);
        const g = Math.round(Math.max(0, Math.min(1, parseFloat(gStr))) * 255);
        const b = Math.round(Math.max(0, Math.min(1, parseFloat(bStr))) * 255);
        const alpha = aStr !== undefined ? parseFloat(aStr) : 1;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      } catch (e) {
        return match;
      }
    });
  }

  if (result.includes('light-dark(')) {
    const lightDarkRegex = /light-dark\(\s*([^,]+)\s*,\s*([^)]+)\)/gi;
    result = result.replace(lightDarkRegex, (match, p1) => {
      return p1.trim();
    });
  }
  
  return result;
};

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
  const [countedQuantities, setCountedQuantities] = useState<Record<number, number | "">>({}); // id_producto -> qty
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
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const groupedReportTree = React.useMemo(() => {
    const tree: Record<string, {
      name: string;
      totalCantidad: number;
      pasillos: Record<string, {
        name: string;
        totalCantidad: number;
        secciones: Record<string, {
          name: string;
          totalCantidad: number;
          cajas: Record<string, {
            name: string;
            zona_id: number;
            totalCantidad: number;
            productos: Array<{
              id: number;
              sku: string;
              tipo: string;
              talla: string;
              cantidad: number;
            }>;
          }>;
        }>;
      }>;
    }> = {};

    reports.forEach((r) => {
      const box = zones.find(z => z.id_caja === r.zona_id);
      const almName = box?.almacen_nombre || "Sin Almacén";
      const pasName = box?.pasillo_nombre || "Sin Pasillo/Zona";
      const secName = box?.seccion_nombre || "Sin Sección";
      const boxName = box?.numero_caja || `Caja ${r.zona_id}`;
      
      const qty = r.cantidad_final || 0;

      if (!tree[almName]) {
        tree[almName] = { name: almName, totalCantidad: 0, pasillos: {} };
      }
      if (!tree[almName].pasillos[pasName]) {
        tree[almName].pasillos[pasName] = { name: pasName, totalCantidad: 0, secciones: {} };
      }
      if (!tree[almName].pasillos[pasName].secciones[secName]) {
        tree[almName].pasillos[pasName].secciones[secName] = { name: secName, totalCantidad: 0, cajas: {} };
      }
      if (!tree[almName].pasillos[pasName].secciones[secName].cajas[boxName]) {
        tree[almName].pasillos[pasName].secciones[secName].cajas[boxName] = {
          name: boxName,
          zona_id: r.zona_id,
          totalCantidad: 0,
          productos: []
        };
      }

      tree[almName].totalCantidad += qty;
      tree[almName].pasillos[pasName].totalCantidad += qty;
      tree[almName].pasillos[pasName].secciones[secName].totalCantidad += qty;
      tree[almName].pasillos[pasName].secciones[secName].cajas[boxName].totalCantidad += qty;
      
      tree[almName].pasillos[pasName].secciones[secName].cajas[boxName].productos.push({
        id: r.id,
        sku: r.productos?.sku || `Prod ID: ${r.producto_id}`,
        tipo: r.productos?.tipo || "Desconocido",
        talla: r.productos?.talla || "N/A",
        cantidad: qty
      });
    });

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    return Object.values(tree)
      .map(alm => ({
        ...alm,
        pasillos: Object.values(alm.pasillos)
          .map(pas => ({
            ...pas,
            secciones: Object.values(pas.secciones)
              .map(sec => ({
                ...sec,
                cajas: Object.values(sec.cajas)
                  .map(box => ({
                    ...box,
                    productos: box.productos.sort((a, b) => a.sku.localeCompare(b.sku))
                  })).sort((a, b) => collator.compare(a.name, b.name))
              })).sort((a, b) => collator.compare(a.name, b.name))
          })).sort((a, b) => collator.compare(a.name, b.name))
      })).sort((a, b) => collator.compare(a.name, b.name));
  }, [reports, zones]);

  const toggleNode = (nodeKey: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [nodeKey]: !prev[nodeKey]
    }));
  };

  const handleToggleAll = (expand: boolean) => {
    if (!expand) {
      setExpandedNodes({});
    } else {
      const newExpanded: Record<string, boolean> = {};
      groupedReportTree.forEach(alm => {
        newExpanded[alm.name] = true;
        alm.pasillos.forEach(pas => {
          const pasKey = `${alm.name} > ${pas.name}`;
          newExpanded[pasKey] = true;
          pas.secciones.forEach(sec => {
            const secKey = `${pasKey} > ${sec.name}`;
            newExpanded[secKey] = true;
            sec.cajas.forEach(box => {
              const boxKey = `${secKey} > ${box.name}`;
              newExpanded[boxKey] = true;
            });
          });
        });
      });
      setExpandedNodes(newExpanded);
    }
  };

  const handleDownloadPDF = async () => {
    setDownloadingPDF(true);
    toast.info("Generando archivo PDF para descarga...");
    
    const isDark = document.documentElement.classList.contains("dark");
    const originalStyles = document.documentElement.getAttribute("style");

    const originalGetComputedStyle = window.getComputedStyle;
    const originalDefaultViewGetComputedStyle = document.defaultView?.getComputedStyle;

    try {
      if (isDark) {
        document.documentElement.classList.remove("dark");
      }

      const hexVariables: Record<string, string> = {
        "--background": "#ffffff",
        "--foreground": "#252525",
        "--card": "#ffffff",
        "--card-foreground": "#252525",
        "--popover": "#ffffff",
        "--popover-foreground": "#252525",
        "--primary": "#333333",
        "--primary-foreground": "#fafafa",
        "--secondary": "#f5f5f5",
        "--secondary-foreground": "#333333",
        "--muted": "#f5f5f5",
        "--muted-foreground": "#8e8e8e",
        "--accent": "#f5f5f5",
        "--accent-foreground": "#333333",
        "--destructive": "#dc2626",
        "--border": "#ebebeb",
        "--input": "#ebebeb",
        "--ring": "#b5b5b5",
        "--chart-1": "#dfdfdf",
        "--chart-2": "#8e8e8e",
        "--chart-3": "#707070",
        "--chart-4": "#5e5e5e",
        "--chart-5": "#444444",
        "--sidebar": "#fafafa",
        "--sidebar-foreground": "#252525",
        "--sidebar-primary": "#333333",
        "--sidebar-primary-foreground": "#fafafa",
        "--sidebar-accent": "#f5f5f5",
        "--sidebar-accent-foreground": "#333333",
        "--sidebar-border": "#ebebeb",
        "--sidebar-ring": "#b5b5b5",
      };

      Object.entries(hexVariables).forEach(([key, val]) => {
        document.documentElement.style.setProperty(key, val, "important");
      });

      const customGetComputedStyle = function(el: Element, pseudoElt?: string) {
        const style = originalGetComputedStyle(el, pseudoElt);
        return new Proxy(style, {
          get(target, prop) {
            const hasOklchOrOklabOrMix = (v: any) => 
              typeof v === 'string' && (v.includes('oklch') || v.includes('oklab') || v.includes('color-mix') || v.includes('color(') || v.includes('light-dark('));

            if (prop === "getPropertyValue") {
              return function(propertyName: string) {
                const value = target.getPropertyValue(propertyName);
                if (hasOklchOrOklabOrMix(value)) {
                  return colorToRgb(value);
                }
                return value;
              };
            }
            
            const value = Reflect.get(target, prop);
            if (hasOklchOrOklabOrMix(value)) {
              return colorToRgb(value);
            }
            if (typeof value === 'function') {
              return value.bind(target);
            }
            return value;
          }
        }) as any;
      };

      window.getComputedStyle = customGetComputedStyle;
      if (document.defaultView) {
        document.defaultView.getComputedStyle = customGetComputedStyle;
      }

      const html2pdf = await new Promise<any>((resolve, reject) => {
        if ((window as any).html2pdf) {
          resolve((window as any).html2pdf);
          return;
        }
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
        script.onload = () => resolve((window as any).html2pdf);
        script.onerror = () => reject(new Error("No se pudo cargar el motor de PDF"));
        document.head.appendChild(script);
      });

      const element = document.getElementById("report-print-area");
      if (!element) throw new Error("Elemento de reporte no encontrado");

      element.classList.add("html2pdf-mode");

      const elementsWithStyle = element.querySelectorAll('[style]');
      const originalInlineStyles = new Map<Element, string | null>();
      
      elementsWithStyle.forEach((el: any) => {
        const styleAttr = el.getAttribute('style');
        originalInlineStyles.set(el, styleAttr);
        if (styleAttr && (styleAttr.includes('oklch') || styleAttr.includes('oklab') || styleAttr.includes('color-mix') || styleAttr.includes('color(') || styleAttr.includes('light-dark('))) {
          el.setAttribute('style', colorToRgb(styleAttr));
        }
      });

      const opt = {
        margin:       10,
        filename:     `reporte-consolidado-inventario-${new Date().toISOString().slice(0,10)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false, scrollY: 0, scrollX: 0 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['css', 'legacy'], avoid: ['tr'] }
      };

      await html2pdf().set(opt).from(element).save();

      originalInlineStyles.forEach((styleAttr, el) => {
        if (styleAttr === null) {
          el.removeAttribute('style');
        } else {
          el.setAttribute('style', styleAttr);
        }
      });

      element.classList.remove("html2pdf-mode");
      toast.success("Descarga iniciada");
    } catch (err: any) {
      console.error(err);
      toast.error("Error al generar PDF: " + err.message);
    } finally {
      window.getComputedStyle = originalGetComputedStyle;
      if (document.defaultView && originalDefaultViewGetComputedStyle) {
        document.defaultView.getComputedStyle = originalDefaultViewGetComputedStyle;
      }

      if (isDark) {
        document.documentElement.classList.add("dark");
      }
      if (originalStyles) {
        document.documentElement.setAttribute("style", originalStyles);
      } else {
        document.documentElement.removeAttribute("style");
      }
      setDownloadingPDF(false);
    }
  };

  // Selection options and states for manager scheduling
  const [almacenOptions, setAlmacenOptions] = useState<any[]>([]);
  const [pasilloOptions, setPasilloOptions] = useState<any[]>([]);
  const [seccionOptions, setSeccionOptions] = useState<any[]>([]);
  const [selectedAlmacenes, setSelectedAlmacenes] = useState<number[]>([]);
  const [selectedPasillos, setSelectedPasillos] = useState<number[]>([]);
  const [selectedSecciones, setSelectedSecciones] = useState<number[]>([]);

  const notificationsSSERef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchEvents();
    fetchZones(); // Always fetch zones/cajas for both roles to support count simulation
    if (userRole === "manager") {
      fetchCountRequests();
      fetchReports();
      setupNotificationsSSE();
      fetchManagerOptions();
      
      // Request browser notification permission
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

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

  const fetchManagerOptions = async () => {
    try {
      const [almacenesRes, pasillosRes, seccionesRes] = await Promise.all([
        fetch("/api/almacen/zonas"),
        fetch("/api/almacen/pasillos"),
        fetch("/api/almacen/secciones")
      ]);
      if (almacenesRes.ok) setAlmacenOptions(await almacenesRes.json());
      if (pasillosRes.ok) setPasilloOptions(await pasillosRes.json());
      if (seccionesRes.ok) setSeccionOptions(await seccionesRes.json());
    } catch (e) {
      console.error("Error loading event options:", e);
    }
  };

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

  const parsedEventConfig = (() => {
    if (!activeEvent || !activeEvent.descripcion) return null;
    try {
      const parsed = JSON.parse(activeEvent.descripcion);
      if (parsed && typeof parsed === "object" && "targets" in parsed) {
        return parsed;
      }
    } catch (e) {}
    return null;
  })();

  const eventDisplayName = parsedEventConfig ? parsedEventConfig.text : (activeEvent?.descripcion || "");

  const filteredSections = (() => {
    if (userRole === "operator" && parsedEventConfig && parsedEventConfig.targets) {
      const { almacenes, pasillos, secciones } = parsedEventConfig.targets;
      return sections.filter(s => {
        if (almacenes && almacenes.length > 0 && !almacenes.includes(s.id_zona_almacen)) return false;
        if (pasillos && pasillos.length > 0 && !pasillos.includes(s.id_zona_pasillo)) return false;
        if (secciones && secciones.length > 0 && !secciones.includes(s.id_zona_seccion)) return false;
        return true;
      });
    }
    return sections;
  })();

  const processScannedCode = (code: string) => {
    const sectionMatch = code.match(/^SEC-(\d+)$/i);
    if (sectionMatch) {
      const sectionId = parseInt(sectionMatch[1]);
      const sectionObj = filteredSections.find(s => s.id_zona_seccion === sectionId);
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
    const sectionObjByName = filteredSections.find(s => s.nombre.toLowerCase() === code.toLowerCase().trim());
    if (sectionObjByName) {
      setActiveSection(sectionObjByName);
      setSelectedZone(null); // Reset active box
      setBoxProducts([]);
      toast.success(`Sección escaneada: ${sectionObjByName.nombre.toUpperCase()}`);
      return;
    }

    // Otherwise, check if it's a box SKU or box number
    const boxObj = filteredZones.find(
      b => b.sku?.toLowerCase() === code.toLowerCase() || 
           b.numero_caja?.toLowerCase() === code.toLowerCase() ||
           b.numero_caja?.toLowerCase().includes(code.toLowerCase())
    );

    if (boxObj) {
      // Find the section this box belongs to
      const sectionObj = filteredSections.find(s => 
        s.id_zona_seccion === boxObj.id_zona_seccion ||
        (boxObj.seccion_nombre && s.nombre && s.nombre.toLowerCase() === boxObj.seccion_nombre.toLowerCase())
      );
      if (sectionObj) {
        setActiveSection(sectionObj);
      }
      handleSelectZone(boxObj);
      toast.success(`Caja escaneada y seleccionada: ${boxObj.numero_caja}`);
    } else {
      toast.error(`No se encontró caja o sección con código: "${code}"`);
    }
  };

  const startCameraScanner = async () => {
    try {
      setIsScannerActive(true);
      // Wait for DOM to update and render the #operator-reader element using waitForElement
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
        await waitForElement("operator-reader", 20, 50);
        let html5QrCode = scannerRef.current;
        if (!html5QrCode) {
          html5QrCode = new Html5Qrcode("operator-reader");
          scannerRef.current = html5QrCode;
        }

        if (html5QrCode.isScanning) {
          await html5QrCode.stop();
        }

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.EAN_13
            ]
          } as any,
          (decodedText) => {
            processScannedCode(decodedText);
            stopCameraScanner();
          },
          (errorMessage) => {}
        );
        toast.success("Cámara de escaneo activada");
      } catch (err: any) {
        console.error(err);
        toast.error("Error al acceder a la cámara o elemento no renderizado");
        setIsScannerActive(false);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Error al inicializar la cámara");
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

  const triggerNativeNotification = (title: string, options?: NotificationOptions) => {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, options);
      } catch (err) {
        console.error("Error launching native notification:", err);
      }
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
            triggerNativeNotification(`Operador Activo`, {
              body: `El operador ${data.operator_id} se ha activado en la zona ${data.zone_name}.`,
              icon: "/icons/icon-192.png"
            });
          } else if (data.tipo === "conteo_enviado") {
            toast.success(`📝 Nuevo conteo físico recibido de ${data.zone_name}`);
            triggerNativeNotification(`Nuevo Conteo Recibido`, {
              body: `Nuevo conteo físico enviado para la zona ${data.zone_name}.`,
              icon: "/icons/icon-192.png"
            });
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

    const eventPayload = {
      text: newEventDesc.trim(),
      targets: {
        almacenes: selectedAlmacenes,
        pasillos: selectedPasillos,
        secciones: selectedSecciones
      }
    };
    const serializedDesc = JSON.stringify(eventPayload);

    try {
      const resp = await fetch("/api/inventory/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: serializedDesc,
          fecha: newEventDate || null
        })
      });
      if (resp.ok) {
        toast.success("Evento de inventario programado");
        setNewEventDesc("");
        setNewEventDate("");
        setSelectedAlmacenes([]);
        setSelectedPasillos([]);
        setSelectedSecciones([]);
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
          const allProductsData = await prodResp.json();
          const allProducts = Array.isArray(allProductsData) ? allProductsData : [];
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

  const getTemporaryProductForLevel = (box: any) => {
    const levelName = (box.numero_caja || "").replace(/^NIVEL:\s*/i, "").trim();
    const sectionName = box.seccion_nombre || "SIN-SECCION";
    const cleanLevel = levelName.replace(/[\s_]+/g, "-");
    const cleanSection = sectionName.replace(/[\s_]+/g, "-");
    const sku = `TEMP-NV-${cleanSection}-${cleanLevel}`.toUpperCase();
    
    return {
      id_producto: -999,
      productos: {
        id_producto: -999,
        sku: sku,
        ean_13: "",
        talla: "UNICA",
        temporada: "todouso",
        tipo: "nivel",
        marca_sub: "TEMPORAL",
        has_foto: false
      },
      cantidad: box.total_unidades || 0
    };
  };

  // Operator: Select Zone/Box
  const handleSelectZone = async (box: any) => {
    setSelectedZone(box);
    setBoxProducts([]);
    setCountedQuantities({});
    setLoadingProducts(true);

    const zoneName = box.numero_caja.toUpperCase().startsWith("NIVEL:")
      ? `${box.numero_caja} (${box.almacen_nombre || "Sin almacén"})`
      : `Caja ${box.numero_caja} (${box.almacen_nombre || "Sin almacén"})`;

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
        
        if (box.numero_caja.toUpperCase().startsWith("NIVEL:") && data.length === 0) {
          const tempProduct = getTemporaryProductForLevel(box);
          setBoxProducts([tempProduct]);
          setCountedQuantities({ [tempProduct.id_producto]: 0 });
        } else {
          setBoxProducts(data);
          const initialCounts: Record<number, number> = {};
          data.forEach((item: any) => {
            initialCounts[item.id_producto] = 0;
          });
          setCountedQuantities(initialCounts);
        }
      } else {
        throw new Error("Failed to load products from network");
      }
    } catch (e) {
      // Graceful offline fallback
      let cachedBox = null;
      try {
        const { getHistory } = await import("../utils/db");
        const history = await getHistory();
        cachedBox = history.find((h: any) => h.id_caja === box.id_caja);
      } catch (err) {}

      if (cachedBox && cachedBox.productos && cachedBox.productos.length > 0) {
        setBoxProducts(cachedBox.productos);
        const initialCounts: Record<number, number> = {};
        cachedBox.productos.forEach((item: any) => {
          initialCounts[item.id_producto] = 0;
        });
        setCountedQuantities(initialCounts);
        toast.info("Cargado desde caché local offline");
      } else {
        if (box.numero_caja.toUpperCase().startsWith("NIVEL:")) {
          const tempProduct = getTemporaryProductForLevel(box);
          setBoxProducts([tempProduct]);
          setCountedQuantities({ [tempProduct.id_producto]: 0 });
          toast.warning("Modo offline: se creó un registro temporal para este nivel");
        } else {
          toast.error("Error de conexión y no hay datos offline para esta caja");
        }
      }
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
    const zoneName = selectedZone.numero_caja.toUpperCase().startsWith("NIVEL:")
      ? `${selectedZone.numero_caja} (${selectedZone.almacen_nombre || "Sin almacén"})`
      : `Caja ${selectedZone.numero_caja} (${selectedZone.almacen_nombre || "Sin almacén"})`;
    
    try {
      const finalQuantities: Record<number, number | any> = {};
      const tempSkus: Record<string, string> = {};

      for (const [key, val] of Object.entries(countedQuantities)) {
        const prodId = Number(key);
        const finalVal = val === "" ? 0 : (val as number);
        finalQuantities[prodId] = finalVal;
        
        if (prodId < 0) {
          const item = boxProducts.find(p => p.id_producto === prodId);
          if (item && item.productos && item.productos.sku) {
            tempSkus[key] = item.productos.sku;
          }
        }
      }

      if (Object.keys(tempSkus).length > 0) {
        (finalQuantities as any).temp_skus = tempSkus;
      }

      const resp = await fetch("/api/inventory/count-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: activeEvent.id,
          operator_id: operatorId,
          zone_id: selectedZone.id_caja,
          zone_name: zoneName,
          cantidades: finalQuantities
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
      // Offline Fetch fallback queueing
      try {
        const { offlineFetch } = await import("../utils/pwaDb");
        const finalQuantities: Record<number, number | any> = {};
        const tempSkus: Record<string, string> = {};

        for (const [key, val] of Object.entries(countedQuantities)) {
          const prodId = Number(key);
          const finalVal = val === "" ? 0 : (val as number);
          finalQuantities[prodId] = finalVal;
          
          if (prodId < 0) {
            const item = boxProducts.find(p => p.id_producto === prodId);
            if (item && item.productos && item.productos.sku) {
              tempSkus[key] = item.productos.sku;
            }
          }
        }

        if (Object.keys(tempSkus).length > 0) {
          (finalQuantities as any).temp_skus = tempSkus;
        }

        const resp = await offlineFetch("/api/inventory/count-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: activeEvent.id,
            operator_id: operatorId,
            zone_id: selectedZone.id_caja,
            zone_name: zoneName,
            cantidades: finalQuantities
          })
        });

        if (resp.ok) {
          setSelectedZone(null);
          setBoxProducts([]);
          setCountedQuantities({});
        }
      } catch (err) {
        toast.error("Error al guardar conteo en cola offline");
      }
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

  const filteredZones = (() => {
    let list = zones;
    if (userRole === "operator" && parsedEventConfig && parsedEventConfig.targets) {
      const { almacenes, pasillos, secciones } = parsedEventConfig.targets;
      list = list.filter(box => {
        if (almacenes && almacenes.length > 0 && !almacenes.includes(box.id_zona_almacen)) return false;
        if (pasillos && pasillos.length > 0 && !pasillos.includes(box.id_zona_pasillo)) return false;
        if (secciones && secciones.length > 0 && !secciones.includes(box.id_zona_seccion)) return false;
        return true;
      });
    }
    if (activeSection) {
      list = list.filter(box => 
        box.id_zona_seccion === activeSection.id_zona_seccion ||
        (box.seccion_nombre && activeSection.nombre && box.seccion_nombre.toLowerCase() === activeSection.nombre.toLowerCase())
      );
    }
    return list;
  })();

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
              {activeEvent && (
                <div className="mt-2.5 flex items-center gap-2 text-xs font-bold text-neutral-600 bg-neutral-100/75 py-1 px-2.5 rounded-full w-fit">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-550 animate-ping"></span>
                  <span>EVENTO: <span className="font-black uppercase text-neutral-950">{eventDisplayName}</span></span>
                </div>
              )}
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
                                <span>
                                  {box.numero_caja.toUpperCase().startsWith("NIVEL:") 
                                    ? box.numero_caja.toUpperCase() 
                                    : `CAJA: ${box.numero_caja}`}
                                </span>
                                <Badge className={`${selectedZone?.id_caja === box.id_caja ? "bg-amber-400 text-black border-none" : "bg-neutral-100 text-neutral-700"}`}>
                                  {userRole === "operator" ? "PENDIENTE" : box.estado.toUpperCase()}
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
                          {selectedZone.numero_caja.toUpperCase().startsWith("NIVEL:")
                            ? `Conteo en: ${selectedZone.numero_caja.replace("NIVEL:", "").trim()}`
                            : `Conteo en: Caja ${selectedZone.numero_caja}`}
                        </CardTitle>
                        <CardDescription className="text-neutral-400 font-bold text-xs uppercase pt-1">
                          📍 {selectedZone.almacen_nombre || "Sin ubicación"} {selectedZone.seccion_nombre ? `| ${selectedZone.seccion_nombre}` : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-6 space-y-6">
                        {/* System Quantity Banner for Level */}
                        {selectedZone.numero_caja.toUpperCase().startsWith("NIVEL:") && !loadingProducts && boxProducts.length > 0 && (
                          <div className="bg-neutral-50 border border-neutral-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                            <div className="space-y-1">
                              <p className="font-extrabold text-neutral-800 uppercase tracking-tight">
                                Resumen de Sistema para Nivel
                              </p>
                              <p className="text-neutral-550 font-semibold">
                                Actualmente hay registrados <span className="text-neutral-950 font-black">{boxProducts.reduce((sum, item) => sum + (item.cantidad || 0), 0)}</span> unidades de sistema en este nivel.
                              </p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button
                                size="sm"
                                onClick={() => {
                                  const confirmedCounts: Record<number, number> = {};
                                  boxProducts.forEach((item: any) => {
                                    confirmedCounts[item.id_producto] = item.cantidad || 0;
                                  });
                                  setCountedQuantities(confirmedCounts);
                                  toast.success("Cantidades del sistema aplicadas");
                                }}
                                className="bg-neutral-900 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider"
                              >
                                Confirmar Sistema
                              </Button>
                            </div>
                          </div>
                        )}

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
                                    <TableHead className="w-[160px] text-right">Cant. Física</TableHead>
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
                                          <TableCell className="text-right pr-4 py-2.5 w-[160px] shrink-0">
                                            <div className="flex items-center gap-1.5 justify-end">
                                              <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => {
                                                  const currentVal = countedQuantities[item.id_producto] ?? 0;
                                                  const newVal = Math.max(0, (currentVal === "" ? 0 : currentVal) - 1);
                                                  setCountedQuantities({
                                                    ...countedQuantities,
                                                    [item.id_producto]: newVal
                                                  });
                                                }}
                                                className="w-7 h-7 rounded-md border-neutral-200 hover:bg-neutral-50 shrink-0 font-bold text-xs"
                                              >
                                                -
                                              </Button>
                                              <Input 
                                                type="number"
                                                min={0}
                                                value={countedQuantities[item.id_producto] ?? 0}
                                                onChange={(e) => {
                                                  const val = e.target.value;
                                                  setCountedQuantities({
                                                    ...countedQuantities,
                                                    [item.id_producto]: val === "" ? "" : (parseInt(val) || 0)
                                                  });
                                                }}
                                                className="w-12 text-center font-black h-7 p-0 border-neutral-200 focus-visible:ring-neutral-400 rounded-md text-xs"
                                              />
                                              <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => {
                                                  const currentVal = countedQuantities[item.id_producto] ?? 0;
                                                  const newVal = (currentVal === "" ? 0 : currentVal) + 1;
                                                  setCountedQuantities({
                                                    ...countedQuantities,
                                                    [item.id_producto]: newVal
                                                  });
                                                }}
                                                className="w-7 h-7 rounded-md border-neutral-200 hover:bg-neutral-50 shrink-0 font-bold text-xs"
                                              >
                                                +
                                              </Button>
                                            </div>
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

          {activeEvent && (
            <Card className="border border-neutral-200 shadow-md rounded-3xl bg-white overflow-hidden p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="bg-emerald-100 text-emerald-800 font-black uppercase text-[9px] px-2.5 py-1 rounded-full w-fit flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Evento en Progreso
                </span>
                <h3 className="text-base font-black uppercase text-neutral-900 mt-1.5">{eventDisplayName}</h3>
                <p className="text-xs text-neutral-500 font-semibold">
                  Fecha límite: <span className="font-extrabold text-neutral-800">{activeEvent.fecha ? new Date(activeEvent.fecha).toLocaleDateString() : 'Sin fecha límite'}</span>
                </p>
              </div>
              <Button
                onClick={async () => {
                  if (window.confirm("¿Estás seguro de que deseas finalizar este evento de inventario? Esto impedirá que los operadores sigan enviando conteos.")) {
                    try {
                      const resp = await fetch(`/api/inventory/events/${activeEvent.id}/finalizar`, {
                        method: "POST"
                      });
                      if (resp.ok) {
                        toast.success("Evento de inventario finalizado con éxito.");
                        setActiveEvent(null);
                        fetchEvents();
                      } else {
                        toast.error("Error al finalizar el evento.");
                      }
                    } catch (e) {
                      toast.error("Error de conexión al finalizar el evento.");
                    }
                  }
                }}
                className="bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs uppercase px-5 py-2.5 h-11 shrink-0 shadow-md shadow-rose-600/10 border-none transition-all"
              >
                Finalizar Evento
              </Button>
            </Card>
          )}

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
                  <form onSubmit={handleCreateEvent} className="space-y-4">
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

                    {/* Almacenes Selection */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Almacenes (Zonas) a Contar</label>
                      <div className="border border-neutral-200 rounded-2xl p-2.5 max-h-36 overflow-y-auto space-y-1.5 text-xs bg-neutral-50/50 custom-scrollbar">
                        {almacenOptions.length === 0 ? (
                          <p className="text-neutral-400 text-center py-2 font-medium">Cargando almacenes...</p>
                        ) : (
                          almacenOptions.map(a => (
                            <label key={a.id_zona_almacen} className="flex items-center gap-2 cursor-pointer font-bold py-1 px-1.5 hover:bg-neutral-100 rounded-xl transition-all uppercase text-neutral-700">
                              <input 
                                type="checkbox"
                                checked={selectedAlmacenes.includes(a.id_zona_almacen)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedAlmacenes([...selectedAlmacenes, a.id_zona_almacen]);
                                  } else {
                                    setSelectedAlmacenes(selectedAlmacenes.filter(id => id !== a.id_zona_almacen));
                                  }
                                }}
                                className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-400 w-4 h-4"
                              />
                              <span>{a.nombre}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Pasillos Selection */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Pasillos / Zonas Intermedias</label>
                      <div className="border border-neutral-200 rounded-2xl p-2.5 max-h-36 overflow-y-auto space-y-1.5 text-xs bg-neutral-50/50 custom-scrollbar">
                        {pasilloOptions.length === 0 ? (
                          <p className="text-neutral-400 text-center py-2 font-medium">Cargando pasillos...</p>
                        ) : (
                          pasilloOptions.map(p => {
                            const parentAlm = p.zonas_almacen?.nombre || p.almacen_nombre || "General";
                            return (
                              <label key={p.id_zona_pasillo} className="flex items-center gap-2 cursor-pointer font-bold py-1 px-1.5 hover:bg-neutral-100 rounded-xl transition-all uppercase text-neutral-700">
                                <input 
                                  type="checkbox"
                                  checked={selectedPasillos.includes(p.id_zona_pasillo)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedPasillos([...selectedPasillos, p.id_zona_pasillo]);
                                    } else {
                                      setSelectedPasillos(selectedPasillos.filter(id => id !== p.id_zona_pasillo));
                                    }
                                  }}
                                  className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-400 w-4 h-4"
                                />
                                <span>{p.nombre} <span className="text-[10px] text-neutral-400 font-semibold lowercase">({parentAlm})</span></span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Secciones Selection */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Secciones Físicas</label>
                      <div className="border border-neutral-200 rounded-2xl p-2.5 max-h-36 overflow-y-auto space-y-1.5 text-xs bg-neutral-50/50 custom-scrollbar">
                        {seccionOptions.length === 0 ? (
                          <p className="text-neutral-400 text-center py-2 font-medium">Cargando secciones...</p>
                        ) : (
                          seccionOptions.map(s => {
                            const parentAlm = s.almacen_nombre || "General";
                            return (
                              <label key={s.id_zona_seccion} className="flex items-center gap-2 cursor-pointer font-bold py-1 px-1.5 hover:bg-neutral-100 rounded-xl transition-all uppercase text-neutral-700">
                                <input 
                                  type="checkbox"
                                  checked={selectedSecciones.includes(s.id_zona_seccion)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSecciones([...selectedSecciones, s.id_zona_seccion]);
                                    } else {
                                      setSelectedSecciones(selectedSecciones.filter(id => id !== s.id_zona_seccion));
                                    }
                                  }}
                                  className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-400 w-4 h-4"
                                />
                                <span>{s.nombre} <span className="text-[10px] text-neutral-400 font-semibold lowercase">({parentAlm})</span></span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      disabled={creatingEvent} 
                      className="w-full rounded-xl bg-neutral-900 text-white font-bold h-11 text-xs uppercase tracking-wider"
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
                            {Object.entries(req.cantidades)
                              .filter(([key]) => key !== "temp_skus")
                              .map(([prodId, qty]) => {
                                const tempSkus = (req.cantidades as any).temp_skus || {};
                                const displayName = Number(prodId) < 0 && tempSkus[prodId]
                                  ? tempSkus[prodId]
                                  : `Producto ID: ${prodId}`;
                                return (
                                  <div key={prodId} className="flex justify-between border-b last:border-0 pb-1 last:pb-0 mb-1 last:mb-0">
                                    <span className="font-mono">{displayName}</span>
                                    <span className="font-bold">{qty as any} unidades</span>
                                  </div>
                                );
                              })}
                          </div>

                          {req.estado === "pendiente" && (
                            <div className="flex flex-col sm:flex-row gap-2">
                              <Button
                                disabled={approvingRequestId === req.id}
                                onClick={() => handleApproval(req.id, "rechazado")}
                                className="w-full sm:flex-1 rounded-xl h-9 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs"
                              >
                                <XCircle size={14} className="mr-1" /> Rechazar
                              </Button>
                              <Button
                                disabled={approvingRequestId === req.id}
                                onClick={() => handleApproval(req.id, "aprobado")}
                                className="w-full sm:flex-1 rounded-xl h-9 bg-neutral-900 hover:bg-neutral-850 text-white font-bold text-xs"
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
                  <div className="flex flex-wrap gap-2 justify-between items-center">
                    <CardTitle className="text-sm font-bold flex items-center gap-1.5 uppercase text-neutral-800">
                      <FileText size={16} /> Reporte Consolidado de Inventario
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleDownloadPDF}
                        disabled={downloadingPDF || reports.length === 0}
                        className="h-8 rounded-xl text-xs bg-amber-400 text-neutral-950 hover:bg-amber-300 font-bold border-none"
                      >
                        {downloadingPDF ? (
                          <>
                            <Loader2 size={12} className="mr-1 animate-spin" /> Generando...
                          </>
                        ) : (
                          <>
                            <Download size={12} className="mr-1" /> Descargar PDF
                          </>
                        )}
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={fetchReports}
                        className="h-8 rounded-xl text-xs"
                      >
                        <RefreshCw size={12} className="mr-1" /> Recargar
                      </Button>
                    </div>
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
                      {/* Controls for Expand All / Collapse All */}
                      <div className="flex justify-between items-center gap-2 mb-2 no-print">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] rounded-lg px-2.5 font-bold"
                            onClick={() => handleToggleAll(true)}
                          >
                            Expandir Todo
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] rounded-lg px-2.5 font-bold"
                            onClick={() => handleToggleAll(false)}
                          >
                            Colapsar Todo
                          </Button>
                        </div>
                        <div className="text-[11px] text-neutral-400 font-bold uppercase">
                          Total Consolidado: <span className="text-neutral-900 font-black">{reports.reduce((sum, r) => sum + (r.cantidad_final || 0), 0)} uds</span>
                        </div>
                      </div>

                      <div className="border rounded-2xl overflow-hidden overflow-x-auto max-h-[500px] custom-scrollbar bg-white">
                        <Table>
                          <TableHeader className="bg-neutral-50 sticky top-0 z-10 shadow-sm">
                            <TableRow>
                              <TableHead className="font-extrabold text-neutral-800">Estructura / Prenda (SKU)</TableHead>
                              <TableHead className="font-extrabold text-neutral-800">Detalles</TableHead>
                              <TableHead className="font-extrabold text-neutral-800">Contenedor</TableHead>
                              <TableHead className="text-right font-extrabold text-neutral-800">Cantidad Final</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {groupedReportTree.map((alm) => {
                              const almKey = alm.name;
                              const almExpanded = !!expandedNodes[almKey];
                              return (
                                <React.Fragment key={almKey}>
                                  {/* Almacén Row */}
                                  <TableRow 
                                    className="bg-neutral-100/70 hover:bg-neutral-100 cursor-pointer font-bold select-none border-b"
                                    onClick={() => toggleNode(almKey)}
                                  >
                                    <TableCell className="py-2.5 font-black text-neutral-955 flex items-center gap-1.5 uppercase text-xs">
                                      {almExpanded ? <ChevronDown size={14} className="text-neutral-500 shrink-0" /> : <ChevronRight size={14} className="text-neutral-500 shrink-0" />}
                                      <Home size={13} className="text-neutral-600 shrink-0" /> Almacén: {alm.name}
                                    </TableCell>
                                    <TableCell className="py-2.5 text-[10px] uppercase text-neutral-400 font-bold">Almacén</TableCell>
                                    <TableCell className="py-2.5 text-[10px] text-neutral-400">-</TableCell>
                                    <TableCell className="py-2.5 text-right font-black text-xs text-neutral-950">
                                      {alm.totalCantidad} uds
                                    </TableCell>
                                  </TableRow>

                                  {almExpanded && alm.pasillos.map((pas) => {
                                    const pasKey = `${almKey} > ${pas.name}`;
                                    const pasExpanded = !!expandedNodes[pasKey];
                                    return (
                                      <React.Fragment key={pasKey}>
                                        {/* Pasillo Row */}
                                        <TableRow 
                                          className="bg-neutral-50/80 hover:bg-neutral-50 cursor-pointer font-semibold select-none border-b"
                                          onClick={() => toggleNode(pasKey)}
                                        >
                                          <TableCell className="py-2.5 pl-6 font-extrabold text-neutral-800 flex items-center gap-1.5 uppercase text-xs">
                                            {pasExpanded ? <ChevronDown size={14} className="text-neutral-400 shrink-0" /> : <ChevronRight size={14} className="text-neutral-400 shrink-0" />}
                                            <Network size={13} className="text-neutral-500 shrink-0" /> Pasillo: {pas.name}
                                          </TableCell>
                                          <TableCell className="py-2.5 text-[10px] uppercase text-neutral-400 font-bold">Pasillo/Zona</TableCell>
                                          <TableCell className="py-2.5 text-[10px] text-neutral-400">-</TableCell>
                                          <TableCell className="py-2.5 text-right font-bold text-xs text-neutral-800">
                                            {pas.totalCantidad} uds
                                          </TableCell>
                                        </TableRow>

                                        {pasExpanded && pas.secciones.map((sec) => {
                                          const secKey = `${pasKey} > ${sec.name}`;
                                          const secExpanded = !!expandedNodes[secKey];
                                          return (
                                            <React.Fragment key={secKey}>
                                              {/* Sección Row */}
                                              <TableRow 
                                                className="bg-white hover:bg-neutral-50/50 cursor-pointer select-none border-b"
                                                onClick={() => toggleNode(secKey)}
                                              >
                                                <TableCell className="py-2.5 pl-10 font-bold text-neutral-750 flex items-center gap-1.5 uppercase text-xs">
                                                  {secExpanded ? <ChevronDown size={14} className="text-neutral-400 shrink-0" /> : <ChevronRight size={14} className="text-neutral-400 shrink-0" />}
                                                  <MapPin size={13} className="text-neutral-500 shrink-0" /> Sección: {sec.name}
                                                </TableCell>
                                                <TableCell className="py-2.5 text-[10px] uppercase text-neutral-400 font-bold">Sección</TableCell>
                                                <TableCell className="py-2.5 text-[10px] text-neutral-400">-</TableCell>
                                                <TableCell className="py-2.5 text-right font-semibold text-xs text-neutral-700">
                                                  {sec.totalCantidad} uds
                                                </TableCell>
                                              </TableRow>

                                              {secExpanded && sec.cajas.map((box) => {
                                                const boxKey = `${secKey} > ${box.name}`;
                                                const boxExpanded = !!expandedNodes[boxKey];
                                                const isNivel = box.name.toUpperCase().startsWith("NIVEL:");
                                                return (
                                                  <React.Fragment key={boxKey}>
                                                    {/* Caja / Nivel Row */}
                                                    <TableRow 
                                                      className="bg-neutral-50/20 hover:bg-neutral-50/50 cursor-pointer select-none border-b"
                                                      onClick={() => toggleNode(boxKey)}
                                                    >
                                                      <TableCell className="py-2.5 pl-14 font-semibold text-neutral-700 flex items-center gap-1.5 uppercase text-[11px]">
                                                        {boxExpanded ? <ChevronDown size={12} className="text-neutral-400 shrink-0" /> : <ChevronRight size={12} className="text-neutral-400 shrink-0" />}
                                                        <Layers size={12} className="text-neutral-400 shrink-0" /> {box.name}
                                                      </TableCell>
                                                      <TableCell className="py-2.5 text-[9px] uppercase text-neutral-400 font-bold">
                                                        {isNivel ? "Nivel" : "Caja"}
                                                      </TableCell>
                                                      <TableCell className="py-2.5 font-mono text-[10px] text-neutral-500">
                                                        ID: {box.zona_id}
                                                      </TableCell>
                                                      <TableCell className="py-2.5 text-right font-bold text-[11px] text-neutral-600">
                                                        {box.totalCantidad} uds
                                                      </TableCell>
                                                    </TableRow>

                                                    {boxExpanded && box.productos.map((prod) => (
                                                      /* Product Row */
                                                      <TableRow key={prod.id} className="hover:bg-neutral-50/10 bg-neutral-50/5 border-b">
                                                        <TableCell className="py-2 pl-20 font-bold text-neutral-900 text-xs">
                                                          {prod.sku}
                                                        </TableCell>
                                                        <TableCell className="py-2 text-[10px] capitalize text-neutral-500 font-medium">
                                                          {prod.tipo} / {prod.talla}
                                                        </TableCell>
                                                        <TableCell className="py-2 font-semibold text-[10px] text-neutral-600">
                                                          {box.name}
                                                        </TableCell>
                                                        <TableCell className="py-2 text-right font-black text-xs text-emerald-600">
                                                          {prod.cantidad} uds
                                                        </TableCell>
                                                      </TableRow>
                                                    ))}
                                                  </React.Fragment>
                                                );
                                              })}
                                            </React.Fragment>
                                          );
                                        })}
                                      </React.Fragment>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
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

      {/* Hidden print area for pdf generation */}
      <div id="report-print-area" className="p-8 bg-white">
        <style dangerouslySetInnerHTML={{ __html: `
          #report-print-area:not(.html2pdf-mode) {
            display: none !important;
          }
          .html2pdf-mode .no-print {
            display: none !important;
          }
          .html2pdf-mode {
            display: block !important;
            background-color: white !important;
            color: black !important;
          }
          .html2pdf-mode * {
            color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
          .html2pdf-mode .bg-neutral-900 {
            background-color: #171717 !important;
            color: white !important;
          }
          .html2pdf-mode table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .html2pdf-mode th, .html2pdf-mode td {
            border-bottom: 1px solid #e5e7eb !important;
            padding: 8px 12px !important;
          }
          .html2pdf-mode tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .page-break {
            page-break-inside: auto !important;
            break-inside: auto !important;
          }
        `}} />

        {/* Premium Corporate Header */}
        <div className="mb-8 border-b-2 border-neutral-900 pb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950 uppercase leading-none">
                REPORTE CONSOLIDADO DE INVENTARIO
              </h1>
              <p className="text-sm font-black text-amber-600 tracking-widest uppercase mt-2">
                MODO DETALLADO (CONTEOS FÍSICOS APROBADOS)
              </p>
            </div>
            <div className="text-right">
              <span className="px-3.5 py-1.5 bg-neutral-900 text-white rounded-xl text-[10px] font-black tracking-widest uppercase">
                REPORTE OFICIAL
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-4 border-t border-dashed border-neutral-200 text-xs">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Fecha de Emisión</p>
              <p className="font-extrabold text-neutral-800">{new Date().toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Total del Inventario</p>
              <p className="font-black text-amber-600 text-sm leading-none mt-1">
                {reports.reduce((sum, r) => sum + (r.cantidad_final || 0), 0)} UNIDADES
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Tipo Reporte</p>
              <p className="font-extrabold text-neutral-800 uppercase">Consolidado Físico</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Ubicaciones</p>
              <p className="font-bold text-neutral-600 uppercase truncate">TODAS</p>
            </div>
          </div>
        </div>

        {groupedReportTree.length === 0 ? (
          <div className="text-center py-16 text-neutral-400">
            <p className="text-sm font-bold">No se encontraron datos de reportes</p>
          </div>
        ) : (
          groupedReportTree.map((zone) => (
            <div key={zone.name} className="mb-8 last:mb-0 border-b pb-8 last:border-b-0 page-break">
              {/* Zone Header */}
              <div className="bg-neutral-900 text-white px-5 py-3.5 rounded-2xl flex items-center gap-2 mb-4">
                <Home size={18} />
                <h3 className="font-black text-sm uppercase tracking-wider">
                  ALMACÉN: {zone.name.toUpperCase()}
                </h3>
              </div>

              {zone.pasillos.map((pas: any) => (
                <div key={pas.name} className="ml-4 mb-6">
                  <div className="flex items-center gap-2 mb-3 border-l-4 border-neutral-400 pl-3 py-0.5">
                    <Network size={14} className="text-neutral-500" />
                    <h4 className="font-bold text-xs uppercase tracking-wide text-neutral-600">
                      PASILLO/ZONA: {pas.name.toUpperCase()}
                    </h4>
                  </div>

                  <div className="ml-4">
                    {pas.secciones.map((sec: any) => (
                      <div key={sec.name} className="mb-6 last:mb-0">
                        <div className="flex items-center gap-2 mb-3 border-l-4 border-neutral-700 pl-3 py-0.5">
                          <MapPin size={14} className="text-neutral-700" />
                          <h4 className="font-extrabold text-xs uppercase tracking-wide text-neutral-800">
                            SECCIÓN: {sec.name.toUpperCase()}
                          </h4>
                        </div>

                        <div className="ml-4">
                          {sec.cajas.map((box: any) => {
                            return (
                              <div key={box.name} className="border rounded-2xl p-5 bg-white shadow-sm mb-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-2 border-b">
                                  <div className="flex items-center gap-2">
                                    <span className="font-black text-xs bg-neutral-100 text-neutral-900 px-3 py-1 rounded-lg">
                                      {box.name.toUpperCase()} (ID: {box.zona_id})
                                    </span>
                                  </div>
                                  <span className="font-mono text-xs text-neutral-500 font-bold">
                                    Total Contenedor: {box.totalCantidad} Uds
                                  </span>
                                </div>

                                <div className="overflow-x-auto">
                                  <table className="text-xs w-full">
                                    <thead>
                                      <tr className="bg-neutral-50">
                                        <th className="font-bold text-neutral-800 text-left">Producto (SKU)</th>
                                        <th className="font-bold text-neutral-800 text-left">Detalles</th>
                                        <th className="text-right font-bold text-neutral-800">Cantidad Final</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {box.productos.map((item: any) => (
                                        <tr key={item.id} className="hover:bg-neutral-55">
                                          <td className="font-bold text-neutral-900 py-3">
                                            {item.sku}
                                          </td>
                                          <td className="py-3">
                                            <div className="flex gap-1.5 flex-wrap">
                                              <span className="px-2 py-0.5 bg-neutral-100 rounded-lg text-[9px] uppercase font-bold text-neutral-600">
                                                {item.tipo}
                                              </span>
                                              <span className="px-2 py-0.5 bg-neutral-100 rounded-lg text-[9px] uppercase font-bold text-neutral-600">
                                                Talla {item.talla}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="text-right font-black text-sm pr-6 py-3 text-emerald-600">
                                            {item.cantidad} uds
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
