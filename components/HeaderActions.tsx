import FeedStatus from "./FeedStatus";
import ThemeToggle from "./ThemeToggle";

/**
 * Angolo in alto a destra di ogni pagina: stato del feed + tasto tema.
 * Sempre insieme, sempre nello stesso ordine.
 */
export default function HeaderActions() {
  return (
    <div className="flex items-center gap-1">
      <FeedStatus />
      <ThemeToggle />
    </div>
  );
}
