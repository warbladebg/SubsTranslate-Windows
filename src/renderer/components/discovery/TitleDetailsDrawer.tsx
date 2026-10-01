import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { INERT_PROPS, useExitPresence } from "../../hooks/useExitPresence";

const EXIT_MS = 220;
// React 18 has no typed `inert` prop; an empty string sets the attribute.
interface TitleDetailsDrawerProps {
  open: boolean;
  panelRef: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal drawer that keeps keyboard focus inside the title details. After closing it
 * slides out showing its last content, hidden from assistive technology and input.
 */
export function TitleDetailsDrawer({ open, panelRef, onClose, children }: TitleDetailsDrawerProps) {
  const { present, closing } = useExitPresence(open, EXIT_MS);
  // The page clears the details as soon as the drawer closes; keep them for the exit.
  const [retained, setRetained] = useState<ReactNode>(children);
  useEffect(() => {
    if (open) setRetained(children);
  }, [children, open]);

  if (!present) return null;
  return (
    <>
      <div
        className={`discover-details-backdrop${closing ? " closing" : ""}`}
        aria-hidden="true"
        onClick={closing ? undefined : onClose}
      />
      <aside
        className={`discover-details panel${closing ? " closing" : ""}`}
        role={closing ? undefined : "dialog"}
        aria-modal={closing ? undefined : true}
        aria-hidden={closing || undefined}
        aria-labelledby="discover-details-title"
        {...(closing ? INERT_PROPS : {})}
        ref={closing ? undefined : panelRef}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="discover-details-toolbar">
          <strong id="discover-details-title">Title details</strong>
          <button
            aria-label="Close details"
            className="icon-button discover-close"
            onClick={onClose}
            title="Close details"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="discover-details-body">{open ? children : retained}</div>
      </aside>
    </>
  );
}

function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
