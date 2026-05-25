import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import JsBarcode from "jsbarcode";
import { 
  Plus, Edit2, Trash2, Home, MapPin, 
  Loader2, Check, X, AlertTriangle, FileText, Printer, Download,
  Network
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";

interface WarehouseZone {
  id_zona_almacen: number;
  nombre: string;
}

interface SectionZone {
  id_zona_seccion: number;
  nombre: string;
  id_zona_almacen: number;
  almacen_nombre: string;
}

// EAN-13 Barcode generator in SVG (Zero dependencies)
const EAN13Barcode = ({ code }: { code: string }) => {
  // Validate EAN-13 code (strictly 13 digits)
  if (!code || !/^\d{13}$/.test(code)) {
    return <span className="text-red-500 font-mono text-xs">EAN-13 inválido ({code})</span>;
  }
  
  // Parity patterns for L (0) and G (1) depending on first digit
  const parityPatterns = [
    [0,0,0,0,0,0], // 0
    [0,0,1,0,1,1], // 1
    [0,0,1,1,0,1], // 2
    [0,0,1,1,1,0], // 3
    [0,1,0,0,1,1], // 4
    [0,1,1,0,0,1], // 5
    [0,1,1,1,0,0], // 6
    [0,1,0,1,0,1], // 7
    [0,1,0,1,1,0], // 8
    [0,1,1,0,1,0]  // 9
  ];

  const L = [
    "0001101", "0011001", "0010011", "0111101", "0100011",
    "0110001", "0101111", "0111011", "0110111", "0001011"
  ];
  const G = [
    "0100111", "0110011", "0011011", "0100001", "0011101",
    "0111001", "0000101", "0010001", "0001001", "0010111"
  ];
  const R = [
    "1110010", "1100110", "1101100", "1000010", "1011100",
    "1001110", "1010000", "1000100", "1001000", "1110100"
  ];

  const firstDigit = parseInt(code[0]);
  const leftPattern = parityPatterns[firstDigit];

  let binary = "101"; // Left guard

  // Left 6 digits
  for (let i = 1; i <= 6; i++) {
    const digit = parseInt(code[i]);
    const isG = leftPattern[i - 1] === 1;
    binary += isG ? G[digit] : L[digit];
  }

  binary += "01010"; // Center guard

  // Right 6 digits
  for (let i = 7; i <= 12; i++) {
    const digit = parseInt(code[i]);
    binary += R[digit];
  }

  binary += "101"; // Right guard

  // Render SVG barcode
  const barWidth = 1.6;
  const barHeight = 35;
  const totalWidth = binary.length * barWidth;

  return (
    <div className="flex flex-col items-center select-none py-1">
      <svg width={totalWidth} height={barHeight + 12} viewBox={`0 0 ${totalWidth} ${barHeight + 12}`}>
        <g fill="black">
          {binary.split("").map((bit, idx) => (
            bit === "1" ? (
              <rect
                key={idx}
                x={idx * barWidth}
                y={0}
                width={barWidth}
                height={barHeight}
              />
            ) : null
          ))}
        </g>
        <text
          x={totalWidth / 2}
          y={barHeight + 10}
          textAnchor="middle"
          fontSize="9"
          fontFamily="monospace"
          fontWeight="black"
          fill="black"
        >
          {code}
        </text>
      </svg>
    </div>
  );
};

export default function AlmacenView() {
  const [activeTab, setActiveTab] = useState<"zonas" | "secciones" | "inventario">("zonas");
  
  // Tag states for new section
  const [newSectionTipo, setNewSectionTipo] = useState<string>("todos");
  const [newSectionGenero, setNewSectionGenero] = useState<string>("todos");
  const [newSectionMarca, setNewSectionMarca] = useState<string>("todos");
  
  const [activeBarcodeSection, setActiveBarcodeSection] = useState<any | null>(null);
  
  // Data lists
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [sections, setSections] = useState<SectionZone[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);
  
  // Report states
  const [selectedReportZoneId, setSelectedReportZoneId] = useState("all");
  const [selectedReportSectionId, setSelectedReportSectionId] = useState("all");
  const [selectedReportBoxId, setSelectedReportBoxId] = useState("all");
  const [reportData, setReportData] = useState<any[]>([]);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [downloadingPDF, setDownloadingPDF] = useState(false);

  // Loading states
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingSections, setLoadingSections] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Form states - Add Zone
  const [newZoneName, setNewZoneName] = useState("");
  
  // Form states - Add Section
  const [newSectionName, setNewSectionName] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState("");

  // Editing states
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [editingZoneName, setEditingZoneName] = useState("");
  
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");
  const [editingSectionZoneId, setEditingSectionZoneId] = useState("");

  useEffect(() => {
    fetchZones();
    fetchSections();
    fetchBoxes();
  }, []);

  useEffect(() => {
    if (activeBarcodeSection) {
      const timer = setTimeout(() => {
        try {
          const element = document.getElementById("section-barcode-svg");
          if (element) {
            JsBarcode(element, `SEC-${activeBarcodeSection.id_zona_seccion}`, {
              format: "CODE128",
              lineColor: "#000",
              width: 2.2,
              height: 60,
              displayValue: false
            });
          }
        } catch (err) {
          console.error("Error generating section barcode:", err);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeBarcodeSection]);

  const fetchBoxes = async () => {
    try {
      const resp = await fetch("/api/cajas");
      if (resp.ok) {
        const data = await resp.json();
        setBoxes(data);
      }
    } catch (e) {
      console.error("Error fetching boxes:", e);
    }
  };

  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    try {
      const resp = await fetch("/api/reporte-inventario");
      if (resp.ok) {
        const data = await resp.json();
        setReportData(data);
        setShowPreview(true);
        toast.success("Vista previa del reporte generada");
      } else {
        toast.error("Error al obtener los datos del reporte");
      }
    } catch (e) {
      toast.error("Error de conexión al generar reporte");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const generateGroupedReportData = () => {
    let filteredZones = zones;
    if (selectedReportZoneId !== "all") {
      filteredZones = zones.filter(z => z.id_zona_almacen === parseInt(selectedReportZoneId));
    }

    const result: any[] = [];

    for (const zone of filteredZones) {
      let zoneSections = sections.filter(s => s.id_zona_almacen === zone.id_zona_almacen);
      if (selectedReportSectionId !== "all") {
        zoneSections = zoneSections.filter(s => s.id_zona_seccion === parseInt(selectedReportSectionId));
      }

      const sectionGroup: any[] = [];

      // Check direct boxes for this zone (boxes without a section)
      let directBoxes: any[] = [];
      if (selectedReportSectionId === "all") {
        directBoxes = boxes.filter(b => b.id_zona_almacen === zone.id_zona_almacen && !b.id_zona_seccion);
        if (selectedReportBoxId !== "all") {
          directBoxes = directBoxes.filter(b => b.id_caja === parseInt(selectedReportBoxId));
        }
      }

      for (const section of zoneSections) {
        let sectionBoxes = boxes.filter(b => b.id_zona_seccion === section.id_zona_seccion);
        if (selectedReportBoxId !== "all") {
          sectionBoxes = sectionBoxes.filter(b => b.id_caja === parseInt(selectedReportBoxId));
        }

        const boxGroup: any[] = [];
        for (const box of sectionBoxes) {
          const boxItems = reportData.filter(item => item.id_caja === box.id_caja);
          boxGroup.push({
            ...box,
            productos: boxItems
          });
        }

        if (boxGroup.length > 0 || selectedReportBoxId === "all") {
          sectionGroup.push({
            ...section,
            cajas: boxGroup
          });
        }
      }

      const directBoxGroup: any[] = [];
      for (const box of directBoxes) {
        const boxItems = reportData.filter(item => item.id_caja === box.id_caja);
        directBoxGroup.push({
          ...box,
          productos: boxItems
        });
      }

      if (directBoxGroup.length > 0) {
        sectionGroup.push({
          id_zona_seccion: 0,
          nombre: "Sin sección específica",
          id_zona_almacen: zone.id_zona_almacen,
          almacen_nombre: zone.nombre,
          cajas: directBoxGroup
        });
      }

      if (sectionGroup.length > 0) {
        result.push({
          ...zone,
          secciones: sectionGroup
        });
      }
    }

    return result;
  };

  const parseRgba = (colorStr: string): [number, number, number, number] => {
    const str = colorStr.trim().toLowerCase();
    if (str === 'transparent') return [0, 0, 0, 0];
    if (str === 'white') return [255, 255, 255, 1];
    if (str === 'black') return [0, 0, 0, 1];
    
    // rgb/rgba
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
    
    // Hex
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
    // Convert OKLab to LMS
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l_3 = l_ * l_ * l_;
    const m_3 = m_ * m_ * m_;
    const s_3 = s_ * s_ * s_;

    // Convert LMS to Linear RGB
    let rL = +4.0767416621 * l_3 - 3.3077115913 * m_3 + 0.2309699292 * s_3;
    let gL = -1.2684380046 * l_3 + 2.6097574011 * m_3 - 0.3413193965 * s_3;
    let bL = -0.0041960863 * l_3 - 0.7034186147 * m_3 + 1.7076147010 * s_3;

    // Helper to convert linear color channel to sRGB
    const toSRGB = (c: number) => {
      c = Math.max(0, Math.min(1, c)); // clamp
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
    
    // Replace all oklch occurrences
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

          // Convert OKLCH to OKLab
          const hRad = (H * Math.PI) / 180;
          const a = C * Math.cos(hRad);
          const b = C * Math.sin(hRad);

          return oklabToRgbString(L, a, b, alpha);
        } catch (e) {
          return match;
        }
      });
    }
    
    // Replace all oklab occurrences
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

    // Replace all color-mix occurrences
    if (result.includes('color-mix')) {
      result = resolveColorMix(result);
    }

    // Replace color(srgb/display-p3 R G B / A)
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

    // Replace light-dark(color1, color2) -> return color1 (light)
    if (result.includes('light-dark(')) {
      const lightDarkRegex = /light-dark\(\s*([^,]+)\s*,\s*([^)]+)\)/gi;
      result = result.replace(lightDarkRegex, (match, p1) => {
        return p1.trim();
      });
    }
    
    return result;
  };

  const handleDownloadPDF = async () => {
    setDownloadingPDF(true);
    toast.info("Generando archivo PDF para descarga...");
    
    const isDark = document.documentElement.classList.contains("dark");
    const originalStyles = document.documentElement.getAttribute("style");

    // Backup original window / defaultView getComputedStyle methods
    const originalGetComputedStyle = window.getComputedStyle;
    const originalDefaultViewGetComputedStyle = document.defaultView?.getComputedStyle;

    try {
      // 1. Remove dark class if active
      if (isDark) {
        document.documentElement.classList.remove("dark");
      }

      // 2. Set HEX color variables on documentElement to override oklch
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

      // 3. Override window / defaultView getComputedStyle methods using a Proxy
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

      // Temporarily add a class to force light styling during html2pdf snapshotting
      element.classList.add("html2pdf-mode");

      // 4. Temporarily sanitize and replace inline oklch/oklab/color-mix styles inside print area
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
        filename:     `reporte-inventario-${new Date().toISOString().slice(0,10)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['css', 'legacy'], avoid: ['tr'] }
      };

      await html2pdf().set(opt).from(element).save();

      // Restore original inline styles
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
      // Restore original getComputedStyle methods
      window.getComputedStyle = originalGetComputedStyle;
      if (document.defaultView && originalDefaultViewGetComputedStyle) {
        document.defaultView.getComputedStyle = originalDefaultViewGetComputedStyle;
      }

      // Restore dark mode if it was active
      if (isDark) {
        document.documentElement.classList.add("dark");
      }
      // Restore inline styles
      if (originalStyles) {
        document.documentElement.setAttribute("style", originalStyles);
      } else {
        document.documentElement.removeAttribute("style");
      }
      setDownloadingPDF(false);
    }
  };

  const fetchZones = async () => {
    setLoadingZones(true);
    try {
      const resp = await fetch("/api/almacen/zonas");
      if (resp.ok) {
        const data = await resp.json();
        setZones(data);
      } else {
        toast.error("Error al cargar zonas de almacén");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setLoadingZones(false);
    }
  };

  const fetchSections = async () => {
    setLoadingSections(true);
    try {
      const resp = await fetch("/api/almacen/secciones");
      if (resp.ok) {
        const data = await resp.json();
        setSections(data);
      } else {
        toast.error("Error al cargar secciones de almacén");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setLoadingSections(false);
    }
  };

  // Add Zone
  const handleAddZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneName.trim()) return;
    setSubmitting(true);
    try {
      const resp = await fetch("/api/almacen/zonas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: newZoneName })
      });
      if (resp.ok) {
        toast.success("Zona de almacén agregada");
        setNewZoneName("");
        fetchZones();
      } else {
        const err = await resp.json();
        toast.error(err.error || "No se pudo agregar la zona");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  // Add Section
  const handleAddSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim() || !selectedZoneId) return;
    setSubmitting(true);
    try {
      const resp = await fetch("/api/almacen/secciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          nombre: newSectionName, 
          id_zona_almacen: parseInt(selectedZoneId),
          tags: {
            tipo_producto: newSectionTipo,
            genero: newSectionGenero,
            marca: newSectionMarca
          }
        })
      });
      if (resp.ok) {
        toast.success("Sección agregada y asociada");
        setNewSectionName("");
        setSelectedZoneId("");
        setNewSectionTipo("todos");
        setNewSectionGenero("todos");
        setNewSectionMarca("todos");
        fetchSections();
      } else {
        const err = await resp.json();
        toast.error(err.error || "No se pudo agregar la sección");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Zone
  const handleDeleteZone = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta zona? Se eliminarán todas las secciones asociadas.")) return;
    try {
      const resp = await fetch(`/api/almacen/zonas/${id}`, { method: "DELETE" });
      if (resp.ok) {
        toast.success("Zona eliminada con éxito");
        fetchZones();
        fetchSections(); // Sections will be cascades-deleted
      } else {
        toast.error("Error al eliminar la zona");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  // Delete Section
  const handleDeleteSection = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta sección? Las cajas asociadas quedarán sin sección.")) return;
    try {
      const resp = await fetch(`/api/almacen/secciones/${id}`, { method: "DELETE" });
      if (resp.ok) {
        toast.success("Sección eliminada con éxito");
        fetchSections();
      } else {
        toast.error("Error al eliminar la sección");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  // Edit Zone Inline
  const startEditZone = (zone: WarehouseZone) => {
    setEditingZoneId(zone.id_zona_almacen);
    setEditingZoneName(zone.nombre);
  };

  const handleUpdateZone = async (id: number) => {
    if (!editingZoneName.trim()) return;
    try {
      const resp = await fetch(`/api/almacen/zonas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: editingZoneName })
      });
      if (resp.ok) {
        toast.success("Zona actualizada");
        setEditingZoneId(null);
        fetchZones();
        fetchSections(); // Update section tables which display zone names
      } else {
        toast.error("Error al actualizar la zona");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  // Edit Section Inline
  const startEditSection = (section: SectionZone) => {
    setEditingSectionId(section.id_zona_seccion);
    setEditingSectionName(section.nombre);
    setEditingSectionZoneId(section.id_zona_almacen.toString());
  };

  const handleUpdateSection = async (id: number) => {
    if (!editingSectionName.trim() || !editingSectionZoneId) return;
    try {
      const resp = await fetch(`/api/almacen/secciones/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          nombre: editingSectionName, 
          id_zona_almacen: parseInt(editingSectionZoneId) 
        })
      });
      if (resp.ok) {
        toast.success("Sección actualizada");
        setEditingSectionId(null);
        fetchSections();
      } else {
        toast.error("Error al actualizar la sección");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Switcher & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl shadow-sm border border-neutral-100">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight uppercase text-neutral-900 leading-none">ALMACÉN</h2>
          <p className="text-xs md:text-sm text-neutral-500 font-medium mt-1">Administra la distribución física de cajas en el inventario</p>
        </div>
        
        <div className="flex bg-neutral-100 p-1.5 rounded-2xl border">
          <button
            onClick={() => setActiveTab("zonas")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === "zonas" 
                ? "bg-white text-neutral-950 shadow-md" 
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Home size={14} />
            Zonas de Almacén
          </button>
          <button
            onClick={() => setActiveTab("secciones")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === "secciones" 
                ? "bg-white text-neutral-950 shadow-md" 
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <MapPin size={14} />
            Secciones
          </button>
          <button
            onClick={() => {
              setActiveTab("inventario");
              fetchBoxes();
              setShowPreview(false);
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === "inventario" 
                ? "bg-white text-neutral-950 shadow-md" 
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <FileText size={14} />
            Inventario (Reporte)
          </button>
        </div>
      </div>

      {activeTab === "inventario" ? (
        <div className="space-y-6">
          <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="bg-neutral-50/50 pb-4 border-b">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <FileText size={18} className="text-neutral-600" />
                Reporte de Inventario Físico
              </CardTitle>
              <CardDescription>Genera una vista estructurada y descarga el PDF con códigos de barras de los productos</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                {/* Selector Almacen */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Filtrar por Almacén</label>
                  <select
                    value={selectedReportZoneId}
                    onChange={(e) => {
                      setSelectedReportZoneId(e.target.value);
                      setSelectedReportSectionId("all");
                      setSelectedReportBoxId("all");
                      setShowPreview(false);
                    }}
                    className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                  >
                    <option value="all">TODOS LOS ALMACENES</option>
                    {zones.map((z) => (
                      <option key={z.id_zona_almacen} value={z.id_zona_almacen}>
                        {z.nombre.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Selector Sección */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Filtrar por Sección</label>
                  <select
                    value={selectedReportSectionId}
                    onChange={(e) => {
                      setSelectedReportSectionId(e.target.value);
                      setSelectedReportBoxId("all");
                      setShowPreview(false);
                    }}
                    disabled={selectedReportZoneId === "all"}
                    className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900 disabled:opacity-50"
                  >
                    <option value="all">TODAS LAS SECCIONES</option>
                    {sections
                      .filter((s) => s.id_zona_almacen === parseInt(selectedReportZoneId))
                      .map((s) => (
                        <option key={s.id_zona_seccion} value={s.id_zona_seccion}>
                          {s.nombre.toUpperCase()}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Selector Caja */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Filtrar por Caja</label>
                  <select
                    value={selectedReportBoxId}
                    onChange={(e) => {
                      setSelectedReportBoxId(e.target.value);
                      setShowPreview(false);
                    }}
                    className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                  >
                    <option value="all">TODAS LAS CAJAS</option>
                    {boxes
                      .filter((b) => {
                        if (selectedReportZoneId !== "all") {
                          if (selectedReportSectionId !== "all") {
                            return b.id_zona_seccion === parseInt(selectedReportSectionId);
                          } else {
                            if (b.id_zona_seccion) {
                              const sec = sections.find((s) => s.id_zona_seccion === b.id_zona_seccion);
                              return sec && sec.id_zona_almacen === parseInt(selectedReportZoneId);
                            }
                            return b.id_zona_almacen === parseInt(selectedReportZoneId);
                          }
                        }
                        return true;
                      })
                      .map((b) => (
                        <option key={b.id_caja} value={b.id_caja}>
                          CAJA {b.numero_caja} ({b.estado.toUpperCase()})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <Button
                onClick={handleGenerateReport}
                disabled={isGeneratingReport}
                className="w-full rounded-xl h-12 bg-neutral-900 hover:bg-neutral-800 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {isGeneratingReport ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Generando reporte...
                  </>
                ) : (
                  <>
                    <FileText size={18} />
                    Generar reporte de inventario
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {showPreview && (
            <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="bg-neutral-50/50 pb-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-bold">Vista Previa del Reporte</CardTitle>
                  <CardDescription>Confirma la estructura del reporte antes de exportar</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleDownloadPDF}
                    disabled={downloadingPDF}
                    className="rounded-xl h-10 bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs flex items-center gap-1.5"
                  >
                    {downloadingPDF ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                    Descargar PDF
                  </Button>
                  <Button
                    onClick={() => window.print()}
                    className="rounded-xl h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5"
                  >
                    <Printer size={14} />
                    Imprimir / Guardar
                  </Button>
                </div>
              </CardHeader>
              
              <style>{`
                @media screen {
                  .print-only {
                    display: none !important;
                  }
                }

                @media print {
                  body * {
                    visibility: hidden;
                  }
                  #report-print-area, #report-print-area * {
                    visibility: visible;
                  }
                  #report-print-area {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100%;
                    padding: 0 !important;
                    margin: 0 !important;
                  }
                  .print-only {
                    display: block !important;
                  }
                  tr {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                  }
                }

                /* Styles for print output and direct pdf generation */
                @media print {
                  #report-print-area {
                    background-color: white !important;
                    color: black !important;
                  }
                  /* Force light theme variables and overrides */
                  :root, .dark, body {
                    --background: #ffffff !important;
                    --foreground: #252525 !important;
                    --card: #ffffff !important;
                    --card-foreground: #252525 !important;
                    --muted: #f5f5f5 !important;
                    --muted-foreground: #8e8e8e !important;
                    --border: #ebebeb !important;
                  }
                  #report-print-area .bg-white,
                  #report-print-area .bg-neutral-50\/30,
                  #report-print-area .bg-neutral-50\/50,
                  #report-print-area table,
                  #report-print-area tr,
                  #report-print-area td {
                    background-color: white !important;
                    color: black !important;
                    border-color: #e5e7eb !important;
                  }
                  #report-print-area svg g,
                  #report-print-area svg rect {
                    fill: black !important;
                  }
                  #report-print-area svg text {
                    fill: black !important;
                  }
                }

                .html2pdf-mode {
                  background-color: white !important;
                  color: black !important;
                  --background: #ffffff !important;
                  --foreground: #252525 !important;
                  --card: #ffffff !important;
                  --card-foreground: #252525 !important;
                  --muted: #f5f5f5 !important;
                  --muted-foreground: #8e8e8e !important;
                  --border: #ebebeb !important;
                }
                .html2pdf-mode .print-only {
                  display: block !important;
                }
                .html2pdf-mode .bg-white,
                .html2pdf-mode .bg-neutral-50\/30,
                .html2pdf-mode .bg-neutral-50\/50,
                .html2pdf-mode table,
                .html2pdf-mode tr,
                .html2pdf-mode td {
                  background-color: white !important;
                  color: black !important;
                  border-color: #e5e7eb !important;
                }
                .html2pdf-mode svg g,
                .html2pdf-mode svg rect {
                  fill: black !important;
                }
                .html2pdf-mode svg text {
                  fill: black !important;
                }
                .html2pdf-mode tr {
                  page-break-inside: avoid !important;
                  break-inside: avoid !important;
                }

                .page-break {
                  page-break-inside: auto !important;
                  break-inside: auto !important;
                }
                .no-print {
                  display: none !important;
                }
              `}</style>

              <CardContent id="report-print-area" className="p-8 bg-neutral-50/30">
                <div className="mb-8 border-b pb-6 print-only">
                  <h1 className="text-3xl font-black tracking-tight text-neutral-900 uppercase">REPORTE DE INVENTARIO FÍSICO</h1>
                  <p className="text-xs text-neutral-500 mt-1">Generado el: {new Date().toLocaleString()}</p>
                  <div className="mt-4 flex gap-4 text-xs font-bold text-neutral-600">
                    <span>Almacén: {selectedReportZoneId === "all" ? "TODOS" : zones.find(z => z.id_zona_almacen === parseInt(selectedReportZoneId))?.nombre.toUpperCase()}</span>
                    <span>Sección: {selectedReportSectionId === "all" ? "TODAS" : sections.find(s => s.id_zona_seccion === parseInt(selectedReportSectionId))?.nombre.toUpperCase()}</span>
                    <span>Caja: {selectedReportBoxId === "all" ? "TODAS" : `CAJA ${boxes.find(b => b.id_caja === parseInt(selectedReportBoxId))?.numero_caja}`}</span>
                  </div>
                </div>

                {generateGroupedReportData().length === 0 ? (
                  <div className="text-center py-16 text-neutral-400">
                    <p className="text-sm font-bold">No se encontraron datos para los filtros seleccionados</p>
                  </div>
                ) : (
                  generateGroupedReportData().map((zone) => (
                    <div key={zone.id_zona_almacen} className="mb-8 last:mb-0 border-b pb-8 last:border-b-0">
                      <div className="bg-neutral-900 text-white px-5 py-3.5 rounded-2xl flex items-center gap-2 mb-4">
                        <Home size={18} />
                        <h3 className="font-black text-sm uppercase tracking-wider">
                          ALMACÉN: {zone.nombre.toUpperCase()}
                        </h3>
                      </div>

                      {zone.secciones.map((sec: any) => (
                        <div key={sec.id_zona_seccion} className="ml-0 md:ml-4 mb-6 last:mb-0">
                          <div className="flex items-center gap-2 mb-4 border-l-4 border-neutral-700 pl-3.5 py-0.5">
                            <MapPin size={15} className="text-neutral-700" />
                            <h4 className="font-extrabold text-xs uppercase tracking-wide text-neutral-800">
                              SECCIÓN: {sec.nombre.toUpperCase()}
                            </h4>
                          </div>

                          <div className="grid grid-cols-1 gap-6">
                            {sec.cajas.map((box: any) => (
                              <div key={box.id_caja} className="border rounded-2xl p-5 bg-white shadow-sm page-break">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-2 border-b">
                                  <div className="flex items-center gap-2">
                                    <span className="font-black text-xs bg-neutral-100 text-neutral-900 px-3 py-1 rounded-lg">
                                      CAJA {box.numero_caja}
                                    </span>
                                    <span className="text-[10px] bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full font-bold uppercase">
                                      {box.estado}
                                    </span>
                                  </div>
                                  <span className="font-mono text-xs text-neutral-500 font-bold">
                                    SKU Caja: {box.sku || "Sin SKU"}
                                  </span>
                                </div>

                                {box.productos.length === 0 ? (
                                  <p className="text-xs text-neutral-400 italic py-2">Esta caja no tiene productos asignados</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <Table className="text-xs">
                                      <TableHeader className="bg-neutral-50/50">
                                        <TableRow>
                                          <TableHead className="font-bold text-neutral-800">Producto (SKU)</TableHead>
                                          <TableHead className="font-bold text-neutral-800">Detalles</TableHead>
                                          <TableHead className="w-[180px] text-center font-bold text-neutral-800">Código EAN-13 (Escanear)</TableHead>
                                          <TableHead className="text-right w-[80px] font-bold text-neutral-800">Cantidad</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {box.productos.map((item: any) => (
                                          <TableRow key={item.id_producto} className="hover:bg-neutral-50/50">
                                            <TableCell className="font-bold text-neutral-900 py-3">
                                              <div className="flex flex-col">
                                                <span>{item.productos.sku}</span>
                                                {item.productos.marca_sub && (
                                                  <span className="text-[10px] text-neutral-400 font-normal">{item.productos.marca_sub}</span>
                                                )}
                                              </div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                              <div className="flex gap-1.5 flex-wrap">
                                                <span className="px-2 py-0.5 bg-neutral-100 rounded-lg text-[9px] uppercase font-bold text-neutral-600">
                                                  {item.productos.tipo}
                                                </span>
                                                <span className="px-2 py-0.5 bg-neutral-100 rounded-lg text-[9px] uppercase font-bold text-neutral-600">
                                                  Talla {item.productos.talla}
                                                </span>
                                                <span className="px-2 py-0.5 bg-neutral-100 rounded-lg text-[9px] uppercase font-bold text-neutral-600">
                                                  {item.productos.temporada}
                                                </span>
                                              </div>
                                            </TableCell>
                                            <TableCell className="text-center py-2 flex justify-center">
                                              {item.productos.ean_13 ? (
                                                <EAN13Barcode code={item.productos.ean_13} />
                                              ) : (
                                                <span className="text-[10px] text-neutral-400 italic">Sin EAN-13</span>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-right font-black text-sm pr-6 py-3">
                                              {item.cantidad}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Form */}
        <div className="lg:col-span-4">
          <AnimatePresence mode="wait">
            {activeTab === "zonas" ? (
              <motion.div
                key="form-zonas"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
                  <CardHeader className="pb-3 bg-neutral-50/50">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Plus size={18} className="text-neutral-500" />
                      Nueva Zona
                    </CardTitle>
                    <CardDescription>Crea un contenedor de ubicación principal</CardDescription>
                  </CardHeader>
                  <CardContent className="p-5">
                    <form onSubmit={handleAddZone} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Nombre de la Zona</label>
                        <Input 
                          placeholder="Ej: bodega superior, piso venta" 
                          value={newZoneName}
                          onChange={e => setNewZoneName(e.target.value)}
                          className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                        />
                      </div>
                      <Button 
                        type="submit" 
                        disabled={submitting || !newZoneName.trim()}
                        className="w-full rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 text-white font-bold"
                      >
                        {submitting ? <Loader2 className="animate-spin" size={18} /> : "Crear Zona"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div
                key="form-secciones"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
                  <CardHeader className="pb-3 bg-neutral-50/50">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Plus size={18} className="text-neutral-500" />
                      Nueva Sección
                    </CardTitle>
                    <CardDescription>Crea y asocia una sección física a una zona principal</CardDescription>
                  </CardHeader>
                  <CardContent className="p-5">
                    <form onSubmit={handleAddSection} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Nombre de Sección</label>
                        <Input 
                          placeholder="Ej: estante a1, pasillo 4" 
                          value={newSectionName}
                          onChange={e => setNewSectionName(e.target.value)}
                          className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Zona Almacén Asociada</label>
                        <select
                          value={selectedZoneId}
                          onChange={e => setSelectedZoneId(e.target.value)}
                          className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                        >
                          <option value="">Selecciona una zona...</option>
                          {zones.map(z => (
                            <option key={z.id_zona_almacen} value={z.id_zona_almacen}>
                              {z.nombre.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* TIPO PRODUCTO TAG */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Tipo de Producto</label>
                        <select
                          value={newSectionTipo}
                          onChange={e => {
                            setNewSectionTipo(e.target.value);
                            if (e.target.value !== "calzado") {
                              setNewSectionMarca("todos"); // Reset brand if not footwear
                            }
                          }}
                          className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                        >
                          <option value="todos">TODOS / AMBOS</option>
                          <option value="ropa">ROPA</option>
                          <option value="calzado">CALZADO</option>
                        </select>
                      </div>

                      {/* GÉNERO TAG */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Género Destinado</label>
                        <select
                          value={newSectionGenero}
                          onChange={e => setNewSectionGenero(e.target.value)}
                          className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                        >
                          <option value="todos">UNISEX / TODOS</option>
                          <option value="H">HOMBRE (H)</option>
                          <option value="M">MUJER (M)</option>
                        </select>
                      </div>

                      {/* MARCA TAG (Condicional para Calzado) */}
                      {newSectionTipo === "calzado" && (
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Marca de Calzado</label>
                          <select
                            value={newSectionMarca}
                            onChange={e => setNewSectionMarca(e.target.value)}
                            className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                          >
                            <option value="todos">TODAS / AMBAS</option>
                            <option value="Marciano">MARCIANO (M)</option>
                            <option value="Guess">GUESS (G)</option>
                          </select>
                        </div>
                      )}

                      <Button 
                        type="submit" 
                        disabled={submitting || !newSectionName.trim() || !selectedZoneId}
                        className="w-full rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 text-white font-bold"
                      >
                        {submitting ? <Loader2 className="animate-spin" size={18} /> : "Crear Sección"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Tables */}
        <div className="lg:col-span-8">
          <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="bg-neutral-50/40 pb-3 border-b">
              <CardTitle className="text-lg font-bold">Conceptos Registrados</CardTitle>
              <CardDescription>
                {activeTab === "zonas" ? "Zonas principales de almacenamiento" : "Secciones y pasillos asignados a almacenes"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              
              {/* ZONAS TABLE */}
              {activeTab === "zonas" && (
                loadingZones ? (
                  <div className="flex justify-center items-center py-16 text-neutral-400">
                    <Loader2 className="animate-spin" size={24} />
                  </div>
                ) : zones.length === 0 ? (
                  <div className="text-center py-16 text-neutral-400 flex flex-col items-center">
                    <Home size={36} strokeWidth={1} className="opacity-40 mb-2" />
                    <p className="text-sm font-bold">No hay zonas de almacén registradas</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-neutral-50/20">
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead className="text-right w-[150px]">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {zones.map((zone) => (
                        <TableRow key={zone.id_zona_almacen}>
                          <TableCell className="font-extrabold text-sm uppercase">
                            {editingZoneId === zone.id_zona_almacen ? (
                              <Input 
                                value={editingZoneName}
                                onChange={e => setEditingZoneName(e.target.value)}
                                className="h-8 max-w-[250px] uppercase text-xs font-bold"
                              />
                            ) : (
                              zone.nombre
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1.5">
                              {editingZoneId === zone.id_zona_almacen ? (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleUpdateZone(zone.id_zona_almacen)}
                                    className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-lg"
                                  >
                                    <Check size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => setEditingZoneId(null)}
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <X size={14} />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => startEditZone(zone)}
                                    className="h-8 w-8 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg"
                                  >
                                    <Edit2 size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleDeleteZone(zone.id_zona_almacen)}
                                    className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              )}

              {/* SECCIONES TABLE */}
              {activeTab === "secciones" && (
                loadingSections ? (
                  <div className="flex justify-center items-center py-16 text-neutral-400">
                    <Loader2 className="animate-spin" size={24} />
                  </div>
                ) : sections.length === 0 ? (
                  <div className="text-center py-16 text-neutral-400 flex flex-col items-center">
                    <MapPin size={36} strokeWidth={1} className="opacity-40 mb-2" />
                    <p className="text-sm font-bold">No hay secciones registradas</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-neutral-50/20">
                      <TableRow>
                        <TableHead>Nombre Sección</TableHead>
                        <TableHead>Almacén Principal</TableHead>
                        <TableHead>Etiquetas (Tags)</TableHead>
                        <TableHead className="text-right w-[180px]">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sections.map((section: any) => (
                        <TableRow key={section.id_zona_seccion}>
                          <TableCell className="font-extrabold text-sm uppercase">
                            {editingSectionId === section.id_zona_seccion ? (
                              <Input 
                                value={editingSectionName}
                                onChange={e => setEditingSectionName(e.target.value)}
                                className="h-8 max-w-[200px] uppercase text-xs font-bold"
                              />
                            ) : (
                              section.nombre
                            )}
                          </TableCell>
                          
                          <TableCell className="font-semibold text-xs uppercase text-neutral-500">
                            {editingSectionId === section.id_zona_seccion ? (
                              <select
                                value={editingSectionZoneId}
                                onChange={e => setEditingSectionZoneId(e.target.value)}
                                className="h-8 px-2 bg-neutral-50 border rounded-lg text-xs outline-none"
                              >
                                {zones.map(z => (
                                  <option key={z.id_zona_almacen} value={z.id_zona_almacen}>
                                    {z.nombre.toUpperCase()}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              section.almacen_nombre
                            )}
                          </TableCell>

                          {/* TAGS COLUMN */}
                          <TableCell className="py-2">
                            {section.tags ? (
                              <div className="flex flex-wrap gap-1">
                                {section.tags.tipo_producto && section.tags.tipo_producto !== "todos" && (
                                  <Badge className="bg-neutral-100 text-neutral-800 border border-neutral-200 capitalize text-[9px] px-1.5 py-0">
                                    {section.tags.tipo_producto}
                                  </Badge>
                                )}
                                {section.tags.genero && section.tags.genero !== "todos" && (
                                  <Badge className="bg-blue-50 text-blue-800 border border-blue-100 text-[9px] px-1.5 py-0 font-extrabold">
                                    {section.tags.genero === "H" ? "H" : "M"}
                                  </Badge>
                                )}
                                {section.tags.marca && section.tags.marca !== "todos" && (
                                  <Badge className="bg-purple-50 text-purple-800 border border-purple-100 text-[9px] px-1.5 py-0 font-extrabold">
                                    {section.tags.marca}
                                  </Badge>
                                )}
                                {(!section.tags.tipo_producto || (section.tags.tipo_producto === "todos" && section.tags.genero === "todos" && section.tags.marca === "todos")) && (
                                  <span className="text-neutral-400 italic text-[10px]">Sin tags</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-neutral-400 italic text-[10px]">Sin tags</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1.5">
                              {editingSectionId === section.id_zona_seccion ? (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleUpdateSection(section.id_zona_seccion)}
                                    className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-lg"
                                  >
                                    <Check size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => setEditingSectionId(null)}
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <X size={14} />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => {
                                      setActiveBarcodeSection({
                                        id_zona_seccion: section.id_zona_seccion,
                                        nombre: section.nombre,
                                        almacen_nombre: section.almacen_nombre
                                      });
                                    }}
                                    className="h-8 w-8 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg"
                                    title="Imprimir código de barras de sección"
                                  >
                                    <Printer size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => startEditSection(section)}
                                    className="h-8 w-8 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg"
                                  >
                                    <Edit2 size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleDeleteSection(section.id_zona_seccion)}
                                    className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              )}

            </CardContent>
          </Card>
        </div>
      </div>
      )}

      {/* Barcode Print Dialog for Section (Jerarquía 2) */}
      <Dialog open={!!activeBarcodeSection} onOpenChange={(open) => !open && setActiveBarcodeSection(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 bg-white border border-neutral-100 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase text-neutral-950 flex items-center gap-2">
              <Printer size={20} className="text-neutral-700" />
              Imprimir Código de Sección
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-500">
              Usa este código de barras para iniciar el conteo físico del operador
            </DialogDescription>
          </DialogHeader>

          {activeBarcodeSection && (
            <div className="flex flex-col items-center justify-center p-6 bg-neutral-50 rounded-2xl border border-neutral-100 space-y-4 my-2">
              <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col items-center select-none" id="section-barcode-print-area">
                <svg id="section-barcode-svg" className="max-w-full"></svg>
                <span className="text-[10px] font-black uppercase text-neutral-500 mt-2 font-mono tracking-widest">
                  {`SEC-${activeBarcodeSection.id_zona_seccion}`}
                </span>
                <span className="text-xs font-black text-neutral-800 uppercase mt-0.5">
                  SECCIÓN: {activeBarcodeSection.nombre}
                </span>
                <span className="text-[9px] font-extrabold text-neutral-400 uppercase mt-0.5">
                  ALMACÉN: {activeBarcodeSection.almacen_nombre}
                </span>
              </div>

              <div className="flex gap-2 w-full">
                <Button variant="outline" onClick={() => setActiveBarcodeSection(null)} className="flex-1 rounded-xl h-10 text-xs font-bold">
                  Cerrar
                </Button>
                <Button onClick={() => window.print()} className="flex-1 rounded-xl h-10 bg-neutral-950 hover:bg-neutral-850 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md">
                  <Printer size={14} />
                  Imprimir Etiqueta
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
