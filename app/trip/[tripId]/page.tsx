import TripDetail from "@/components/TripDetail";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripDetail tripId={decodeURIComponent(tripId)} />;
}
