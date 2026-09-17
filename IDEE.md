# Idee e feature da valutare

Parcheggio delle idee discusse, con il motivo per cui valgono e da cosa
dipendono. Non è una roadmap: l'ordine dipende da cosa serve al momento.

## Pronte: i dati ci sono già

**Allerte ATAC in pagina**
Il worker salva già i `service_alerts` del feed RT (deviazioni, soppressioni,
scioperi) nella tabella omonima. Manca solo la UI: un banner sulla pagina
fermata o linea quando c'è un'allerta attiva che la riguarda. È l'idea con il
rapporto valore/sforzo migliore, perché il lavoro di raccolta è già fatto.

**App Shortcuts**
Tasto lungo sull'icona della PWA su Android → scorciatoie dirette alle fermate
preferite. Si dichiarano in `public/manifest.json`, nessun codice applicativo.
Sforzo minimo, resa molto "nativa".

**Mappa live**
Tutti i mezzi di Roma su una mappa, filtrabili per linea, alla FlightRadar.
I dati sono in `vehicle_positions`, aggiornati ogni 60s. È un'esperienza
diversa dall'approccio fermata-per-fermata: più esplorativa che utile, ma è
la cosa che fa dire "bella" a chi la vede.

## Dipendono dallo storico ritardi

La tabella `delay_stats` accumula da 2026-09-17 (vedi
`supabase/migrations/0016_delay_stats.sql` per i filtri di plausibilità e il
perché). Servono alcune settimane di dati prima che questi numeri siano
difendibili.

**Pagina statistiche**
Ranking delle linee meno affidabili, ritardo mediano per fascia oraria,
percentuale di corse oltre i 2 minuti. È la cosa che nessuna app concorrente
può mostrare, perché richiede un datastore proprietario: Moovit e Google Maps
fanno vedere il presente, non la storia.

**Badge affidabilità sugli arrivi**
Accanto all'ETA, quanto è affidabile quella linea in quella fascia. Attenzione:
l'etichetta "+N min" grezza è già stata provata e rimossa, perché senza
contesto veniva letta come "aspetta N minuti in più" invece di "è in ritardo
rispetto all'orario". Qualunque ritorno del ritardo in pagina deve dire
esplicitamente a cosa si riferisce.

**"Parti N minuti prima"**
Suggerimento basato sul ritardo atteso in quella fascia oraria.

## Social

Il discrimine: le feature che richiedono una community muoiono senza massa
critica (chat per linea, commenti sulle fermate, profili utente — stanze vuote
che fanno sembrare l'app abbandonata). Queste due invece funzionano già con un
utente solo.

**"Sto arrivando"**
Dalla pagina corsa, condividi un link con il tuo ETA live alla fermata di
destinazione. Chi ti aspetta lo apre e vede il bus muoversi. Risolve una
domanda quotidiana reale ("a che ora arrivi?"), e ogni condivisione su WhatsApp
espone l'app a qualcuno di nuovo: è social in senso virale, non comunitario.
Implementabile con quello che c'è: token a scadenza legato a
(trip_id, stop_id di destinazione), nessuna autenticazione.

**Segnalazione corse fantasma**
Un tasto "non è passato" sulla riga dell'arrivo. Valore asimmetrico: poche
segnalazioni al giorno su una linea sono già utili a tutti. E colma un buco
reale dei dati, perché nel feed ATAC una corsa soppressa e un'interruzione di
trasmissione sono indistinguibili — le segnalazioni le distinguerebbero.

## Accantonate

**App nativa / Play Store**
Valutata il 2026-09-17. La via breve sarebbe una TWA (Trusted Web Activity):
wrappa la PWA esistente, si pubblica in un paio di giorni, account developer
Google 25€ una tantum. Accantonata perché per vendere o monetizzare servono
gestione utenti, pagamenti e assistenza, cioè un prodotto e non un progetto.
Nel frattempo la PWA è installabile e ha le notifiche.
