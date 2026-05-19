/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { Boxes, Package, Scan, LayoutDashboard, Tag, Warehouse } from "lucide-react";
import InventoryView from "./components/InventoryView";
import CajasView from "./components/CajasView";
import ScannerView from "./components/ScannerView";
import ConceptosView from "./components/ConceptosView";
import AlmacenView from "./components/AlmacenView";
import ConsultaDashboard from "./components/ConsultaDashboard";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [activeTab, setActiveTab] = useState("scanner");
  const [isDashboard, setIsDashboard] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/dashboard" || path === "/consulta") {
      setIsDashboard(true);
    }
  }, []);

  if (isDashboard) {
    return (
      <>
        <ConsultaDashboard />
        <Toaster position="top-center" expand={true} richColors />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="bg-neutral-900 p-1.5 rounded-lg text-white">
              <Boxes size={24} />
            </div>
            <span>INVENTARIO <span className="text-neutral-400 font-normal">| ALPHA</span></span>
          </div>
          
          <nav className="hidden md:flex items-center gap-1 bg-neutral-100 p-1 rounded-xl">
            <TabButton 
              active={activeTab === "scanner"} 
              onClick={() => setActiveTab("scanner")}
              icon={<Scan size={18} />}
              label="Escanear"
            />
            <TabButton 
              active={activeTab === "inventory"} 
              onClick={() => setActiveTab("inventory")}
              icon={<Package size={18} />}
              label="Productos"
            />
            <TabButton 
              active={activeTab === "boxes"} 
              onClick={() => setActiveTab("boxes")}
              icon={<LayoutDashboard size={18} />}
              label="Cajas"
            />
            <TabButton 
              active={activeTab === "concepts"} 
              onClick={() => setActiveTab("concepts")}
              icon={<Tag size={18} />}
              label="Conceptos"
            />
            <TabButton 
              active={activeTab === "almacen"} 
              onClick={() => setActiveTab("almacen")}
              icon={<Warehouse size={18} />}
              label="Almacén"
            />
          </nav>
        </div>
      </header>

      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "scanner" && <ScannerView />}
            {activeTab === "inventory" && <InventoryView />}
            {activeTab === "boxes" && <CajasView />}
            {activeTab === "concepts" && <ConceptosView />}
            {activeTab === "almacen" && <AlmacenView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around p-3 z-50">
        <MobileNavButton 
          active={activeTab === "scanner"} 
          onClick={() => setActiveTab("scanner")}
          icon={<Scan size={24} />}
          label="Scanner"
        />
        <MobileNavButton 
          active={activeTab === "inventory"} 
          onClick={() => setActiveTab("inventory")}
          icon={<Package size={24} />}
          label="Stock"
        />
        <MobileNavButton 
          active={activeTab === "boxes"} 
          onClick={() => setActiveTab("boxes")}
          icon={<LayoutDashboard size={24} />}
          label="Cajas"
        />
        <MobileNavButton 
          active={activeTab === "concepts"} 
          onClick={() => setActiveTab("concepts")}
          icon={<Tag size={24} />}
          label="Conceptos"
        />
        <MobileNavButton 
          active={activeTab === "almacen"} 
          onClick={() => setActiveTab("almacen")}
          icon={<Warehouse size={24} />}
          label="Almacén"
        />
      </nav>

      <Toaster position="top-center" expand={true} richColors />
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 font-medium text-sm ${
        active 
          ? "bg-white text-neutral-900 shadow-sm" 
          : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors ${
        active ? "text-neutral-900" : "text-neutral-400"
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-widest">{label}</span>
    </button>
  );
}

