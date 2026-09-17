/**
 * Politica del router: tutto ciò che è una scelta e non un fatto del dato.
 *
 * Sta in un file solo perché sono le manopole da girare quando gli itinerari
 * risultano irrealistici. La tabella transfers è materializzata a 800m
 * (0019_transfers.sql) proprio perché cambiare questi numeri non richieda un
 * nuovo ETL.
 */

/** Velocità di cammino: 4,8 km/h, il passo di un adulto senza fretta. */
export const WALK_SPEED_MS = 1.33;

/**
 * Le distanze in banca dati sono in linea d'aria, ma a piedi non si attraversano
 * gli edifici. 1,3 è il rapporto tipico tra percorso stradale e linea d'aria in
 * un tessuto urbano denso. Resta un'approssimazione: dove c'è di mezzo il Tevere
 * o un fascio di binari sbaglia di molto, e la correzione vera è una rete
 * stradale OSM.
 */
export const WALK_DETOUR = 1.3;

/**
 * Margine per cambiare mezzo: scendere, orientarsi, raggiungere la banchina.
 * Senza questo il router produce coincidenze al secondo, che sulla carta
 * funzionano e nella realtà si perdono.
 */
export const MIN_TRANSFER_S = 60;

/** Limite effettivo dei trasferimenti a piedi (la tabella ne contiene fino a 800m). */
export const MAX_TRANSFER_M = 500;

/** Raggio per raggiungere la prima fermata e per arrivare a destinazione dall'ultima. */
export const ACCESS_RADIUS_M = 800;

/** Numero massimo di cambi considerati: oltre, l'itinerario non è più accettabile. */
export const MAX_LEGS = 5;

export function walkSeconds(meters: number): number {
  return Math.round((meters * WALK_DETOUR) / WALK_SPEED_MS);
}
