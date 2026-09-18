import TripDetail from "@/components/TripDetail";

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ stop?: string }>;
}) {
  const { tripId } = await params;
  // Da quale fermata si è arrivati: serve a offrire la notifica per QUELLA
  // fermata, che è il posto in cui l'utente sta aspettando. Arrivando da un
  // link condiviso o dalla pagina linea non c'è, e il tasto non compare.
  const { stop } = await searchParams;
  return (
    <TripDetail tripId={decodeURIComponent(tripId)} stopId={stop ? decodeURIComponent(stop) : null} />
  );
}
