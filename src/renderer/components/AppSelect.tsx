import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface AppSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface AppSelectProps {
  ariaLabel: string;
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedValues?: string[];
  selectionLabel?: string;
}

export function AppSelect({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Choose",
  selectedValues,
  selectionLabel
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => (selectedValues ? selectedValues.includes(option.value) : option.value === value));

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  function choose(option: AppSelectOption): void {
    if (option.disabled) {
      return;
    }
    onChange(option.value);
    if (!selectedValues) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div className={`app-select${open ? " open" : ""}`} ref={rootRef}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="app-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        role="combobox"
        type="button"
      >
        <span>{selectionLabel ?? selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {open && (
        <div aria-multiselectable={selectedValues ? true : undefined} aria-label={`${ariaLabel} options`} className="app-select-options" id={listboxId} role="listbox">
          {options.map((option) => (
            <button
              aria-selected={(selectedValues ? selectedValues.includes(option.value) : option.value === value)}
              className={(selectedValues ? selectedValues.includes(option.value) : option.value === value) ? "selected" : ""}
              disabled={option.disabled}
              key={option.value}
              onClick={() => choose(option)}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {(selectedValues ? selectedValues.includes(option.value) : option.value === value)
                && <Check aria-hidden="true" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
