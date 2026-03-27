"use client";

type NodeMenuProps = {
  x: number;
  y: number;
  onRename?: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function NodeMenu({ x, y, onRename, onDelete, onClose }: NodeMenuProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Close node menu"
        className="fixed inset-0 z-20 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        className="fixed z-30 min-w-[140px] rounded border border-foreground/20 bg-[#171717] p-1 shadow-lg"
        style={{ left: x, top: y }}
      >
        {onRename ? (
          <button
            type="button"
            className="w-full rounded px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-foreground/10"
            onClick={onRename}
          >
            Rename
          </button>
        ) : null}
        <button
          type="button"
          className="w-full rounded px-3 py-1.5 text-left text-sm text-red-300 hover:bg-red-500/15"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </>
  );
}
