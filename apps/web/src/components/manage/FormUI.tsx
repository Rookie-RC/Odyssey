// Small shared form primitives for Manage Atlas. These are deliberately plain
// and sparse (VISUAL_SPEC §16): one field per row, clear labels, restrained
// controls. Everything styles itself from the theme tokens.
import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="atlas-form-field">
      <span className="atlas-form-label">{label}</span>
      {children}
      {hint ? <span className="atlas-form-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="atlas-form-input" {...props} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="atlas-form-input" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="atlas-form-input" {...props} />;
}

export function MonthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="atlas-form-input" type="month" {...props} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="atlas-form-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Btn({
  kind = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "danger" | "default" }) {
  return (
    <button
      type="button"
      className={
        "atlas-btn" +
        (kind === "primary" ? " atlas-btn--primary" : "") +
        (kind === "danger" ? " atlas-btn--danger" : "")
      }
      {...props}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={"atlas-manage-card" + (className ? " " + className : "")}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="atlas-manage-empty">{children}</p>;
}

export function Row({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="atlas-manage-row">
      <div className="atlas-manage-row__main">{children}</div>
      {actions ? <div className="atlas-manage-row__actions">{actions}</div> : null}
    </div>
  );
}

export function IconBtn({
  label,
  onClick,
  kind = "default",
  disabled,
}: {
  label: string;
  onClick: () => void;
  kind?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={"atlas-manage-icon-btn" + (kind === "danger" ? " atlas-manage-icon-btn--danger" : "")}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
