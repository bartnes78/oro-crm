const VALID_PHASES    = ['Prospekt','Aktiv dialog','Investor','Tidligere investor','På vent'];
const VALID_TYPES     = ['Pensjon','Stiftelse','Family Office','Forsikring','Institusjonell','Pensjonskasse','Private Banking','Rådgiver','Annet'];
const VALID_LOG_TYPES = ['Møte','Telefon','Tapt anrop','E-post mottatt','E-post sendt','Event','Video','Annet','Notat'];
const VALID_LEADS     = ['Kristian Bartnes','Anders Brustad-Nilsen','Nikolai Staubo','Anders Aasand','Gunnar Vestby','Ekstern'];
const VALID_VEHICLES  = ['IS','Feeder','Ikke avklart'];

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

module.exports = {
  VALID_PHASES, VALID_TYPES, VALID_LOG_TYPES, VALID_LEADS, VALID_VEHICLES,
  isValidDate,
};
