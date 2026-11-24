# SaymonGym na OCI ARM64

Ta konfiguracja buduje lokalne obrazy SaymonGym i wystawia wyłącznie Caddy. Użyj zaakceptowanej
rewizji repozytorium i pracuj w jej katalogu `deploy/public`. Skonfiguruj Docker Engine i Compose
na VPS. Nie uruchamiaj tego stosu poleceniami z głównego `docker-compose.yml`.

## 1. Przygotowanie hosta

Skieruj DNS na VPS. W OCI i zaporze Linuksa udostępnij TCP 80 i 443. Ogranicz SSH do adresów
administracyjnych i zablokuj kontenerom dostęp do metadanych OCI. Sprawdź, że podsieci
`172.30.84.0/24` oraz `172.30.85.0/24` nie kolidują z istniejącymi sieciami. Gdy je zmieniasz,
zaktualizuj w Compose obie adresacje statyczne i oba adresy zaufanych proxy. Nie przyłączaj
przypadkowych usług do tych sieci.

Domyślnie Compose publikuje porty na IPv4. Dodaj rekord AAAA wyłącznie po skonfigurowaniu
nasłuchu IPv6 i sprawdzeniu rzeczywistego adresu klienta oraz reguł dostępu w tym trybie.

```sh
sudo ss -ltnp '( sport = :80 or sport = :443 )'
sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/saymongym/config /srv/saymongym/state
umask 077
install -m 0600 .env.example /srv/saymongym/config/public.env
dc() { docker compose --env-file /srv/saymongym/config/public.env "$@"; }
```

Polecenie `install` dla pliku konfiguracyjnego wykonuj jeden raz. W `public.env` ustaw domenę
w `DOMAIN` i `RP_ID`, adres HTTPS w `ORIGIN`, publiczny adres lub CIDR administratora w
`ADMIN_NET`, unikalny tag rewizji w `APP_REV` i sprawdzony tag lub digest Caddy w `CADDY_IMAGE`.
Pozostaw dane i konfigurację poza checkoutem. Pliki ignorowania Docker filtrują oba konteksty
budowania. Nie zapisuj sekretów w plikach źródłowych, argumentach budowania ani tagach.

### Gdy porty 80 i 443 są zajęte

- Przy osobnym adresie lokalnym przypisanym do VM ustaw go w `CADDY_BIND_IP` i skieruj DNS na
  odpowiadający mu publiczny adres OCI. Poprzedni serwer musi nasłuchiwać tylko na swoim adresie.
  Nasłuch na wszystkich adresach koliduje również z tą konfiguracją.
- Przy jednym adresie i istniejącym **kontenerze Caddy** pozostaw jego publiczny nasłuch.
  Uruchom tylko `dc up -d --no-build api web` i podłącz ten Caddy poleceniem
  `docker network connect --ip 172.30.84.2 saymongym_edge <kontener-caddy>`. Dodaj blok tej
  domeny z niniejszego Caddyfile do jego konfiguracji. Zastąp placeholdery domeny, adresu
  administracyjnego, trybu zaproszeń i trybu serwisowego konkretnymi wartościami lub przekaż je do istniejącej
  usługi Caddy. Zachowaj reguły dostępu i docelowy upstream `saymongym-web:80`. Zwaliduj cały
  Caddyfile w istniejącym kontenerze przed przeładowaniem. Zapewnij stałe podłączenie do tej
  sieci również po odtworzeniu kontenera. Podczas bootstrapu i po nim zaktualizuj tę samą
  regułę `INVITE_ONLY` na brzegu. W tym wariancie pomijaj uruchamianie usługi `caddy` ze stosu
  SaymonGym.
- Przy jednym adresie i innym istniejącym proxy zaplanuj wspólny ingress z Caddy przed
  wdrożeniem lub wybierz osobny adres lub VPS. Samo wystawienie web na innym porcie omija
  ochronę Caddy. Konfiguracja zakłada, że publiczny Caddy widzi adres klienta bezpośrednio.

## 2. Walidacja, start i pierwszy administrator

Jeśli katalog stanu jest pusty, ustaw w `public.env` `FIRST_USER_ADMIN=1` i `INVITE_ONLY=0`
przed pierwszym startem. Caddy w tym trybie ogranicza ruch aplikacji do `ADMIN_NET`, pozostawiając
automatyczny HTTPS. Przy przywracaniu istniejącej instancji zostaw `FIRST_USER_ADMIN=0` oraz
`INVITE_ONLY=1` i zachowaj domenę oraz `RP_ID`.

```sh
dc config --quiet
dc run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
dc build --pull api web
dc up -d --no-build --wait
dc exec -T web nginx -t
dc ps
```

Na pustej instancji sprawdź z innej sieci, że aplikacja zwraca 403. Z adresu administracyjnego
utwórz właściciela oraz dodaj zapasową passkey z obsługą weryfikacji użytkownika. Następnie zamknij
rejestrację w API, zanim zdejmiesz blokadę ruchu na brzegu.

1. Zapisz `FIRST_USER_ADMIN=0` i `INVITE_ONLY=1` w `public.env`.
2. Wykonaj `dc up -d --no-deps --no-build --force-recreate --wait api`.
3. Wykonaj `dc up -d --no-deps --no-build --force-recreate --wait caddy` albo przeładuj
   konfigurację już działającego Caddy zgodnie z jego instrukcją. Sprawdź odmowę rejestracji
   bez zaproszenia i wydaj trzy oddzielne kody. Limit czterech kont egzekwuje operator.

Publiczny web pomija pliki katalogu `exercise-media` i Caddy zwraca 404 dla tej ścieżki.
Wbudowane zasoby Androida i prywatne pliki pod `/api/media` pozostają dostępne.
Zakres licencji opisuje [nota projektu](../../NOTICE.md).

## 3. Kopie, aktualizacja i odtwarzanie

- **Kopia.** Zatrzymaj API poleceniem `dc stop api` na czas spójnej kopii całego katalogu
  stanu i konfiguracji. Archiwum obejmuje m.in. bazę kont, passkeys, pliki stanu, uploady i
  klucz serwera. Zapisuj je od razu jako szyfrowane archiwum poza checkoutem, np. w Bash:

  ```sh
  set -o pipefail
  umask 077
  sudo tar -C /srv/saymongym -czf - state config |
    age -r '<publiczny-klucz-odbiorcy-age>' -o "$HOME/saymongym-$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age"
  dc start api
  ```

  Sprawdź status potoku przed uznaniem kopii za gotową. Przenieś ją poza VPS. Klucz
  odszyfrowania przechowuj oddzielnie. Certyfikaty Caddy można ponownie uzyskać albo
  załączyć w oddzielnej szyfrowanej kopii wolumenów. Nigdy nie publikuj archiwów ani
  pełnego wyniku `docker compose config` zawierającego zmienne runtime.
- **Aktualizacja.** Zachowaj aktualny `APP_REV`, checkout, konfigurację i oba poprzednie
  obrazy. Przy wyłączonym API wykonaj kopię i pozostaw API wyłączone do podmiany, jeśli
  kopia ma oznaczać dokładną granicę zmiany. Na nowej rewizji ustaw nowy `APP_REV`,
  ponownie zwaliduj Compose i Caddy, zbuduj parę obrazów i uruchom `dc up -d --no-build --wait`.
  Jeśli produkcyjny Caddy zajmuje już adres statyczny, zwaliduj nowy plik binarką Caddy
  lub osobnym kontenerem z `--network none`. Przekaż wyłącznie zmienne Caddy wymienione
  w sekcji `environment` usługi oraz nowy Caddyfile jako odczytywalny bind mount.
- **Odtwarzanie.** Najpierw odetnij dostęp publiczny. Ustaw `CADDY_ADMIN_ONLY=1` i odtwórz
  usługę Caddy lub zmień tę regułę w istniejącym proxy. Z innej sieci potwierdź `403`.
  Rozpakuj zweryfikowaną kopię do nowego katalogu `0700` poza repozytorium.
  Sprawdź zawartość i prawa, zachowaj kopię bieżącego stanu, zatrzymaj API, a następnie
  podmień katalog stanu i konfigurację. Zachowaj domenę, `RP_ID` i oryginalny plik
  `state/secret` wymagany przez dane. Najpierw przetestuj z ograniczonym dostępem. Starsza
  baza może przywrócić wcześniej odwołane sesje, kody i tokeny. W takim wypadku przed
  otwarciem dostępu odwołaj je operacyjnie lub pozostaw ograniczenie `CADDY_ADMIN_ONLY=1`
  do czasu przygotowania bezpiecznej migracji. Nie usuwaj ani nie podmieniaj samego pliku `secret`
  bez sprawdzenia danych szyfrowanych z jego użyciem.
- **Rollback.** Jeśli format danych na to pozwala, wystartuj oba poprzednie obrazy z
  bieżącym stanem, wybierając poprzedni checkout i `APP_REV`. Przy niezgodności użyj
  ścieżki odtwarzania. Jeżeli poprzedni zestaw obrazów nie ma wymaganych zabezpieczeń,
  pozostaw instancję w trybie ograniczonego dostępu.

## 4. Kontrola przed użyciem rzeczywistych danych

- Zweryfikuj certyfikat, właściwy adres klienta widoczny po obu hopach i odmowę dostępu
  do ścieżek admina z innego adresu. Sprawdź, że nagłówek przekazany przez klienta nie
  zmienia budżetu. Potwierdź brak publicznych portów API oraz web.
- Sprawdź cztery logowania i parowania zza jednego NAT, odpowiedź `429` z `Retry-After`,
  jednorazowość kodów, ograniczenie rejestracji, odmowy dla Coach, MCP i `exercise-media`.
- Na testowych kontach sprawdź izolację danych, utratę starych sesji po blokadzie i
  odblokowaniu, potwierdzenie passkey przy operacji administracyjnej oraz przy usunięciu
  własnego konta na WWW. Na APK operacja bez dowodu serwerowego ma pozostawić dane.
- Sparuj istniejący APK z docelowym HTTPS z adresu spoza `ADMIN_NET`. Sprawdź pobieranie,
  wysyłanie, zdjęcia i trening offline. Sprawdź również pliki `state-*.json` z prawami
  `0600` po zapisie oraz próbne odtworzenie kopii.
