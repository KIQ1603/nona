'use client';

import { useRef, useState } from 'react';
import { Dropdown, type DropdownOption } from '@/components/ui/dropdown';

/** A filter drop-down for the admin GET forms: submits its value with the form and applies it straight away. */
export function FilterSelect({
  name,
  defaultValue,
  options,
  ariaLabel,
}: {
  name: string;
  defaultValue: string;
  options: DropdownOption[];
  ariaLabel: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const hidden = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={hidden} type="hidden" name={name} value={value} />
      <Dropdown
        value={value}
        options={options}
        ariaLabel={ariaLabel}
        className="dd-filter"
        onChange={(v) => {
          setValue(v);
          // let React write the new value into the hidden input before the form is submitted
          requestAnimationFrame(() => hidden.current?.form?.requestSubmit());
        }}
      />
    </>
  );
}
