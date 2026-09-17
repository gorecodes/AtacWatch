# Evolutive Attàccate

## ~~1. Fermate e linee preferite~~ ✓ FATTO

## ~~2. Vista aggregata "fermate vicine + prossime corse"~~ ✓ FATTO

## 3. Notifiche push "il bus arriva in X minuti" — DA FARE
Era segnata come fatta, ma nel codice non esiste: nessun uso di `Notification`
o `pushManager`, e `public/sw.js` fa solo caching della shell (nessun listener
`push`). Serve tutto: chiavi VAPID, tabella iscrizioni, UI di attivazione sulla
fermata, listener nel service worker e invio dal worker RT (che già gira ogni
60s, quindi è il posto naturale per valutare i trigger).

## ~~4. Mappa generale veicoli~~ — fuori scope

## 5. Orario completo linea
Tabella a scorrimento con l'orario giornaliero completo di una linea, non solo le
prossime 8 partenze. Utile per pianificare in anticipo. Richiede una nuova RPC
che legga `stop_schedule` senza il filtro temporale dei 90 minuti.

## 7. Statistiche ritardi per linea — raccolta ATTIVA, UI da fare
La raccolta è in produzione (`0016_delay_stats.sql` + chiamata nel worker RT):
ogni 60s campiona il ritardo corrente di ogni corsa attiva e lo aggrega in
bucket orari per linea e direzione. Lo storico si accumula da solo, quindi la
UI si può costruire con calma su dati veri.

Da fare: query di aggregazione e pagina con le linee più in ritardo (media,
picco, % di campioni oltre i 2 minuti). I dati grezzi di ATAC richiedono
filtri non ovvi — le motivazioni, misurate sul feed reale, sono documentate in
testa alla migration: leggerle prima di toccare la query.

## 6. Ricerca "da fermata A a fermata B"
Mini-planner senza routing engine completo: dato A e B, trova le linee che
passano per entrambe le fermate nello stesso verso, e mostra le prossime corse
con orario di partenza da A e arrivo stimato a B. Realizzabile intersecando
`route_stops` per le due fermate e leggendo `stop_schedule`.
