import ArrivalsList from "@/components/ArrivalsList";

export default async function StopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArrivalsList stopId={decodeURIComponent(id)} />;
}
