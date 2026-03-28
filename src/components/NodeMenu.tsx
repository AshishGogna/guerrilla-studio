"use client";

type NodeMenuProps = {
  x: number;
  y: number;
  onRename?: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Extra rows (e.g. label scale actions) */
  extraItems?: { label: string; onClick: () => void }[];
};

export default function NodeMenu({
  x,
  y,
  onRename,
  onDelete,
  onClose,
  extraItems,
}: NodeMenuProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Close node menu"
        className="fixed inset-0 z-20 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        className="fixed z-30 min-w-[160px] rounded border border-foreground/20 bg-[#171717] p-1 shadow-lg"
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
        {extraItems?.map((item) => (
          <button
            key={item.label}
            type="button"
            className="w-full rounded px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-foreground/10"
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ))}
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
