# Quiz SRC — Cloudflare Workers + D1

Projekt zawiera 350 pytań z arkusza Google `pytania_SRC_sztormgrupa`, zakładka `Pytania SRC`.
Pytania są częścią kodu aplikacji, a postęp użytkownika jest przechowywany w Cloudflare D1.

## Pierwsze wdrożenie

1. Utwórz repozytorium GitHub i umieść w nim zawartość tego katalogu.
2. W Cloudflare wybierz **Compute → Workers & Pages → Create application → Import a repository**.
3. Utwórz bazę D1 o nazwie `src-egzam`.
4. Skopiuj identyfikator bazy do `wrangler.jsonc` w miejsce `WKLEJ_TUTAJ_ID_BAZY`.
5. Zastosuj migrację: `npm run db:remote`.
6. Wdróż aplikację: `npm run deploy` albo pozwól Cloudflare zbudować ją z GitHuba.
7. Dodaj domenę, np. `src.izydor.pl`, w **Settings → Domains & Routes**.
8. Zabezpiecz domenę przez **Cloudflare Zero Trust → Access → Applications**.

Cloudflare Access przekazuje tożsamość zalogowanego użytkownika do Workera. Dzięki temu każdy użytkownik ma oddzielny postęp. Bez Access aplikacja używa profilu `owner`, co jest wygodne lokalnie, ale nie powinno być używane na publicznej stronie.

## Lokalnie

```bash
npm install
npm run db:local
npm run dev
```

## Aktualizacja pytań

Źródłem pytań jest `src/questions.js`. Statusy początkowe `initialMastered` pochodzą z kolumny `Opanowane (X)`. Po pierwszym użyciu właściwy status jest zapisywany w D1 i może być ręcznie zmieniany w tabeli aplikacji.
