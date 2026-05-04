import { useState } from "react";

interface GalleryUnlockFormProps {
  onUnlock: (code: string) => Promise<{ success: boolean; message?: string }>;
}

export function GalleryUnlockForm({ onUnlock }: GalleryUnlockFormProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Inserisci il codice ricevuto dai responsabili.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await onUnlock(code);
      if (!result.success) {
        setError(result.message || "Codice non valido. Verifica e riprova.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="gallery-unlock-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Codice galleria</span>
        <input
          type="text"
          autoComplete="off"
          inputMode="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Es. GAL-7K29-QPB"
          disabled={submitting}
          required
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button
        type="submit"
        className="button button--primary"
        disabled={submitting}
      >
        {submitting ? "Verifico…" : "Sblocca galleria"}
      </button>
    </form>
  );
}
