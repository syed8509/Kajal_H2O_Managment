import React, { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const f = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={`modal ${wide ? "modal-wide" : ""}`}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
export function Field({ label, children, wide = false }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ModalActions({ onClose, saving, disabled = false }) {
  return (
    <div className="modal-actions">
      <button type="button" className="secondary" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="primary" disabled={saving || disabled}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
