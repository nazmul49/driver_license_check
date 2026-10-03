import type en from './en';

const nb: typeof en = {
  app: {
    title: 'Sjekk av førerkort',
    loading: 'Laster ...',
    stepOf: 'Steg {current} av {total}',
    logoAlt: 'Logo for {name}',
  },
  common: {
    continue: 'Fortsett',
    retry: 'Prøv igjen',
  },
  intro: {
    heading: 'Sjekk førerkortet ditt',
    lead: '{name} ber deg ta bilder av førerkortet ditt.',
    whatHappens: 'Dette skjer',
    step1: 'Ta et bilde av forsiden av førerkortet.',
    step2: 'Ta et bilde av baksiden av førerkortet.',
    step3: 'Send bildene. {name} får vite resultatet.',
    privacyTitle: 'Personvern',
    privacy:
      'Bildene sendes over en kryptert forbindelse og behandles automatisk for å lese og kontrollere opplysningene på førerkortet. De lagres kryptert, slettes etter en begrenset periode og brukes ikke til noe annet formål.',
    consent:
      'Jeg samtykker i at bildene av førerkortet mitt behandles for å verifisere førerkortet',
    consentRequired: 'Kryss av i boksen for å fortsette.',
  },
  side: {
    front: 'forsiden',
    back: 'baksiden',
  },
  capture: {
    frontHeading: 'Forsiden av førerkortet',
    backHeading: 'Baksiden av førerkortet',
    instructions: 'Plasser kortet inne i rammen og ta bildet.',
    tipsTitle: 'Tips',
    tipFlat: 'Legg kortet på et flatt underlag.',
    tipGlare: 'Unngå gjenskinn og refleksjoner.',
    tipCorners: 'Sørg for at alle fire hjørnene er synlige.',
    cameraLabel: 'Forhåndsvisning fra kameraet',
    cameraStarting: 'Starter kameraet ...',
    cameraReady: 'Kameraet er klart. Plasser kortet inne i rammen.',
    takePhoto: 'Ta bilde',
    choosePhoto: 'Velg eller ta et bilde',
    cameraDeniedTitle: 'Kameraet er ikke tilgjengelig',
    cameraDenied:
      'Vi fikk ikke tilgang til kameraet. Du kan gi tilgang i innstillingene i nettleseren, eller velge et bilde av førerkortet i stedet.',
    cameraUnsupported:
      'Denne nettleseren kan ikke bruke kameraet her. Velg eller ta et bilde av førerkortet i stedet.',
    tryCameraAgain: 'Prøv kameraet igjen',
    captureFailed: 'Bildet kunne ikke tas. Prøv igjen.',
  },
  review: {
    heading: 'Sjekk bildet',
    alt: 'Bilde av {side} av førerkortet',
    checking: 'Sjekker bildekvaliteten ...',
    looksGood: 'Bildet ser tydelig ut. Sjekk at all tekst er lesbar.',
    warningsTitle: 'Bildet kan være vanskelig å lese:',
    retake: 'Ta nytt bilde',
    usePhoto: 'Bruk dette bildet',
    uploading: 'Laster opp bildet: {percent} %',
    uploadingLabel: 'Fremdrift for opplasting',
    uploaded: 'Bildet er lastet opp.',
  },
  warning: {
    low_resolution: 'Oppløsningen er lav. Gå nærmere kortet.',
    too_dark: 'Bildet er for mørkt. Finn bedre lys.',
    too_bright: 'Bildet er for lyst eller har gjenskinn.',
    blurry: 'Bildet ser uskarpt ut. Hold telefonen stille.',
  },
  upload: {
    failedTitle: 'Opplastingen mislyktes',
    failed: 'Bildet kunne ikke lastes opp. Sjekk tilkoblingen og prøv igjen.',
    tooLarge: 'Bildet er for stort. Ta et nytt bilde.',
    badType: 'Filtypen støttes ikke. Bruk et JPEG-, PNG- eller HEIC-bilde.',
  },
  submit: {
    heading: 'Sender',
    text: 'Sender bildene dine ...',
    failed: 'Bildene kunne ikke sendes. Sjekk tilkoblingen og prøv igjen.',
  },
  done: {
    heading: 'Takk',
    text: 'Takk, du kan gå tilbake til {name}.',
    redirecting: 'Du sendes tilbake om noen sekunder.',
    return: 'Gå tilbake til {name}',
  },
  error: {
    invalidTitle: 'Ugyldig lenke',
    invalid: 'Denne lenken er ikke gyldig. Sjekk at du åpnet hele lenken du fikk.',
    expiredTitle: 'Lenken er utløpt',
    expired: 'Denne lenken er utløpt eller ikke lenger gyldig. Be om en ny lenke.',
    usedTitle: 'Lenken er allerede brukt',
    used: 'Denne lenken er allerede åpnet på en annen enhet. Av sikkerhetshensyn kan den bare brukes én gang. Be om en ny lenke hvis du vil starte på nytt.',
    closedTitle: 'Økten er avsluttet',
    closed: 'Denne økten tar ikke imot flere bilder.',
    genericTitle: 'Noe gikk galt',
    generic: 'Noe gikk galt. Prøv igjen.',
  },
  handoff: {
    heading: 'Fortsett på telefonen',
    text: 'Skann QR-koden med kameraet på telefonen for å ta bildene der. Denne siden går videre av seg selv når du er ferdig.',
    qrAlt: 'QR-kode med lenken til denne siden',
    waiting: 'Venter på telefonen ...',
    thisDevice: 'Fortsett på denne enheten',
  },
};

export default nb;
