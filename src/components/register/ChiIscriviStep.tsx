import { useEffect, useId, useRef } from "react";

import { AppIcon } from "@/components/AppIcon";
import { ChildForm, type ChildUnitOption } from "@/components/register/ChildForm";
import { CHI_ISCRIVI } from "@/copy/chiIscrivi";
import { fillCopy } from "@/copy/parole";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import type { ChildProfile } from "@/types";
import {
  describeAgeAtActivity,
  getAvatarTone,
  getBlockedReasonText,
  getChildAgeWarning,
  getChildAgeWarningText,
  getInitials,
  getRegisteredLabel,
  type ChildChoiceState,
  type ChildFormValues,
} from "@/utils/childChoice";

import "@/styles/registerFlow.css";

export interface ChiIscriviEntry {
  child: ChildProfile;
  state: ChildChoiceState;
}

interface InlineChildForm {
  values: ChildFormValues;
  onChange: (values: ChildFormValues) => void;
  onSubmit: () => void;
  unitOptions: ReadonlyArray<ChildUnitOption>;
  parentUnitId: string;
  error: string | null;
  busy: boolean;
}

interface ChiIscriviStepProps {
  eventTitle: string;
  entries: ReadonlyArray<ChiIscriviEntry>;
  firstDay: Date;
  selectedId: string | null;
  onSelect: (childId: string) => void;
  // "Già iscritto · Apri": la sua iscrizione, mai un doppione.
  onOpen: (childId: string) => void;
  onEdit: (child: ChildProfile) => void;
  onAdd: () => void;
  onContinue: () => void;
  // Senza figli salvati il modulo di aggiunta è già aperto nella pagina.
  inlineForm?: InlineChildForm | null;
  // Iscrizioni chiuse: restano "Già iscritto · Apri" e la matita, niente
  // scelta, niente "Aggiungi" né "Continua" (porterebbero a un modulo chiuso).
  closed?: boolean;
  busy?: boolean;
}

function childName(child: ChildProfile) {
  return child.fullName || `${child.firstName} ${child.lastName}`.trim() || child.firstName;
}

// "Chi iscrivi?" (docs/FLUSSO_GENITORE.md, E): una scheda per figlio con età e
// unità, "Già iscritto · Apri", i non selezionabili col motivo, gli avvisi
// morbidi sull'età e la matita che apre il foglio in modifica.
export function ChiIscriviStep({
  eventTitle,
  entries,
  firstDay,
  selectedId,
  onSelect,
  onOpen,
  onEdit,
  onAdd,
  onContinue,
  inlineForm = null,
  closed = false,
  busy = false,
}: ChiIscriviStepProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const formId = `${ids}-form`;
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const keyboardOpen = useKeyboardOpen();
  const selected = entries.find(
    (entry) => entry.child.id === selectedId && entry.state.kind === "selectable",
  );

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section aria-labelledby={titleId} className="auth-screen chi-iscrivi">
      <div className="auth-screen__copy">
        <h1 className="auth-screen__title" id={titleId} ref={titleRef} tabIndex={-1}>
          {CHI_ISCRIVI.titolo}
        </h1>
        {inlineForm ? (
          <p className="auth-screen__lead">{CHI_ISCRIVI.leadPrimo}</p>
        ) : entries.length > 0 && !closed ? (
          <p className="auth-screen__lead">{fillCopy(CHI_ISCRIVI.lead, { attivita: eventTitle })}</p>
        ) : null}
      </div>

      {inlineForm ? (
        <ChildForm
          disabled={inlineForm.busy}
          error={inlineForm.error}
          firstDay={firstDay}
          formId={formId}
          onChange={inlineForm.onChange}
          onSubmit={inlineForm.onSubmit}
          parentUnitId={inlineForm.parentUnitId}
          unitOptions={inlineForm.unitOptions}
          values={inlineForm.values}
        />
      ) : (
        <>
          <ul className="kid-list">
            {entries.map(({ child, state }) => {
              const name = childName(child);
              const tone = getAvatarTone(name);
              const ageLine = describeAgeAtActivity(child.birthDate, firstDay);
              const detail = [ageLine, child.unitName].filter(Boolean).join(" · ");
              const isSelected = !closed && state.kind === "selectable" && child.id === selectedId;
              const warning =
                state.kind === "selectable"
                  ? getChildAgeWarningText(getChildAgeWarning(child.birthDate, firstDay), child)
                  : null;
              const avatar = (
                <span aria-hidden="true" className={`kid-avatar kid-avatar--${tone}`}>
                  {getInitials(name)}
                </span>
              );

              if (state.kind === "registered") {
                return (
                  <li className="kid-card kid-card--registered" key={child.id}>
                    <div className="kid-card__main kid-card__main--static">
                      {avatar}
                      <span className="kid-card__text">
                        <strong>{name}</strong>
                        <span className="kid-tag kid-tag--ok">
                          <AppIcon name="check" />
                          {getRegisteredLabel(child)}
                        </span>
                      </span>
                    </div>
                    <button
                      aria-label={fillCopy(CHI_ISCRIVI.apriIscrizioneDi, { nome: name })}
                      className="kid-card__open"
                      disabled={busy}
                      onClick={() => onOpen(child.id)}
                      type="button"
                    >
                      {CHI_ISCRIVI.apri}
                    </button>
                  </li>
                );
              }

              const blocked = state.kind === "blocked" || closed;

              return (
                <li
                  className={[
                    "kid-card",
                    isSelected ? "kid-card--selected" : "",
                    blocked ? "kid-card--blocked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={child.id}
                >
                  <button
                    aria-disabled={blocked || undefined}
                    aria-pressed={blocked ? undefined : isSelected}
                    className="kid-card__main"
                    disabled={busy}
                    onClick={() => {
                      if (!blocked) {
                        onSelect(child.id);
                      }
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" className="kid-radio">
                      {isSelected ? <AppIcon name="check" /> : null}
                    </span>
                    {avatar}
                    <span className="kid-card__text">
                      <strong>{name}</strong>
                      {detail ? <span>{detail}</span> : null}
                      {state.kind === "blocked" ? (
                        <em className="kid-card__reason">{getBlockedReasonText(state.reason)}</em>
                      ) : warning && !closed ? (
                        <em className="kid-card__warning">{warning}</em>
                      ) : null}
                    </span>
                  </button>
                  <button
                    aria-label={fillCopy(CHI_ISCRIVI.modificaDi, { nome: name })}
                    className="kid-card__edit"
                    disabled={busy}
                    onClick={() => onEdit(child)}
                    type="button"
                  >
                    <AppIcon name="pencil" />
                  </button>
                </li>
              );
            })}
          </ul>

          {closed ? null : (
            <button className="kid-add" disabled={busy} onClick={onAdd} type="button">
              <AppIcon name="plus" />
              <span>{CHI_ISCRIVI.aggiungiFiglio}</span>
            </button>
          )}
        </>
      )}

      {closed && !inlineForm ? null : (
      <div className={keyboardOpen ? "auth-foot auth-foot--inline" : "auth-foot"}>
        {inlineForm ? (
          <button
            className="button button--primary button--large"
            disabled={inlineForm.busy}
            form={formId}
            type="submit"
          >
            {inlineForm.busy ? CHI_ISCRIVI.salvataggio : CHI_ISCRIVI.salvaEContinua}
          </button>
        ) : (
          <button
            className="button button--primary button--large"
            disabled={busy || !selected}
            onClick={onContinue}
            type="button"
          >
            {selected
              ? fillCopy(CHI_ISCRIVI.continuaCon, {
                  nome: selected.child.firstName || childName(selected.child),
                })
              : CHI_ISCRIVI.continua}
          </button>
        )}
      </div>
      )}
    </section>
  );
}
