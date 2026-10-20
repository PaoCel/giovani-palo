// Esito di un'azione partita da un modale admin: dentro il modale, perché la
// pagina sotto è coperta e inerte. Va nel corpo o nel piede (accanto ai tasti,
// su una riga sua: `.modal-feedback` in base.css).
export function ModalFeedback({
  error,
  info = null,
}: {
  error: string | null;
  info?: string | null;
}) {
  if (!error && !info) {
    return null;
  }

  return (
    <div className="modal-feedback">
      {info ? (
        <p className="form-success" role="status">
          {info}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
