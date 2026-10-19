import { useId, useMemo, useRef, useState } from "react";

import { BottomSheet } from "@/components/register/BottomSheet";
import { ChildForm, type ChildUnitOption } from "@/components/register/ChildForm";
import { CHI_ISCRIVI } from "@/copy/chiIscrivi";
import { fillCopy } from "@/copy/parole";
import type { ChildProfile } from "@/types";
import {
  getChildFormInitial,
  validateChildForm,
  type ChildFormValues,
} from "@/utils/childChoice";

interface ChildSheetProps {
  // null: nuovo figlio; altrimenti modifica di quello.
  child: ChildProfile | null;
  unitOptions: ReadonlyArray<ChildUnitOption>;
  parentUnitId: string;
  firstDay: Date;
  onCancel: () => void;
  // Scrive nel tuo account; un errore resta nel foglio, aperto, con i dati.
  onSave: (values: ChildFormValues) => Promise<void>;
}

// Foglio "Aggiungi un figlio o una figlia" (docs/FLUSSO_GENITORE.md, E): stesso
// foglio in modifica. "Annulla", la X, lo sfondo e il trascinamento chiudono
// senza salvare; "Salva" si blocca finché la scrittura non risponde.
export function ChildSheet({
  child,
  unitOptions,
  parentUnitId,
  firstDay,
  onCancel,
  onSave,
}: ChildSheetProps) {
  const formId = `${useId()}-child`;
  const unitIds = useMemo(() => unitOptions.map((unit) => unit.id), [unitOptions]);
  const [values, setValues] = useState(() => getChildFormInitial(child, parentUnitId, unitIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function handleSubmit() {
    if (savingRef.current) {
      return;
    }

    const problem = validateChildForm(values, { today: new Date(), unitIds });

    if (problem) {
      setError(problem);
      return;
    }

    savingRef.current = true;
    setBusy(true);
    setError(null);

    try {
      await onSave(values);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : CHI_ISCRIVI.erroreSalvataggio);
      savingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      busy={busy}
      closeLabel={CHI_ISCRIVI.chiudiSenzaSalvare}
      footer={
        <div className="flow-foot-actions flow-foot-actions--two">
          <button
            className="button button--ghost button--large"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {CHI_ISCRIVI.annulla}
          </button>
          <button
            className="button button--primary button--large"
            disabled={busy}
            form={formId}
            type="submit"
          >
            {busy ? CHI_ISCRIVI.salvataggio : CHI_ISCRIVI.salva}
          </button>
        </div>
      }
      lead={child ? CHI_ISCRIVI.foglioLeadModifica : CHI_ISCRIVI.foglioLead}
      onClose={onCancel}
      title={
        child
          ? fillCopy(CHI_ISCRIVI.foglioTitoloModifica, { nome: child.firstName || child.fullName })
          : CHI_ISCRIVI.foglioTitolo
      }
    >
      <ChildForm
        disabled={busy}
        error={error}
        firstDay={firstDay}
        formId={formId}
        onChange={(next) => {
          setValues(next);
          setError(null);
        }}
        onSubmit={() => void handleSubmit()}
        parentUnitId={parentUnitId}
        unitOptions={unitOptions}
        values={values}
      />
    </BottomSheet>
  );
}
