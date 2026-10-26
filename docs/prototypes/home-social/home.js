// Isolated synthetic prototype. No SDK, network writes, analytics or storage.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = new URLSearchParams(location.search).get('state') || 'default';
document.body.dataset.state = state;
const next = $('#next-mobile');
const copy = next.cloneNode(true);
copy.id = 'next-card-desktop';
copy.querySelector('h2').id = 'next-title-desktop';
copy.setAttribute('aria-labelledby', 'next-title-desktop');
$('#next-desktop').append(copy);
let returnFocus = null;
let navigatingBack = false;
const dialogs = [];

function openDialog(dialog, opener) {
  returnFocus = opener || document.activeElement;
  dialogs.push({ dialog, opener: returnFocus });
  dialog.showModal();
  document.body.classList.add('modal-open');
  history.pushState({ prototypeDialog: dialog.id }, '');
}
function requestClose(dialog) {
  if (dialog.id === 'viewer' && $('#comment').value.trim()) {
    $('#draft-actions').classList.add('visible');
    $('#keep-draft').focus();
    return;
  }
  history.back();
}
function closeTop() {
  const entry = dialogs.pop();
  if (!entry) return;
  entry.dialog.close();
  if (!dialogs.length) document.body.classList.remove('modal-open');
  entry.opener?.focus({ preventScroll: true });
}
window.addEventListener('popstate', () => {
  if (!dialogs.length) return;
  const top = dialogs.at(-1).dialog;
  if (top.id === 'viewer' && $('#comment').value.trim() && !navigatingBack) {
    history.pushState({ prototypeDialog: 'viewer' }, '');
    $('#draft-actions').classList.add('visible');
    $('#keep-draft').focus();
    return;
  }
  navigatingBack = false;
  closeTop();
});
$$('dialog').forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); requestClose(dialog); });
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => requestClose(dialog)));
});
$$('[data-photo]').forEach((button) => button.addEventListener('click', () => openDialog($('#viewer'), button)));
$$('[data-detail]').forEach((button) => button.addEventListener('click', () => {
  $('#detail-title').textContent = button.dataset.detail;
  $('#detail-body').textContent = button.dataset.detail === 'Una sera insieme' ? '7 novembre · 18:30 · Centro delle Colline. Iscrizione sintetica confermata.' : `Ingresso a ${button.dataset.detail}.`;
  openDialog($('#detail'), button);
}));
$$('[data-upload]').forEach((button) => button.addEventListener('click', () => {
  $('#detail-title').textContent = 'Aggiungi foto o video';
  $('#detail-body').textContent = 'Nel prodotto questo controllo apre il selettore del telefono e la coda della galleria. In questa anteprima non vengono letti file.';
  openDialog($('#detail'), button);
}));
$$('.like').forEach((button) => button.addEventListener('click', () => {
  if (state === 'offline') return;
  const wasLiked = button.getAttribute('aria-pressed') === 'true';
  button.setAttribute('aria-pressed', String(!wasLiked));
  button.querySelector('span').textContent = wasLiked ? 'Mi piace' : 'Ti piace';
  button.querySelector('b').textContent = Number(button.dataset.count) + (wasLiked ? 0 : 1);
}));
$$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  $$('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  $$('[data-type]').forEach((post) => { post.hidden = button.dataset.filter !== 'all' && button.dataset.filter !== post.dataset.type; });
}));
$('#report-open').addEventListener('click', (event) => openDialog($('#report'), event.currentTarget));
$('#discard-draft').addEventListener('click', () => { $('#comment').value = ''; $('#draft-actions').classList.remove('visible'); navigatingBack = true; history.back(); });
$('#keep-draft').addEventListener('click', () => { $('#draft-actions').classList.remove('visible'); $('#comment').focus(); });
$('#comment-info').addEventListener('click', () => { $('#comment-status').textContent = 'È una demo: la bozza resta qui e non viene inviata.'; });

const content = $('#feed-content');
const stateCard = (title, text, action = '') => `<div class="state-card"><h3>${title}</h3><p>${text}</p>${action}</div>`;
if (state === 'loading') content.innerHTML = '<div class="state-card" role="status" aria-label="Caricamento delle novità"><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton photo"></div><p>Sto caricando le novità…</p></div>';
if (state === 'empty') content.innerHTML = stateCard('Qui arriveranno le novità delle attività', 'Intanto puoi scoprire le prossime attività.') .replace('<h3>', '<img src="../../../src/assets/flusso-genitore/giovani.webp" alt=""><h3>');
if (state === 'error') content.innerHTML = stateCard('Non riusciamo a caricare le novità', 'Controlla la connessione e riprova.', '<button onclick="location.search=\'\'">Riprova</button>');
if (state === 'pending') { $('#status').innerHTML = '<div class="status-banner"><strong>Appartenenza in verifica</strong>Il feed e le foto saranno disponibili dopo la conferma. Puoi ancora vedere le attività pubbliche.</div>'; content.innerHTML = stateCard('Le novità del tuo palo', 'Le vedrai quando la tua appartenenza sarà confermata.'); }
if (state === 'offline') { $('#status').innerHTML = '<div class="status-banner"><strong>Sei offline</strong>Anteprima dei contenuti già caricati. Riconnettiti per interagire.</div>'; $$('.like, [data-upload], #comment-info, #report-open').forEach((button) => {button.disabled = true;}); }
if (state === 'closed') { $$('.upload').forEach((button) => {button.hidden = true;}); $('.upload-row>span').innerHTML = 'Caricamenti chiusi · le foto restano disponibili'; }
if (state === 'none') { next.innerHTML = '<div class="next-content"><h2>Nessuna attività in evidenza</h2><p>Le prossime attività saranno qui.</p></div>'; copy.innerHTML = next.innerHTML; }
if (state === 'awaiting') { $$('.next-card').forEach((card) => { card.querySelector('.enrolled').textContent = 'In attesa del genitore'; card.querySelector('.next-content>p').innerHTML += '<br><strong>In attesa del genitore</strong>'; }); }
if (state === 'live') { $('#live-card').hidden = false; $('.gallery-post').hidden = true; }
if (['pending', 'loading', 'empty', 'error'].includes(state)) $$('.filters button').forEach((button) => {button.disabled = true;});
