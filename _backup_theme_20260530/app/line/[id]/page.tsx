import LineDetail from "@/components/LineDetail";

export default async function LinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dir?: string }>;
}) {
  const { id } = await params;
  const { dir } = await searchParams;
  const initialDir = dir != null && /^\d+$/.test(dir) ? Number(dir) : null;
  return <LineDetail routeId={decodeURIComponent(id)} initialDir={initialDir} />;
}
