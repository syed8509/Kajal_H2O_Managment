import React from "react";
import { ClipboardList } from "lucide-react";

export function Empty({ title, detail }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ClipboardList size={24} />
      </div>
      <b>{title}</b>
      <p>{detail}</p>
    </div>
  );
}
