# Evolutive Attàccate

## ~~1. Fermate e linee preferite~~ ✓ FATTO

## ~~2. Vista aggregata "fermate vicine + prossime corse"~~ ✓ FATTO

## ~~3. Notifiche push "il bus arriva in X minuti"~~ ✓ FATTO

## ~~4. Mappa generale veicoli~~ — fuori scope

## 5. Orario completo linea
Tabella a scorrimento con l'orario giornaliero completo di una linea, non solo le
prossime 8 partenze. Utile per pianificare in anticipo. Richiede una nuova RPC
che legga `stop_schedule` senza il filtro temporale dei 90 minuti.

## 6. Ricerca "da fermata A a fermata B"
Mini-planner senza routing engine completo: dato A e B, trova le linee che
passano per entrambe le fermate nello stesso verso, e mostra le prossime corse
con orario di partenza da A e arrivo stimato a B. Realizzabile intersecando
`route_stops` per le due fermate e leggendo `stop_schedule`.
