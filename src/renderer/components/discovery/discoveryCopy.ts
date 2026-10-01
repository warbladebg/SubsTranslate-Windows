import type { UiLanguage } from "../../uiLanguage";


export const discoverCopy = {
  en: {
    home: "Your home",
    title: "Discover",
    description: "Personal picks, popular titles, and open releases.",
    filters: "Filters",
    search: "Search",
    searchPlaceholder: "Search movies and TV shows",
    clearSearch: "Clear search results",
    settings: "Discovery settings",
    collections: "Discover collections",
    browse: "Browse",
    likes: "Likes",
    favourites: "Favourites",
    watched: "Watched",
    recentSearches: "Recent searches",
    clear: "Clear",
    showMore: "Show more",
    showLess: "Show less",
    titleSingular: "title",
    titlePlural: "titles",
    like: "Like",
    favourite: "Favourite",
    imdbRating: "IMDb rating",
    allEpisodesWatched: "All episodes watched",
    loadingTitles: "Loading titles…"
  },
  bg: {
    home: "Твоето начало",
    title: "Открий",
    description: "Лични предложения, популярни заглавия и свободни издания.",
    filters: "Филтри",
    search: "Търси",
    searchPlaceholder: "Търси филми и сериали",
    clearSearch: "Изчисти резултатите",
    settings: "Настройки за откриване",
    collections: "Колекции",
    browse: "Разглеждане",
    likes: "Харесани",
    favourites: "Любими",
    watched: "Гледани",
    recentSearches: "Последни търсения",
    clear: "Изчисти",
    showMore: "Покажи още",
    showLess: "Покажи по-малко",
    titleSingular: "заглавие",
    titlePlural: "заглавия",
    like: "Харесай",
    favourite: "Любимо",
    imdbRating: "Оценка в IMDb",
    allEpisodesWatched: "Всички епизоди са гледани",
    loadingTitles: "Зареждане на заглавия…"
  }
} as const;

export type DiscoverCopy = (typeof discoverCopy)[UiLanguage];

const bulgarianCatalogText: Record<string, string> = {
  "Recommended movies": "Препоръчани филми",
  "Recommended TV shows": "Препоръчани сериали",
  "Open and public releases": "Свободни и публични издания",
  "Development preview using lawfully distributed and public-domain titles.":
    "Предварителен преглед със свободно разпространявани заглавия и заглавия с обществено достояние."
};

export function localizeDiscoveryCatalogText(value: string, uiLanguage: UiLanguage): string {
  return uiLanguage === "bg" ? bulgarianCatalogText[value] ?? value : value;
}
