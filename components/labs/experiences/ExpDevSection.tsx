"use client";

import { useEffect, useState, type ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  /** Start open (default false — keeps Dev panel scannable). */
  defaultOpen?: boolean;
  children: ReactNode;
};

const STORE_KEY = "spatial-lab.experiences.dev-sections.v1";

function readOpen(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const map = JSON.parse(raw) as Record<string, boolean>;
    if (typeof map[id] === "boolean") return map[id];
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeOpen(id: string, open: boolean) {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[id] = open;
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Collapsible block for Dev tools (checkpoints, staging, surfaces, …). */
export function ExpDevSection({ id, title, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(readOpen(id, defaultOpen));
  }, [id, defaultOpen]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      writeOpen(id, next);
      return next;
    });
  };

  return (
    <section className={`exp-dev-section${open ? " open" : ""}`}>
      <button type="button" className="exp-dev-section-head" onClick={toggle} aria-expanded={open}>
        <span className="exp-dev-section-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="exp-dev-section-title">{title}</span>
      </button>
      {open ? <div className="exp-dev-section-body">{children}</div> : null}
    </section>
  );
}
