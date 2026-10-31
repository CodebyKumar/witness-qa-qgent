"use client";

import { useEffect, useId, useRef, useState } from "react";

export type Option<T extends string> = { value: T; label: string; tone?: string };

/** Accessible listbox dropdown: click or Enter to open, arrows to move, Enter to pick, Escape to close. */
export default function Select<T extends string>({ value, options, onChange, label }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, options.findIndex((o) => o.value === value)));
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    button.current?.focus();
  };

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
      }
      return;
    }
    if (e.key === "Tab") return setOpen(false);
    const moves: Record<string, () => void> = {
      Escape: () => setOpen(false),
      ArrowDown: () => setActive((i) => Math.min(options.length - 1, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(options.length - 1),
      Enter: () => pick(active),
      " ": () => pick(active),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
    }
  }

  return (
    <div className="select" ref={root}>
      <button
        ref={button}
        type="button"
        className="select__button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}, ${current.label}`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        {current.tone && <span className={`select__dot select__dot--${current.tone}`} aria-hidden="true" />}
        {current.label}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="select__chevron">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="select__list">
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`select__option${i === active ? " is-active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              {o.tone && <span className={`select__dot select__dot--${o.tone}`} aria-hidden="true" />}
              {o.label}
              {o.value === value && (
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="select__check">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
