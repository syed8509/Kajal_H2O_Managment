import React from "react";
import { Search, X } from "lucide-react";

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="searchbox">
      <Search size={18} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button onClick={() => onChange("")}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
