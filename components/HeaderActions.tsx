import AvvisiBadge from "./AvvisiBadge";
import FeedStatus from "./FeedStatus";
import ThemeToggle from "./ThemeToggle";

/**
 * Angolo in alto a destra di ogni pagina, in ordine: avvisi di oggi, stato
 * del feed, tasto tema. Sempre gli stessi, sempre in quest'ordine.
 *
 * I primi due compaiono solo quando hanno qualcosa da dire — zero avvisi e
 * feed fresco non occupano spazio — quindi la riga di solito è solo il tasto
 * del tema.
 */
export default function HeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <AvvisiBadge />
      <FeedStatus />
      <ThemeToggle />
    </div>
  );
}
