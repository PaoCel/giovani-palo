import { useMemo, useState } from "react";

import { AppModal } from "@/components/AppModal";
import {
  DEFAULT_EXPORT_CATEGORIES,
  DEFAULT_EXPORT_FIELDS,
  EXCEL_EXPORT_FIELDS,
  type ExportCategory,
  type ExportFieldKey,
  type ExportFieldOption,
  type ExportOptions,
} from "@/utils/registrationExcel";

interface RegistrationExcelExportModalProps {
  totalRegistrations: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (options: ExportOptions) => void | Promise<void>;
}

const categoryOptions: Array<{ key: ExportCategory; label: string; helper: string }> = [
  { key: "giovane_uomo", label: "Giovani Uomini (GU)", helper: "Iscritti maschi" },
  { key: "giovane_donna", label: "Giovani Donne (GD)", helper: "Iscritte femmine" },
  { key: "dirigente", label: "Dirigenti", helper: "Dirigenti delle unità" },
  { key: "accompagnatore", label: "Accompagnatori", helper: "Genitori / adulti di supporto" },
];

const groupLabels: Record<ExportFieldOption["group"], string> = {
  anagrafica: "Anagrafica",
  contatti: "Contatti",
  logistica: "Logistica e preferenze",
  consensi: "Consensi",
  meta: "Metadati iscrizione",
};

const groupOrder: Array<ExportFieldOption["group"]> = [
  "anagrafica",
  "contatti",
  "logistica",
  "consensi",
  "meta",
];

export function RegistrationExcelExportModal({
  totalRegistrations,
  busy = false,
  onClose,
  onConfirm,
}: RegistrationExcelExportModalProps) {
  const [categories, setCategories] = useState<ExportCategory[]>(DEFAULT_EXPORT_CATEGORIES);
  const [fields, setFields] = useState<ExportFieldKey[]>(DEFAULT_EXPORT_FIELDS);
  const [includeOverallSheet, setIncludeOverallSheet] = useState(true);

  const groupedFields = useMemo(() => {
    return groupOrder
      .map((group) => ({
        group,
        items: EXCEL_EXPORT_FIELDS.filter((field) => field.group === group),
      }))
      .filter((entry) => entry.items.length > 0);
  }, []);

  function toggleCategory(category: ExportCategory) {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((value) => value !== category)
        : [...current, category],
    );
  }

  function toggleField(field: ExportFieldKey) {
    setFields((current) =>
      current.includes(field)
        ? current.filter((value) => value !== field)
        : [...current, field],
    );
  }

  function selectAllFields() {
    setFields(EXCEL_EXPORT_FIELDS.map((field) => field.key));
  }

  function resetFields() {
    setFields(DEFAULT_EXPORT_FIELDS);
  }

  function handleConfirm() {
    if (busy || categories.length === 0 || fields.length === 0) return;
    void onConfirm({ categories, fields, includeOverallSheet });
  }

  const canConfirm = !busy && categories.length > 0 && fields.length > 0;

  return (
    <AppModal
      title="Esporta iscritti in Excel"
      subtitle={`Scegli quali categorie e quali dati includere. ${totalRegistrations} iscritti attivi.`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Annulla
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Preparazione..." : "Scarica Excel"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: "1.6rem" }}>
        <section>
          <h3 style={{ margin: "0 0 0.6rem", fontSize: "1rem" }}>Categorie da includere</h3>
          <p style={{ margin: "0 0 0.8rem", color: "var(--muted)", fontSize: "0.92rem" }}>
            Ogni categoria selezionata avrà un foglio dedicato.
          </p>
          <div className="checkbox-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {categoryOptions.map((option) => (
              <label key={option.key} className="toggle-field">
                <input
                  type="checkbox"
                  checked={categories.includes(option.key)}
                  onChange={() => toggleCategory(option.key)}
                />
                <span>
                  {option.label}
                  <small style={{ fontWeight: 400, color: "var(--muted)" }}>{option.helper}</small>
                </span>
              </label>
            ))}
          </div>
          <label className="toggle-field" style={{ marginTop: "0.8rem" }}>
            <input
              type="checkbox"
              checked={includeOverallSheet}
              onChange={(event) => setIncludeOverallSheet(event.target.checked)}
            />
            <span>
              Foglio "Elenco generale"
              <small style={{ fontWeight: 400, color: "var(--muted)" }}>
                Tutti gli iscritti delle categorie scelte in un unico foglio
              </small>
            </span>
          </label>
        </section>

        <section>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "0.8rem",
              marginBottom: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Colonne da esportare</h3>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={selectAllFields}
              >
                Tutte
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={resetFields}
              >
                Predefinite
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gap: "1.2rem" }}>
            {groupedFields.map((entry) => (
              <div key={entry.group}>
                <h4
                  style={{
                    margin: "0 0 0.5rem",
                    fontSize: "0.82rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--muted)",
                  }}
                >
                  {groupLabels[entry.group]}
                </h4>
                <div
                  className="checkbox-grid"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
                >
                  {entry.items.map((option) => (
                    <label key={option.key} className="toggle-field">
                      <input
                        type="checkbox"
                        checked={fields.includes(option.key)}
                        onChange={() => toggleField(option.key)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {categories.length === 0 ? (
          <p style={{ margin: 0, color: "var(--danger, #b14e44)" }}>
            Seleziona almeno una categoria.
          </p>
        ) : null}
        {fields.length === 0 ? (
          <p style={{ margin: 0, color: "var(--danger, #b14e44)" }}>
            Seleziona almeno una colonna.
          </p>
        ) : null}
      </div>
    </AppModal>
  );
}
