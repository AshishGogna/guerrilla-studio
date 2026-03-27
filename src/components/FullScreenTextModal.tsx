"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type FullScreenTextModalProps = {
  open: boolean;
  text: string;
  onChange: (value: string) => void;
  onClose: () => void;
};

export default function FullScreenTextModal({
  open,
  text,
  onChange,
  onClose,
}: FullScreenTextModalProps) {
  const [mounted, setMounted] = useState(false);
  const backdropPointerDownRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onMouseDown={(e) => {
        backdropPointerDownRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropPointerDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        className="h-[85vh] w-[50vw] rounded-lg border border-foreground/20 bg-[#171717]"
        onMouseDown={() => {
          backdropPointerDownRef.current = false;
        }}
      >
        <textarea
          className="h-full w-full resize-none rounded bg-transparent p-3 text-sm text-foreground outline-none"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>,
    document.body
  );
}

