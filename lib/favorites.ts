"use client";

import { useEffect, useState } from "react";

export type FavoriteStop = {
  stop_id: string;
  name: string;
  code: string | null;
};

const KEY = "attaccate_favorites";

function load(): FavoriteStop[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteStop[]>([]);

  useEffect(() => {
    setFavorites(load());
  }, []);

  function toggle(stop: FavoriteStop) {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.stop_id === stop.stop_id);
      const next = exists
        ? prev.filter((f) => f.stop_id !== stop.stop_id)
        : [...prev, stop];
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }

  function isFavorite(stop_id: string) {
    return favorites.some((f) => f.stop_id === stop_id);
  }

  function reorder(oldIndex: number, newIndex: number) {
    setFavorites((prev) => {
      const next = [...prev];
      const [item] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, item);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }

  return { favorites, toggle, isFavorite, reorder };
}
