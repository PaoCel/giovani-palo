import { useEffect, useId, useMemo, useRef, type FormEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import { CHI_ISCRIVI } from "@/copy/chiIscrivi";
import type { Unit } from "@/types";
import {
  getChildAgeWarning,
  getChildAgeWarningText,
  type ChildFormValues,
} from "@/utils/childChoice";
import { BIRTH_DATE_MIN, toCalendarDateValue } from "@/utils/profileCompletion";

import "@/styles/registerFlow.css";

const GROUPS = [
  { value: "giovane_uomo", label: CHI_ISCRIVI.giovaneUomo },
  { value: "giovane_donna", label: CHI_ISCRIVI.giovaneDonna },
] as const;

export interface ChildUnitOption {
  id: string;
  name: string;
}

// Unità attive del palo, più quella già salvata sul figlio se nel frattempo
// non è più in elenco (in modifica non deve sparire dal campo).
export function getChildUnitOptions(
  units: ReadonlyArray<Pick<Unit, "id" | "name">>,
  current?: { unitId: string; unitName: string } | null,
): ChildUnitOption[] {
  const options = units.map((unit) => ({ id: unit.id, name: unit.name }));

  if (current?.unitId && !options.some((option) => option.id === current.unitId)) {
    return [{ id: current.unitId, name: current.unitName || current.unitId }, ...options];
  }

  return options;
}

interface ChildFormProps {
  formId: string;
  values: ChildFormValues;
  onChange: (values: ChildFormValues) => void;
  onSubmit: () => void;
  unitOptions: ReadonlyArray<ChildUnitOption>;
  // "come la tua" accanto all'unità quando coincide con quella del genitore.
  parentUnitId: string;
  // Primo giorno dell'attività: gli avvisi sull'età valgono per quel giorno.
  firstDay: Date;
  disabled?: boolean;
  error?: string | null;
}

// Nome, Cognome, Data di nascita, Gruppo, Unità (docs/FLUSSO_GENITORE.md, E).
// Stesso modulo nel foglio "Aggiungi" e nella pagina senza figli. Non scrive
// nulla: il salvataggio lo fa chi lo usa, solo con "Salva".
export function ChildForm({
  formId,
  values,
  onChange,
  onSubmit,
  unitOptions,
  parentUnitId,
  firstDay,
  disabled = false,
  error,
}: ChildFormProps) {
  const ids = useId();
  const errorRef = useRef<HTMLDivElement | null>(null);
  const today = useMemo(() => new Date(), []);
  const todayValue = toCalendarDateValue(today);
  const hasUnits = unitOptions.length > 0;
  const warning = getChildAgeWarning(values.birthDate, firstDay);
  const warningText =
    warning === "maggiorenne" && !values.firstName.trim()
      ? null
      : getChildAgeWarningText(warning, {
          firstName: values.firstName.trim(),
          fullName: "",
          genderRoleCategory: values.genderRoleCategory,
        });

  // L'errore arriva dopo il tocco sul pulsante in fondo: va in vista.
  useEffect(() => {
    if (!error) {
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    errorRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [error]);

  function update<K extends keyof ChildFormValues>(key: K, value: ChildFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!disabled) {
      onSubmit();
    }
  }

  return (
    <form className="auth-panel__form child-form" id={formId} noValidate onSubmit={handleSubmit}>
      <fieldset className="child-form__fields" disabled={disabled}>
        <div className="flow-name-row">
          <label className="field">
            <span>{CHI_ISCRIVI.nome}</span>
            <input
              autoCapitalize="words"
              autoComplete="off"
              className="input"
              placeholder={CHI_ISCRIVI.nome}
              value={values.firstName}
              onChange={(event) => update("firstName", event.target.value)}
            />
          </label>
          <label className="field">
            <span>{CHI_ISCRIVI.cognome}</span>
            <input
              autoCapitalize="words"
              autoComplete="off"
              className="input"
              placeholder={CHI_ISCRIVI.cognome}
              value={values.lastName}
              onChange={(event) => update("lastName", event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>{CHI_ISCRIVI.dataNascita}</span>
          <input
            aria-describedby={warningText ? `${ids}-age` : undefined}
            className="input"
            max={todayValue}
            min={BIRTH_DATE_MIN}
            type="date"
            value={values.birthDate}
            onChange={(event) => update("birthDate", event.target.value)}
          />
          {warningText ? (
            <small className="child-form__warning" id={`${ids}-age`}>
              {warningText}
            </small>
          ) : null}
        </label>

        <fieldset className="flow-pills">
          <legend>{CHI_ISCRIVI.gruppo}</legend>
          <div className="flow-pills__options">
            {GROUPS.map((group) => {
              const selected = values.genderRoleCategory === group.value;
              return (
                <label
                  className={selected ? "flow-pill flow-pill--selected" : "flow-pill"}
                  key={group.value}
                >
                  <input
                    checked={selected}
                    name={`${ids}-gruppo`}
                    onChange={() => update("genderRoleCategory", group.value)}
                    type="radio"
                    value={group.value}
                  />
                  {selected ? <AppIcon name="check" /> : null}
                  <span>{group.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="field">
          <span>{CHI_ISCRIVI.unita}</span>
          <span className="child-form__unit">
            <select
              className="input"
              disabled={!hasUnits}
              value={hasUnits ? values.unitId : ""}
              onChange={(event) => update("unitId", event.target.value)}
            >
              <option value="">{hasUnits ? CHI_ISCRIVI.selezionaUnita : CHI_ISCRIVI.nessunaUnita}</option>
              {unitOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            {parentUnitId && values.unitId === parentUnitId ? (
              <span aria-hidden="true" className="child-form__same">
                {CHI_ISCRIVI.comeLaTua}
              </span>
            ) : null}
          </span>
        </label>
      </fieldset>

      {error ? (
        <div className="auth-panel__message" ref={errorRef}>
          <div className="form-error" role="alert">
            {error}
          </div>
        </div>
      ) : null}
    </form>
  );
}
