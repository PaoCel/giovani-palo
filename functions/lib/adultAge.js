// Maggiorenne alla data `now`, da una data di nascita `YYYY-MM-DD`. Una data
// assente o malformata non è maggiorenne. La categoria dichiarata nel profilo o
// nell'iscrizione la scrive chiunque: dove serve distinguere gli adulti si
// controlla anche l'età.
function isAdultByAge(birthDate, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof birthDate === "string" ? birthDate : "");
  if (!match) return false;
  const adultFrom = Date.UTC(Number(match[1]) + 18, Number(match[2]) - 1, Number(match[3]));
  return adultFrom <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

module.exports = { isAdultByAge };
