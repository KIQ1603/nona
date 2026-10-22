'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnchoredMenu } from '@/components/admin/anchored-menu';

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * A drop-down list that always opens right under its button, in the same place every time. (A native
 * <select> re-positions its list around the selected item, so choosing the last option makes it jump up.)
 */
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  className = '',
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  className?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  const items = () =>
    Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? []);
  const onKey = (e: KeyboardEvent) => {
    const els = items();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[Math.min(els.length - 1, i + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[Math.max(0, i - 1)]?.focus();
    } else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els[els.length - 1]?.focus();
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={anchor}
        id={id}
        type="button"
        className={`dd-trigger ${className}`.trim()}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="dd-label">{current?.label ?? ''}</span>
        <span className="dd-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        matchWidth
        onClose={() => setOpen(false)}
        label={ariaLabel}
      >
        <div
          ref={(el) => {
            list.current = el;
            // put the keyboard focus on the chosen item when the list opens
            if (el)
              requestAnimationFrame(() =>
                (
                  el.querySelector<HTMLButtonElement>('[aria-selected=true]') ??
                  el.querySelector<HTMLButtonElement>('[role=option]')
                )?.focus(),
              );
          }}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="dd-list"
          onKeyDown={onKey}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="am-item"
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
                anchor.current?.focus();
              }}
            >
              <span className="dd-check" aria-hidden="true">
                {o.value === value ? '✓' : ''}
              </span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </AnchoredMenu>
    </>
  );
}
