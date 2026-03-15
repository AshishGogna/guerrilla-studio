"use client";

import Link from "next/link";
import { ReactNode, useState } from "react";
import { getAll, removeAll, removeData } from "@/lib/data";

interface TopBarProps {
  title?: string;
  projectId: string;
  children?: ReactNode;
}

function EmailLoaderIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function TopBar({ title = "", projectId, children }: TopBarProps) {
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [entries, setEntries] = useState<[string, unknown][]>([]);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailEntries, setEmailEntries] = useState<[string, unknown][]>([]);
  const [emailSelectedKeys, setEmailSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedEmail, setSelectedEmail] = useState("esha.verma.18.09.1998@gmail.com");
  const [emailSubject, setEmailSubject] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const formatSubjectDateTime = () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
  };

  const openDataModal = () => {
    setEntries(Object.entries(getAll(projectId)));
    setDataModalOpen(true);
  };

  const handleRemove = (key: string) => {
    removeData(projectId, key);
    setEntries(Object.entries(getAll(projectId)));
  };

  const handleRemoveAll = () => {
    removeAll(projectId);
    setEntries([]);
  };

  const EMAIL_METADATA_KEY_PREFIXES = ["youtube", "instagram", "facebook", "exportedVideo"];

  const openEmailModal = () => {
    const all = getAll(projectId);
    setEmailEntries(Object.entries(all));
    setEmailSelectedKeys(new Set());
    setEmailSubject("");
    setEmailModalOpen(true);
  };

  const selectForVideo = () => {
    setEmailSubject(`New Video (${formatSubjectDateTime()})`);
    setEmailSelectedKeys(new Set()); // do not remove
    setEmailSelectedKeys((prev) => {
      const next = new Set(prev);
      emailEntries.forEach(([key]) => {
        if (EMAIL_METADATA_KEY_PREFIXES.some((p) => key.startsWith(p))) next.add(key);
      });
      return next;
    });
  };

  const selectForCarousel = () => {
    setEmailSubject(`New Carousel (${formatSubjectDateTime()})`);
    setEmailSelectedKeys(new Set()); // do not remove
    setEmailSelectedKeys((prev) => {
      const next = new Set(prev);
      emailEntries.forEach(([key]) => {
        if (key.startsWith("storyboard") || key.startsWith("carouselCaption")) next.add(key);
      });
      return next;
    });
  };

  const toggleEmailKey = (key: string) => {
    setEmailSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isAttachmentPath = (v: unknown): v is string =>
    typeof v === "string" &&
    (v.startsWith("/editor-saves/") || v.startsWith("/projects/"));

  const handleSendEmail = async () => {
    const selected = emailEntries.filter(([key]) => emailSelectedKeys.has(key));
    if (selected.length === 0) {
      alert("Select at least one metadata item to include.");
      return;
    }
    const attachmentPaths: string[] = [];
    let body = "";
    for (const [key, value] of selected) {
      if (isAttachmentPath(value)) {
        attachmentPaths.push(value);
        continue;
      }
      const v =
        typeof value === "string"
          ? value
          : value == null
            ? ""
            : JSON.stringify(value);
      body += key + " - " + v + "\n\n";
    }
    const subject = emailSubject.trim();

    setSendingEmail(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedEmail,
          subject,
          body,
          attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error ?? `Failed to send email (${res.status})`);
        return;
      }
      setEmailModalOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex h-8 w-4 shrink-0 items-center justify-center text-xl font-bold text-[#e8b923] transition hover:bg-muted hover:border-foreground/25"
            title="Home"
          >
            G
          </Link>
          <div>•</div>
          <div className="font-mono text-sm uppercase tracking-wider text-foreground/70">{projectId}</div>
          <div>•</div>
          {title && (
            <h1 className="font-mono text-sm uppercase tracking-wider text-foreground/70">
              {title}
            </h1>
          )}
          {children}
        </div>
        <div className="flex items-center gap-2">
          {title === "Panels" && (
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            onClick={openEmailModal}
          >
            Email Output
          </button>
          )}
          {title === "Panels" && (
          <button
            type="button"
            className="rounded px-2 py-1 font-mono text-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            title="View stored data"
            onClick={openDataModal}
          >
            {"{ }"}
          </button>
          )}
        </div>
      </div>

      {dataModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setDataModalOpen(false)}
        >
          <div
            className="bg-[#222222] border border-foreground/10 rounded-lg shadow-lg w-[90vw] max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10">
              <h2 className="font-mono text-sm font-medium text-foreground">
                Stored data
              </h2>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setDataModalOpen(false)}
              >
                ×
              </button>
            </div>
            <ul className="flex-1 overflow-auto p-4 space-y-2 list-none m-0">
              {entries.length === 0 ? (
                <li className="text-sm text-muted-foreground">No entries</li>
              ) : (
                entries.map(([key, value]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-2 rounded border border-foreground/10 bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <div className="font-mono text-sm text-foreground">
                        {key}
                      </div>
                      :
                      <div className="text-muted-foreground text-sm truncate block">
                        {typeof value === "object" && value !== null
                          ? JSON.stringify(value)
                          : String(value)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      onClick={() => handleRemove(key)}
                    >
                      Delete
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-foreground/10">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                onClick={() => setDataModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 transition-colors"
                onClick={handleRemoveAll}
                disabled={entries.length === 0}
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}

      {emailModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setEmailModalOpen(false)}
        >
          <div
            className="flex h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-foreground/10 bg-[#222222] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
              <h2 className="text-sm font-medium text-foreground">
                Email Metadata
              </h2>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setEmailModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Available metadata
                </div>
                <div className="mb-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-xs text-foreground/80 hover:text-foreground underline transition-colors"
                    onClick={selectForVideo}
                  >
                    Select for Video
                  </button>
                  <button
                    type="button"
                    className="text-xs text-foreground/80 hover:text-foreground underline transition-colors"
                    onClick={selectForCarousel}
                  >
                    Select for Carousel
                  </button>
                </div>
                <ul className="max-h-64 space-y-1 overflow-auto rounded border border-foreground/10 bg-card p-2 text-xs">
                  {emailEntries.length === 0 ? (
                    <li className="text-muted-foreground">
                      No metadata.
                    </li>
                  ) : (
                    emailEntries.map(([key, value]) => {
                      const selected = emailSelectedKeys.has(key);
                      const v =
                        typeof value === "string"
                          ? value
                          : value == null
                            ? ""
                            : JSON.stringify(value);
                      return (
                        <li
                          key={key}
                          role="button"
                          tabIndex={0}
                          className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 ${
                            selected ? "bg-muted" : ""
                          }`}
                          onClick={() => toggleEmailKey(key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleEmailKey(key);
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3 w-3 pointer-events-none"
                            checked={selected}
                            readOnly
                            tabIndex={-1}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <div className="font-mono text-[11px] text-foreground">
                              {key}
                            </div>
                            :
                            <div className="truncate text-[11px] text-muted-foreground">
                              {v}
                            </div>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Email
                </label>
                <select
                  className="w-full rounded-md border border-foreground/10 bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  value={selectedEmail}
                  onChange={(e) => setSelectedEmail(e.target.value)}
                >
                  <option value="esha.verma.18.09.1998@gmail.com">
                    esha.verma.18.09.1998@gmail.com
                  </option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Subject
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border border-foreground/10 bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Email subject"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-foreground/10 px-4 py-3">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                onClick={() => setEmailModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingEmail}
                className="rounded bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 transition-colors disabled:opacity-60 disabled:pointer-events-none flex items-center gap-2"
                onClick={handleSendEmail}
              >
                {sendingEmail ? (
                  <>
                    <EmailLoaderIcon />
                    Sending…
                  </>
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
