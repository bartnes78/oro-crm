// Onboarding-veiledning: flerstegs modal. Vises automatisk første gang en bruker
// logger inn (localStorage-flagg per bruker), og kan åpnes når som helst fra
// "Veiledning"-knappen i sidebaren.

const SEEN_KEY = 'crm_tutorial_seen';

const STEPS = [
  {
    icon: '👋',
    title: 'Velkommen til ORO CRM',
    body: `Dette er verktøyet for å følge opp investorer gjennom hele livssyklusen —
      fra første prospekt til tegnet investering. Denne veiledningen tar deg raskt
      gjennom de viktigste delene. Du kan når som helst åpne den igjen fra
      <strong>Veiledning</strong> nederst i menyen til venstre.`,
  },
  {
    icon: '◼',
    title: 'Dashboard',
    body: `Startsiden gir deg oversikten: nøkkeltall, pipeline fordelt på faser og de
      viktigste investorene. <strong>Min dag</strong>-panelet samler det du bør ta tak i
      akkurat nå — forfalte oppgaver og investorer det er lenge siden du har vært i kontakt med.`,
  },
  {
    icon: '◈',
    title: 'Investorer',
    body: `Hjertet i systemet. Her finner, filtrerer og søker du deg fram til investorer.
      Klikk deg inn på en investor for å se kontaktpersoner, kontakthistorikk, oppgaver
      og hvilke prosjekter de er koblet til. Bruk søkefeltet nederst i menyen for å hoppe
      rett til en investor.`,
  },
  {
    icon: '✉',
    title: 'Importer fra Outlook',
    body: `Lim inn e-poster fra Outlook, så matcher systemet dem automatisk mot riktig
      investor og kontaktperson og oppretter en logglinje. En rask måte å holde
      kontakthistorikken oppdatert uten manuell punching.`,
  },
  {
    icon: '⏱',
    title: 'Oppfølging',
    body: `Viser investorer sortert etter hvor lenge det er siden siste kontakt, slik at
      ingen faller mellom stolene. Filtrer på fase eller lead-ansvarlig for å se akkurat
      din portefølje. Herfra logger du raskt ny kontakt.`,
  },
  {
    icon: '⬛',
    title: 'Kanban',
    body: `Et visuelt pipeline-brett der investorene ligger i kolonner etter fase —
      Prospekt, Aktiv dialog, Investor og så videre. Dra og slipp for å flytte en investor
      videre i løpet.`,
  },
  {
    icon: '☑',
    title: 'Oppgaver',
    body: `Alle oppgavene dine på ett sted, med forfallsdato og kobling til investor.
      Forfalte oppgaver dukker også opp i «Min dag» på dashbordet, så du alltid vet
      hva som haster.`,
  },
  {
    icon: '📊',
    title: 'Analyse',
    body: `Grafer og rapporter over pipeline, tegnede beløp og aktivitet over tid.
      Bruk det til å se hvordan porteføljen utvikler seg og til å forberede rapportering.`,
  },
  {
    icon: '⚙',
    title: 'Administrasjon',
    body: `Under <strong>Administrasjon</strong> i menyen finner du prosjekter,
      bulkredigering, duplikathåndtering, backup, papirkurv og datakvalitet.
      Noen av disse er kun tilgjengelig for administratorer.`,
  },
  {
    icon: '🐛',
    title: 'Fant du en feil?',
    body: `Bruk den gule knappen nede til høyre for å rapportere feil eller foreslå
      forbedringer — den tar automatisk med et skjermbilde av siden du står på.
      Da er du klar til å ta i bruk CRM-et. Lykke til!`,
  },
];

function renderStep(i) {
  const step = STEPS[i];
  const isLast = i === STEPS.length - 1;
  const isFirst = i === 0;

  const dots = STEPS.map((_, n) =>
    `<span style="width:7px;height:7px;border-radius:50%;background:${n === i ? 'var(--green)' : 'var(--border)'};transition:background .15s"></span>`
  ).join('');

  const body = `
    <div style="text-align:center;padding:8px 4px 4px">
      <div style="font-size:46px;line-height:1;margin-bottom:14px">${step.icon}</div>
      <h3 style="font-size:18px;font-weight:700;color:var(--green);margin-bottom:12px">${step.title}</h3>
      <p style="font-size:14px;line-height:1.6;color:var(--text);max-width:440px;margin:0 auto">${step.body}</p>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;gap:7px;margin-top:22px">${dots}</div>`;

  const footer = `
    <button class="btn btn-ghost" id="tut-skip" style="margin-right:auto">${isLast ? 'Lukk' : 'Hopp over'}</button>
    ${isFirst ? '' : '<button class="btn btn-ghost" id="tut-prev">Forrige</button>'}
    <button class="btn btn-primary" id="tut-next">${isLast ? 'Ferdig' : 'Neste →'}</button>`;

  window.openModal(window.ui.modal(
    `<span style="font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.06em">
      VEILEDNING · ${i + 1} / ${STEPS.length}</span>`,
    body,
    footer,
  ), () => {
    const markSeenAndClose = () => {
      try { localStorage.setItem(window.lsKey(SEEN_KEY), '1'); } catch { /* privat modus e.l. */ }
      window.closeModal();
    };
    document.getElementById('tut-skip').addEventListener('click', markSeenAndClose);
    document.getElementById('tut-prev')?.addEventListener('click', () => renderStep(i - 1));
    document.getElementById('tut-next').addEventListener('click', () => {
      if (isLast) markSeenAndClose();
      else renderStep(i + 1);
    });
  });
}

export function openTutorial() {
  renderStep(0);
}

export function maybeShowTutorialOnFirstLogin() {
  let seen = false;
  try { seen = localStorage.getItem(window.lsKey(SEEN_KEY)) === '1'; } catch { seen = false; }
  if (!seen) openTutorial();
}
