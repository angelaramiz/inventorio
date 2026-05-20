import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function ImageLightbox() {
  const [isOpen, setIsOpen] = useState(false);
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        
        // Skip tiny icons, avatar dots, or images marked with "no-zoom"
        if (img.naturalWidth < 32 && img.naturalHeight < 32) return;
        if (img.classList.contains("no-zoom") || img.closest(".no-zoom")) return;

        // Skip clicking the image inside the lightbox itself
        if (img.closest(".fixed") && (img.closest(".fixed") as HTMLElement).classList.contains("cursor-zoom-out")) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        setSrc(img.src);
        setAlt(img.alt || "Imagen del Producto");
        setIsOpen(true);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("click", handleGlobalClick, true); // Use capture phase to catch before modal logic stops propagation
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleGlobalClick, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md cursor-zoom-out p-4"
        >
          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            className="absolute top-6 right-6 p-3 bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800/80 text-white rounded-full transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-2xl cursor-pointer"
            title="Cerrar (Esc)"
          >
            <X size={24} />
          </button>

          {/* Image and Alt Text */}
          <motion.div
            initial={{ scale: 0.95, y: 15 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 15 }}
            transition={{ type: "spring", damping: 25, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-full max-h-full flex flex-col items-center gap-4 select-none"
          >
            <img
              src={src}
              alt={alt}
              className="max-w-[92vw] max-h-[82vh] md:max-w-[85vw] md:max-h-[82vh] object-contain rounded-2xl shadow-2xl border border-neutral-800/40 bg-neutral-950/20 cursor-default"
            />
            {alt && (
              <span className="text-xs font-black uppercase text-neutral-300 tracking-widest bg-neutral-900/90 px-4.5 py-2.5 rounded-xl border border-neutral-800/40 shadow-xl max-w-[80vw] truncate text-center">
                {alt}
              </span>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
