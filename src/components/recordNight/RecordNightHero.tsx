import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import {
  describeRecordNightCountdown,
  formatRecordNightDeadline,
  getRecordNightCountdown,
} from "@/utils/recordNight";

interface RecordNightHeroProps {
  eventTitle: string;
  // "venerdì 16 ottobre" e "venerdì", dall'inizio dell'attività.
  dayLabel: string;
  weekday: string;
}

export function RecordNightHero({ eventTitle, dayLabel, weekday }: RecordNightHeroProps) {
  const kicker = [eventTitle, dayLabel].filter(Boolean).join(" · ");
  const evening = weekday ? `${weekday} sera` : "la sera";

  return (
    <section className="rn-hero">
      {kicker ? (
        <span className="rn-live">
          <i aria-hidden="true" className="rn-led" />
          <span>{kicker}</span>
        </span>
      ) : null}
      <h1 aria-label="Notte dei Record" className="rn-title">
        <span className="rn-title__top">Notte dei</span>
        <span className="rn-title__big" data-text="Record">
          <span>Record</span>
        </span>
      </h1>
      <p className="rn-lede">
        Una prova da un minuto, {evening}. Scegli un record da sfidare o inventane uno tuo.
      </p>
    </section>
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function FlapPair({ value, tick = false }: { value: number; tick?: boolean }) {
  const digits = pad(value).split("");
  return (
    <span className="rn-flap-pair">
      {digits.map((digit, index) => (
        <span
          className={tick && index === digits.length - 1 ? "rn-flap rn-flap--tick" : "rn-flap"}
          key={`${index}-${digit}`}
        >
          <span>{digit}</span>
        </span>
      ))}
    </span>
  );
}

interface RecordNightBoardProps {
  closeAt: Date | null;
  now: Date;
  closed: boolean;
  weekday: string;
}

// Tabellone a palette con il conto alla rovescia alla chiusura delle iscrizioni
// ai record. `role="timer"` non viene annunciato a ogni minuto (aria-live off):
// chi usa uno screen reader legge la frase completa quando ci arriva.
export function RecordNightBoard({ closeAt, now, closed, weekday }: RecordNightBoardProps) {
  const countdown = closeAt && !closed ? getRecordNightCountdown(closeAt, now) : null;

  if (!countdown) {
    return (
      <div className="rn-board rn-board--closed">
        <div className="rn-board__head">
          <span className="rn-board__label">Iscrizioni chiuse</span>
          <i aria-hidden="true" className="rn-led rn-led--off" />
        </div>
        <p className="rn-board__closed">
          <RecordNightIcon name="lock" />
          <span>
            Le iscrizioni ai record sono chiuse. Ci vediamo {weekday ? `${weekday} sera` : "la sera"}.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div aria-live="off" className="rn-board" role="timer">
      <span className="sr-only">
        Le iscrizioni ai record chiudono tra {describeRecordNightCountdown(countdown)}
        {closeAt ? `, ${formatRecordNightDeadline(closeAt)}` : ""}.
      </span>
      <div aria-hidden="true">
        <div className="rn-board__head">
          <span className="rn-board__label">Le iscrizioni chiudono tra</span>
          <i className="rn-led" />
        </div>
        <div className="rn-flaps">
          <div className="rn-flap-group">
            <FlapPair value={countdown.days} />
            <span className="rn-flap-lbl">{countdown.days === 1 ? "giorno" : "giorni"}</span>
          </div>
          <div className="rn-flap-colon">
            <i />
            <i />
          </div>
          <div className="rn-flap-group">
            <FlapPair value={countdown.hours} />
            <span className="rn-flap-lbl">{countdown.hours === 1 ? "ora" : "ore"}</span>
          </div>
          <div className="rn-flap-colon">
            <i />
            <i />
          </div>
          <div className="rn-flap-group">
            <FlapPair tick value={countdown.minutes} />
            <span className="rn-flap-lbl">{countdown.minutes === 1 ? "minuto" : "minuti"}</span>
          </div>
        </div>
        {closeAt ? (
          <div className="rn-board__foot">
            <RecordNightIcon name="clock" />
            {formatRecordNightDeadline(closeAt)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const RULES = [
  "Prima edizione: qualsiasi risultato è un record.",
  "Prove da 60 secondi al massimo.",
  "Al chiuso, con quello che c'è.",
  "Niente cibo o bevande a gara.",
  "Massimo 2 record a testa.",
];

export function RecordNightRules() {
  return (
    <section aria-labelledby="rn-rules-title" className="rn-section">
      <h2 className="rn-h2" id="rn-rules-title">
        Regole in breve
      </h2>
      <ol className="rn-rules">
        {RULES.map((rule, index) => (
          <li className={index === 0 ? "rn-rule rn-rule--lead" : "rn-rule"} key={rule}>
            <b aria-hidden="true">{pad(index + 1)}</b>
            <p>{rule}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
