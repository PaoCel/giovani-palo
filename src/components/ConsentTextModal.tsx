import { AppModal } from "@/components/AppModal";

export type ConsentKind = "parental" | "photo";

interface ConsentTextModalProps {
  kind: ConsentKind;
  onClose: () => void;
  onDownload?: () => void;
  downloadBusy?: boolean;
}

export function ConsentTextModal({
  kind,
  onClose,
  onDownload,
  downloadBusy,
}: ConsentTextModalProps) {
  const title =
    kind === "parental"
      ? "Consenso e informazioni mediche - permesso del genitore o tutore"
      : "Liberatoria per l'uso delle immagini";

  return (
    <AppModal
      onClose={onClose}
      size="compact"
      subtitle="Testo completo del documento"
      title={title}
    >
      <div className="consent-text-modal">
        {kind === "parental" ? <ParentalConsentText /> : <PhotoReleaseText />}
      </div>

      <div className="inline-actions" style={{ marginTop: "1rem" }}>
        {onDownload ? (
          <button
            className="button button--ghost"
            disabled={downloadBusy}
            onClick={onDownload}
            type="button"
          >
            {downloadBusy ? "Generazione PDF..." : "Scarica PDF compilato"}
          </button>
        ) : null}
        <button className="button button--primary" onClick={onClose} type="button">
          Ho letto, chiudi
        </button>
      </div>
    </AppModal>
  );
}

function ParentalConsentText() {
  return (
    <>
      <p>
        Questo modulo riprende i contenuti del documento ufficiale della Chiesa
        di Gesu Cristo dei Santi degli Ultimi Giorni "Consenso e informazioni
        mediche" (versione 3/25), richiesto per gli eventi che prevedono
        pernottamento, viaggi al di fuori della propria zona o rischi superiori
        al normale (Manuale generale 20.5.5, 20.7.4, 20.7.7).
      </p>

      <h4>Cosa autorizzo come genitore o tutore</h4>
      <p>
        Concedo a mio figlio o a chi sono tutore il permesso di partecipare
        all'evento e alle attivita previste e autorizzo i dirigenti adulti che
        supervisionano l'evento a somministrare il trattamento di emergenza al
        partecipante in caso di incidenti o malattie e ad agire in mia vece
        nell'approvare le necessarie cure mediche. L'autorizzazione vale anche
        per il viaggio da/per l'evento.
      </p>

      <h4>Informazioni mediche</h4>
      <p>
        Le indicazioni inserite in fase di iscrizione (allergie, restrizioni
        alimentari, farmaci, condizioni di salute, note utili) saranno
        consultate solo dai dirigenti dell'evento o dal personale medico, se
        necessario, per intervenire in modo appropriato. Saranno trattate con
        riservatezza.
      </p>

      <h4>Limiti e responsabilita</h4>
      <p>
        Comprendo che le unita potrebbero non poter soddisfare ogni esigenza
        medica, fisica o di altro tipo: i dirigenti si confronteranno con me se
        servono accorgimenti specifici. Riconosco che il partecipante e
        responsabile della propria condotta e si attiene alle norme della
        Chiesa, alle regole di sicurezza dell'evento e alle indicazioni dei
        dirigenti. Comprendo inoltre che la partecipazione e un privilegio che
        puo essere revocato in caso di comportamento inappropriato o di rischio
        per se stesso o per gli altri.
      </p>

      <h4>Firma</h4>
      <p>
        Confermando il consenso e firmando con la firma digitale (o caricando
        eventualmente una foto del modulo cartaceo), dichiaro di aver letto e
        compreso il documento. Posso scaricare il PDF compilato in qualsiasi
        momento dalla scheda dell'iscrizione.
      </p>
    </>
  );
}

function PhotoReleaseText() {
  return (
    <>
      <p>
        Questo modulo riprende i contenuti della "Liberatoria per l'uso delle
        immagini" della Chiesa di Gesu Cristo dei Santi degli Ultimi Giorni
        (Intellectual Reserve, Inc. - IRI), che disciplina l'uso delle immagini
        del partecipante in materiali della Chiesa.
      </p>

      <h4>Cosa autorizzo</h4>
      <p>
        Concedo irrevocabilmente all'IRI e ai suoi licenziatari, successori e
        aventi diritto il consenso e i pieni diritti di registrare, copiare,
        riprodurre, adattare, pubblicare, esibire, distribuire ed eseguire le
        immagini, le interviste e qualsiasi materiale reso disponibile, in
        qualsiasi pubblicazione o mezzo (libri, riviste, internet, video,
        televisione, cinema), con o senza credito.
      </p>

      <h4>Per i minori</h4>
      <p>
        Se il partecipante e minorenne, il genitore o tutore dichiara di avere
        la piena autorita per perfezionare la liberatoria a nome del minore e
        firma per suo conto.
      </p>

      <h4>Diritti d'autore e responsabilita</h4>
      <p>
        Il concedente non avra diritto, titolo o interesse in alcuna opera o
        pubblicazione realizzata dall'IRI in virtu di questa liberatoria. Tutte
        le condizioni complete (incluse le informazioni sulla legge
        applicabile - Stato dello Utah - e sulle controversie) sono riportate
        nel testo originale del modulo IRI 37077 160.
      </p>

      <h4>Firma</h4>
      <p>
        Confermando la liberatoria e firmando con la firma digitale, dichiaro
        di aver letto e compreso il documento. Posso scaricare il PDF compilato
        in qualsiasi momento dalla scheda dell'iscrizione.
      </p>
    </>
  );
}
