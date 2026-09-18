import BackButton from "@/components/BackButton";
import HeaderActions from "@/components/HeaderActions";

export const metadata = { title: "Privacy — Bus Roma" };

/**
 * Informativa privacy (art. 13 GDPR).
 *
 * NON è un banner di consenso, ed è deliberato: l'app non usa cookie, non ha
 * analytics e non profila nessuno. Tutto ciò che salva sta nel localStorage
 * del telefono e sono preferenze che l'utente ha chiesto esplicitamente
 * (tema, preferiti, cronologia). Per queste il consenso non è richiesto —
 * Linee guida cookie del Garante, 10 giugno 2021, punto 4.1 — mentre
 * l'informativa lo è sempre.
 *
 * Chiedere un consenso che non serve non è prudenza: è un dark pattern, e il
 * Garante lo ha censurato. Se un domani si aggiunge un analytics, allora
 * servirà un vero banner con opt-in granulare, e questa pagina va riscritta.
 *
 * Il testo è specifico invece che generico di proposito: un'informativa
 * copiaincollata che elenca cookie inesistenti è peggio che non averla,
 * perché dichiara il falso.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <BackButton />
        <HeaderActions />
      </div>

      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-neutral-900">Privacy</h1>
      <p className="mb-5 text-[13px] text-neutral-600">
        In breve: non ci sono cookie, non c&apos;è alcun tracciamento, e niente di
        quello che fai qui esce dal tuo telefono. Sotto il dettaglio, perché
        &laquo;fidati&raquo; non è un&apos;informativa.
      </p>

      <div className="space-y-5 text-[13px] leading-relaxed text-neutral-700">
        {/* Identità del titolare: è il primo dei contenuti obbligatori
            dell'art. 13, e va prima del resto. */}
        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">Chi gestisce l&apos;app</h2>
          <p>
            Bus Roma è un progetto personale di Paolo Pulli, titolare del
            trattamento dei pochi dati descritti qui sotto. Contatti:{" "}
            <a
              href="mailto:paolo.pulli@proton.me"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              paolo.pulli@proton.me
            </a>
            {" "}e{" "}
            <a
              href="https://x.com/codingpao"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              @codingpao
            </a>
            . Non è un servizio ufficiale ATAC né di Roma Capitale.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">Cosa resta sul tuo telefono</h2>
          <p className="mb-2">
            Queste cose sono salvate nella memoria locale del browser, non in un
            cookie e non su un server. Non le vediamo, non le riceviamo, non
            possiamo leggerle:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>le fermate che hai messo nei preferiti e il loro ordine;</li>
            <li>le ultime cinque ricerche, per riproportele;</li>
            <li>la scelta tra tema chiaro e scuro;</li>
            <li>il fatto che hai già chiuso il messaggio di benvenuto e quello del caffè.</li>
          </ul>
          <p className="mt-2">
            Si cancellano tutte svuotando i dati del sito dalle impostazioni del
            browser, o disinstallando l&apos;app se l&apos;hai aggiunta alla schermata
            home.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">Le notifiche</h2>
          <p>
            Se tocchi la campanella per farti avvisare all&apos;arrivo di un mezzo, il
            browser genera un indirizzo di recapito anonimo e lo salviamo sul
            server insieme alla fermata e alla corsa che hai scelto. Serve a
            mandarti quella notifica e a nient&apos;altro. La riga viene{" "}
            <strong>cancellata appena la notifica è partita</strong>, e in ogni caso
            entro due ore. Non contiene il tuo nome, la tua email o il tuo numero:
            se revochi il permesso dalle impostazioni del browser, l&apos;indirizzo
            diventa inutilizzabile.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">La posizione</h2>
          <p>
            Viene chiesta solo se tocchi &laquo;usa la mia posizione&raquo; per
            vedere le fermate vicine o calcolare un percorso. Le coordinate vengono
            usate per quella singola richiesta e non vengono salvate da nessuna
            parte, né sul telefono né sul server.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">Chi altro viene contattato</h2>
          <p className="mb-2">
            Quando apri una mappa, il tuo browser scarica le immagini della mappa
            direttamente da <strong>OpenStreetMap</strong>, che in quel momento vede
            il tuo indirizzo IP come lo vedrebbe qualunque sito visitassi. È
            necessario per disegnare la mappa e succede solo nelle pagine che ne
            hanno una.
          </p>
          <p>
            Gli orari e le posizioni dei mezzi vengono da{" "}
            <strong>Roma Servizi per la Mobilità</strong> (ATAC, Roma TPL), ma li
            scarica il nostro server, non il tuo telefono: verso di loro non passa
            nulla di tuo. I caratteri tipografici sono ospitati da noi, quindi non
            parte nessuna richiesta a Google.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">Cosa non facciamo</h2>
          <p>
            Non c&apos;è Google Analytics né alcun altro sistema di statistiche.
            Non ci sono pixel di tracciamento, pubblicità, profilazione o
            condivisione di dati con terzi. Non c&apos;è un account da creare,
            quindi non c&apos;è un profilo a cui collegare quello che fai.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-bold text-neutral-900">I tuoi diritti</h2>
          <p className="mb-2">
            Il GDPR ti dà diritto di accedere ai tuoi dati, correggerli e
            cancellarli. In pratica, qui: i dati stanno sul tuo telefono e li
            cancelli tu svuotando i dati del sito. Per le notifiche, revocare il
            permesso dal browser è sufficiente.
          </p>
          <p>
            Per qualunque domanda o richiesta:{" "}
            <a
              href="mailto:paolo.pulli@proton.me"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              paolo.pulli@proton.me
            </a>
            {" "}oppure{" "}
            <a
              href="https://x.com/codingpao"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              @codingpao
            </a>
            .
          </p>
        </section>

        <p className="border-t border-neutral-300 pt-4 text-[12px] text-neutral-500">
          Questa informativa descrive l&apos;app così com&apos;è oggi. Se un giorno
          aggiungeremo qualcosa che raccoglie dati — statistiche di utilizzo, per
          esempio — comparirà una richiesta di consenso vera, con la possibilità di
          dire no, e questa pagina verrà aggiornata prima.
        </p>
      </div>
    </div>
  );
}
