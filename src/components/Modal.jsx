import React from "react";
import { X } from "lucide-react";
import { COLORS, sansFont, serifFont } from "../styles.js";

export default function Modal({ children, onClose, title, width = 420 }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(34,32,27,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, fontFamily: sansFont }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: COLORS.bg, width, padding: 26, border: `2px solid ${COLORS.ink}`, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontFamily: serifFont, fontSize: 19, fontWeight: 400, margin: 0 }}>{title}</h3>
          <X size={18} style={{ cursor: "pointer" }} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
