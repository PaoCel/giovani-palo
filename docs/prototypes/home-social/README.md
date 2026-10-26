# Prototipo Home giovani

Solo anteprima della [spec](../../HOME_SOCIAL.md), nessun collegamento a Firebase.
Aprire `index.html` con un server statico dalla radice del repository; le
immagini di brand riusano i file già versionati. Non è una route dell'app.

Parametri `?state=`: `loading`, `empty`, `error`, `pending`, `offline`,
`closed`, `none`, `awaiting`, `live` (attività in corso senza post album). Senza parametro: membro attivo, attività
confermata, galleria aperta. I filtri operano sulle due card sintetiche.
Mi piace è reversibile e locale; il visualizzatore dimostra ritorno del focus,
chiusura con Back/Esc e bozza da conservare/scartare. Invio commenti, upload,
segnalazioni e iscrizioni restano destinazioni dichiarate, senza operazioni.

Asset `assets/pomeriggio.webp`: fotografia interamente sintetica generata con
lo strumento integrato ImageGen il 26 ottobre 2026, ottimizzata sul Mac mini
con cwebp (larghezza 1100, qualità 82). Nessuna foto di utenti o galleria di
produzione. Logo e `giovani.webp`: asset esistenti nel repository.

Prompt originale:

> Use case: photorealistic-natural. Asset type: entirely synthetic demo gallery
> photo for an Italian youth community app design prototype, no real people
> or source photos. Primary request: warm candid photograph of a fictional
> group of six young adults aged 18-22 having an informal outdoor table
> football game in a community courtyard in Italy, relaxed shared laughter,
> autumn afternoon. Everyone modest casual clothes, varied faces,
> spontaneous imperfect real phone camera composition, blue and warm sand
> color accents. Wide landscape 3:2 photo, group at middle distance, no text,
> no logos, no watermark, no interface, no collage. This image is mock data,
> not evidence of a real event.

I PNG finali, l'originale generato, lo script e il report di QA stanno nella
cartella locale persistente `.claude/mockups/home-social/`, ignorata da git.
Il verbale versionato delle verifiche è in [HOME_SOCIAL_REVIEW.md](../../HOME_SOCIAL_REVIEW.md).
