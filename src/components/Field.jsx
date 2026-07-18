import React from "react";
import { COLORS } from "../styles.js";

export default function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
