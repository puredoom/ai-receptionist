// All user-facing language: localized date formatting and tool-result strings.
// Supported: nl (Dutch/Flemish), fr (French), en (English), de (German).
import { utcToWall } from './slots.js';

export const LANGS = ['nl', 'fr', 'en', 'de'];

const DAYS = {
  nl: { sun: 'zondag', mon: 'maandag', tue: 'dinsdag', wed: 'woensdag', thu: 'donderdag', fri: 'vrijdag', sat: 'zaterdag' },
  fr: { sun: 'dimanche', mon: 'lundi', tue: 'mardi', wed: 'mercredi', thu: 'jeudi', fri: 'vendredi', sat: 'samedi' },
  en: { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' },
  de: { sun: 'Sonntag', mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag', fri: 'Freitag', sat: 'Samstag' },
};

const MONTHS = {
  nl: ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'],
  fr: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
  en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  de: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
};

export function lang(tenant) {
  return LANGS.includes(tenant.language) ? tenant.language : 'nl';
}

export function dayName(dow, l) { return DAYS[l][dow]; }

/** "maandag 14 juli om 09:30" / "lundi 14 juillet à 09:30" / … */
export function formatSlot(ms, timeZone, l) {
  const w = utcToWall(ms, timeZone);
  const hh = String(w.hh).padStart(2, '0');
  const mm = String(w.mm).padStart(2, '0');
  const day = DAYS[l][w.dow];
  const month = MONTHS[l][w.mo - 1];
  switch (l) {
    case 'fr': return `${day} ${w.d} ${month} à ${hh}:${mm}`;
    case 'en': return `${day}, ${month} ${w.d} at ${hh}:${mm}`;
    case 'de': return `${day}, ${w.d}. ${month} um ${hh}:${mm}`;
    default:   return `${day} ${w.d} ${month} om ${hh}:${mm}`;
  }
}

/** Tool-result strings, keyed per language. Values are functions where dynamic. */
const STR = {
  nl: {
    today: (day, iso, hhmm, tz) => `Vandaag is ${day} ${iso}. De tijd is ${hhmm} (${tz}).`,
    available: list => `Beschikbare tijden: ${list}.`,
    noneAtAll: 'Er is de komende periode helaas geen enkele vrije plek in de agenda.',
    noneRequested: alts => `Op het gevraagde moment is er niets vrij. Dichtstbijzijnde opties: ${alts}.`,
    errMissing: 'FOUT: naam, datum (JJJJ-MM-DD) en tijd (UU:MM) zijn verplicht om te boeken.',
    errFormat: 'FOUT: datum of tijd heeft een ongeldig formaat. Gebruik JJJJ-MM-DD en UU:MM.',
    errTooSoon: 'FOUT: dit tijdstip is te kort dag of ligt in het verleden. Kies een later moment.',
    errOutsideHours: 'FOUT: dit tijdstip valt buiten de openingstijden. Gebruik checkAvailability voor geldige opties.',
    errTaken: 'FOUT: dit tijdstip is zojuist bezet geraakt. Gebruik checkAvailability voor alternatieven.',
    booked: (when, name) => `GELUKT: afspraak bevestigd op ${when} voor ${name}.`,
    errNoMessage: 'FOUT: er is nog geen boodschap om te noteren.',
    messageTaken: 'GELUKT: het bericht is genoteerd. Er wordt zo snel mogelijk teruggebeld.',
    errUnknownTool: name => `FOUT: onbekende functie ${name}.`,
    errNotLinked: 'FOUT: configuratieprobleem, dit nummer is niet gekoppeld. Bied aan een bericht door te geven via het bedrijf zelf.',
    errNoCalendar: 'FOUT: de agenda van dit bedrijf is nog niet gekoppeld aan het systeem. Neem een bericht aan met takeMessage, dat werkt wel.',
    errTechnical: 'FOUT: er ging technisch iets mis. Bied aan een bericht aan te nemen.',
    eventTitle: (name, service) => `Afspraak: ${name}${service ? ` — ${service}` : ''}`,
    eventDesc: { via: 'Geboekt via AI-receptionist.', name: 'Naam', phone: 'Telefoon', service: 'Dienst', notes: 'Notities' },
  },
  fr: {
    today: (day, iso, hhmm, tz) => `Nous sommes aujourd'hui ${day} ${iso}. Il est ${hhmm} (${tz}).`,
    available: list => `Créneaux disponibles : ${list}.`,
    noneAtAll: "Malheureusement, il n'y a aucun créneau libre dans l'agenda pour la période à venir.",
    noneRequested: alts => `Rien n'est libre au moment demandé. Options les plus proches : ${alts}.`,
    errMissing: 'ERREUR : le nom, la date (AAAA-MM-JJ) et l\'heure (HH:MM) sont obligatoires pour réserver.',
    errFormat: 'ERREUR : format de date ou d\'heure invalide. Utilisez AAAA-MM-JJ et HH:MM.',
    errTooSoon: 'ERREUR : ce créneau est trop proche ou déjà passé. Choisissez un moment plus tard.',
    errOutsideHours: 'ERREUR : ce créneau est en dehors des heures d\'ouverture. Utilisez checkAvailability pour des options valides.',
    errTaken: 'ERREUR : ce créneau vient d\'être pris. Utilisez checkAvailability pour des alternatives.',
    booked: (when, name) => `RÉUSSI : rendez-vous confirmé le ${when} pour ${name}.`,
    errNoMessage: 'ERREUR : il n\'y a pas encore de message à noter.',
    messageTaken: 'RÉUSSI : le message a été noté. Vous serez rappelé dès que possible.',
    errUnknownTool: name => `ERREUR : fonction inconnue ${name}.`,
    errNotLinked: 'ERREUR : problème de configuration, ce numéro n\'est pas relié. Proposez de transmettre un message via l\'entreprise elle-même.',
    errNoCalendar: 'ERREUR : l\'agenda de cette entreprise n\'est pas encore connecté. Prenez un message avec takeMessage, cela fonctionne.',
    errTechnical: 'ERREUR : un problème technique est survenu. Proposez de prendre un message.',
    eventTitle: (name, service) => `Rendez-vous : ${name}${service ? ` — ${service}` : ''}`,
    eventDesc: { via: 'Réservé via le réceptionniste IA.', name: 'Nom', phone: 'Téléphone', service: 'Service', notes: 'Notes' },
  },
  en: {
    today: (day, iso, hhmm, tz) => `Today is ${day} ${iso}. The time is ${hhmm} (${tz}).`,
    available: list => `Available times: ${list}.`,
    noneAtAll: 'Unfortunately there are no free slots in the agenda for the coming period.',
    noneRequested: alts => `Nothing is free at the requested moment. Nearest options: ${alts}.`,
    errMissing: 'ERROR: name, date (YYYY-MM-DD) and time (HH:MM) are required to book.',
    errFormat: 'ERROR: invalid date or time format. Use YYYY-MM-DD and HH:MM.',
    errTooSoon: 'ERROR: this time is too soon or in the past. Pick a later moment.',
    errOutsideHours: 'ERROR: this time is outside opening hours. Use checkAvailability for valid options.',
    errTaken: 'ERROR: this slot was just taken. Use checkAvailability for alternatives.',
    booked: (when, name) => `SUCCESS: appointment confirmed on ${when} for ${name}.`,
    errNoMessage: 'ERROR: there is no message to record yet.',
    messageTaken: 'SUCCESS: the message has been recorded. Someone will call back as soon as possible.',
    errUnknownTool: name => `ERROR: unknown function ${name}.`,
    errNotLinked: 'ERROR: configuration problem, this number is not linked. Offer to pass on a message via the business itself.',
    errNoCalendar: 'ERROR: this business\'s calendar is not connected yet. Take a message with takeMessage instead — that works.',
    errTechnical: 'ERROR: something went wrong technically. Offer to take a message.',
    eventTitle: (name, service) => `Appointment: ${name}${service ? ` — ${service}` : ''}`,
    eventDesc: { via: 'Booked via AI receptionist.', name: 'Name', phone: 'Phone', service: 'Service', notes: 'Notes' },
  },
  de: {
    today: (day, iso, hhmm, tz) => `Heute ist ${day}, der ${iso}. Es ist ${hhmm} Uhr (${tz}).`,
    available: list => `Verfügbare Termine: ${list}.`,
    noneAtAll: 'Leider gibt es im kommenden Zeitraum keinen einzigen freien Termin im Kalender.',
    noneRequested: alts => `Zum gewünschten Zeitpunkt ist nichts frei. Nächstgelegene Optionen: ${alts}.`,
    errMissing: 'FEHLER: Name, Datum (JJJJ-MM-TT) und Uhrzeit (HH:MM) sind für die Buchung erforderlich.',
    errFormat: 'FEHLER: Datum oder Uhrzeit hat ein ungültiges Format. Verwenden Sie JJJJ-MM-TT und HH:MM.',
    errTooSoon: 'FEHLER: dieser Termin ist zu kurzfristig oder liegt in der Vergangenheit. Wählen Sie einen späteren Zeitpunkt.',
    errOutsideHours: 'FEHLER: dieser Termin liegt außerhalb der Öffnungszeiten. Nutzen Sie checkAvailability für gültige Optionen.',
    errTaken: 'FEHLER: dieser Termin wurde soeben vergeben. Nutzen Sie checkAvailability für Alternativen.',
    booked: (when, name) => `ERFOLG: Termin bestätigt am ${when} für ${name}.`,
    errNoMessage: 'FEHLER: es gibt noch keine Nachricht zu notieren.',
    messageTaken: 'ERFOLG: die Nachricht wurde notiert. Sie werden so bald wie möglich zurückgerufen.',
    errUnknownTool: name => `FEHLER: unbekannte Funktion ${name}.`,
    errNotLinked: 'FEHLER: Konfigurationsproblem, diese Nummer ist nicht verknüpft. Bieten Sie an, eine Nachricht über das Unternehmen selbst weiterzugeben.',
    errNoCalendar: 'FEHLER: der Kalender dieses Unternehmens ist noch nicht verbunden. Nehmen Sie stattdessen eine Nachricht mit takeMessage auf — das funktioniert.',
    errTechnical: 'FEHLER: es ist ein technisches Problem aufgetreten. Bieten Sie an, eine Nachricht aufzunehmen.',
    eventTitle: (name, service) => `Termin: ${name}${service ? ` — ${service}` : ''}`,
    eventDesc: { via: 'Gebucht über KI-Rezeptionist.', name: 'Name', phone: 'Telefon', service: 'Leistung', notes: 'Notizen' },
  },
};

export function str(l) { return STR[l] || STR.nl; }
