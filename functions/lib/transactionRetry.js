// Due transazioni sullo stesso doc (due segnalazioni, due azioni dello staff
// insieme): Firestore fa perdere una delle due, che l'SDK ritenta solo se il
// codice è ABORTED. L'emulatore risponde invece INVALID_ARGUMENT "Transaction
// is invalid or closed": si ritenta anche quello, poche volte, e l'altra
// lettura vede lo stato vincente.
async function runTransactionWithRetry(db, fn, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.runTransaction(fn);
    } catch (error) {
      const retryable =
        error?.code === 10 ||
        (error?.code === 3 && /transaction is invalid or closed/i.test(String(error?.details ?? error?.message)));
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt + Math.floor(Math.random() * 150)));
    }
  }
}

module.exports = { runTransactionWithRetry };
