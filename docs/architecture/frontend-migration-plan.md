# План миграции frontend

## 1. Цель

Преобразовать текущий React-прототип в полноценно структурированное SPA без изменения существующего поведения и визуального baseline.

После миграции приложение должно иметь:

- декларативный routing;
- отдельные компоненты страниц;
- композиционные widgets и небольшие внутренние компоненты;
- feature-модули для пользовательских сценариев;
- сущности с собственными model, api и ui;
- переиспользуемые UI-примитивы в `shared/ui`;
- CSS Modules для компонентных стилей;
- единый API client и централизованную обработку ошибок;
- явное разделение server state, realtime state и локального UI state;
- заменяемые real/fake реализации realtime transport;
- тестируемые границы модулей.

Миграция не должна менять публичный REST/WebSocket API, бизнес-правила и внешний вид без отдельной задачи.

## 2. Текущее состояние

Структурная миграция завершена. Текущий `RunDrawer` читает typed run contract и
показывает immutable instance/type/model/mode snapshot, номер попытки и безопасное
состояние Connector с фактом durable checkpoint. Историческое отображение не
зависит от доступности instance или модели в текущем catalog; component test
фиксирует этот fallback. Новые product capabilities следует развивать внутри
существующих `entities`/`widgets`, не возвращая transport или catalog lookup в
presentation components.

Исходные точки технического долга, закрытые последующими этапами этого плана:

- `apps/frontend/src/App.tsx` содержит routing, загрузку данных, realtime orchestration, страницы, layout, dialogs, drawers и большинство компонентов;
- routing реализован вручную через `location`, `history.pushState` и query-параметр `view`;
- `roomId` одновременно является частью URL и локального состояния;
- HTTP-запросы и разбор ошибок находятся непосредственно в компонентах;
- `apps/frontend/src/domain.ts` смешивает DTO, frontend-модели, reducer, parsing и demo fixtures;
- `apps/frontend/src/gateway.ts` смешивает контракт, real WebSocket/HTTP transport и fake transport;
- все стили глобальные и завязаны на общие имена классов;
- комнаты, персоны и модели загружаются вручную через `useEffect` и функции `refresh*`;
- типы API частично дублируют backend-типы;
- frontend-тесты в основном проверяют reducer и gateway, но почти не покрывают страницы и пользовательские сценарии.

## 3. Архитектурные принципы

Используем прагматичный Feature-Sliced подход, не создавая слой или папку без реальной ответственности.

Направление зависимостей:

```text
app -> pages -> widgets -> features -> entities -> shared
```

Правила:

1. Нижний слой не импортирует верхний.
2. `shared` ничего не знает о Room, Persona, Run или Hermes.
3. `entities` содержит модель и представление одной бизнес-сущности, но не полноценный пользовательский сценарий.
4. `features` реализует законченное действие пользователя.
5. `widgets` собирает несколько features/entities в крупный блок страницы.
6. `pages` связывает route params, page-level queries и widgets.
7. `app` содержит только запуск, routing, providers и глобальные стили.
8. Публичный API модуля экспортируется через `index.ts`; внутренние файлы другого модуля напрямую не импортируются.
9. Не допускаются циклические импорты и универсальные каталоги `utils`/`components` без предметной границы.

## 4. Целевая структура

```text
apps/frontend/src/
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   ├── providers/
│   │   ├── AppProviders.tsx
│   │   ├── QueryProvider.tsx
│   │   └── TransportProvider.tsx
│   └── styles/
│       ├── reset.css
│       ├── tokens.css
│       └── globals.css
├── pages/
│   ├── room/
│   │   ├── RoomPage.tsx
│   │   ├── RoomPage.module.css
│   │   └── index.ts
│   ├── personas/
│   │   ├── PersonasPage.tsx
│   │   ├── PersonasPage.module.css
│   │   └── index.ts
│   └── not-found/
├── widgets/
│   ├── app-shell/
│   ├── sidebar/
│   ├── room-header/
│   ├── timeline/
│   ├── composer/
│   ├── run-drawer/
│   └── artifacts-drawer/
├── features/
│   ├── create-room/
│   ├── delete-room/
│   ├── manage-room-personas/
│   ├── send-message/
│   ├── retry-run/
│   ├── select-run/
│   ├── cancel-run/
│   ├── resolve-request/
│   └── edit-persona/
├── entities/
│   ├── room/
│   │   ├── api/
│   │   ├── model/
│   │   ├── ui/
│   │   └── index.ts
│   ├── persona/
│   ├── message/
│   └── run/
└── shared/
    ├── api/
    │   ├── client.ts
    │   ├── ApiError.ts
    │   └── realtime/
    ├── ui/
    │   ├── Button/
    │   ├── IconButton/
    │   ├── Input/
    │   ├── TextArea/
    │   ├── Dialog/
    │   ├── Drawer/
    │   ├── Avatar/
    │   ├── Alert/
    │   ├── Spinner/
    │   └── EmptyState/
    ├── hooks/
    ├── lib/
    ├── config/
    └── types/
```

Это целевая карта, а не требование создать все каталоги заранее. Каталог появляется вместе с первым реальным модулем.

## 5. Routing

Добавить `react-router-dom` и перейти к маршрутам:

```text
/                     -> redirect в первую или последнюю доступную комнату
/rooms/:roomId        -> RoomPage
/personas             -> PersonasPage
/personas/:personaId  -> PersonasPage с выбранной персоной
*                     -> NotFoundPage
```

Правила routing:

- `roomId` берётся только из route params и не дублируется в `useState`;
- смена комнаты выполняется через router navigation;
- back/forward работает средствами router без собственных `popstate` handlers;
- modal/drawer состояние остаётся локальным, если его не требуется сохранять в URL;
- выбранную персону стоит хранить в path, если нужна адресуемая detail-страница;
- `gateway=fake` можно временно оставить query-параметром для demo, но он не заменяет route;
- несуществующая комната отображает понятное состояние и предлагает перейти к доступной комнате.

## 6. Состояние приложения

### 6.1 Server state

К server state относятся:

- список комнат;
- каталог персон;
- участники комнаты;
- каталог моделей;
- detail персоны.

Рекомендуется использовать TanStack Query:

- query keys объявляются рядом с entity API;
- mutations инвалидируют конкретные queries;
- loading/error/refetch не дублируются вручную в страницах;
- запросы получают `AbortSignal`;
- cache не используется как хранилище realtime timeline без отдельного решения.

Пример ключей:

```ts
roomKeys.all
roomKeys.detail(roomId)
personaKeys.catalog({ includeArchived: true })
personaKeys.byRoom(roomId)
modelKeys.all
```

### 6.2 Realtime state

К realtime state относятся:

- messages;
- runs и response slots;
- выбранные attempts;
- последний WebSocket sequence;
- connection status.

Reducer остаётся чистой функцией и переносится в `entities/room/model`. Жизненный цикл подключения инкапсулируется в `useRoomStream(roomId)` либо room session controller.

Обязательные свойства:

- новое подключение создаётся при смене `roomId`;
- старое подключение гарантированно закрывается;
- replay продолжает использовать `after=lastSequence`;
- события дедуплицируются по sequence;
- reset одной комнаты не протекает в другую;
- reconnect status доступен UI;
- malformed event не ломает приложение и диагностируется.

### 6.3 UI state

Локально остаются:

- открытие dialogs/drawers;
- поисковые строки;
- draft формы;
- hover/focus/expanded состояния;
- временный selected run, если он не должен быть адресуемым URL.

UI state нельзя помещать в query cache.

## 7. API и transport

### 7.1 HTTP client

Создать единый `shared/api/client.ts`, отвечающий за:

- HTTP method, JSON body и headers;
- безопасный разбор JSON/empty response;
- нормализованный `ApiError` с `status`, `code`, `message` и optional details;
- network errors;
- `AbortSignal`;
- единообразную обработку `204`.

Предметные endpoints остаются в entities/features:

```text
entities/room/api/roomsApi.ts
entities/persona/api/personasApi.ts
entities/run/api/runsApi.ts
features/send-message/api/sendMessage.ts
```

React-компонент не должен вызывать `fetch` напрямую и самостоятельно вычислять текст ошибки через `message ?? error ?? HTTP`.

### 7.2 Realtime transport

Разделить контракт и реализации:

```text
shared/api/realtime/
├── RoomEventStream.ts
├── WebSocketRoomEventStream.ts
└── FakeRoomEventStream.ts
```

Контракт отвечает только за подписку и lifecycle соединения. REST-команды run не следует прятать в WebSocket transport: команды остаются HTTP mutations, события возвращаются через WebSocket.

Текущая схема сохраняется:

```text
Browser -- REST commands --> backend
Browser <-- WebSocket events -- backend
backend <-- SSE events ----- Hermes API
```

Real/fake transport выбирается один раз в provider/factory. Компоненты не должны содержать проверки `gateway.mode` для обычной бизнес-логики.

## 8. UI и стили

### 8.1 Shared UI

Компонент попадает в `shared/ui`, если:

- не содержит предметных терминов;
- переиспользуется или явно проектируется как примитив;
- принимает визуальные/поведенческие props, а не Room/Persona/Run целиком;
- не вызывает API и не знает о router.

Примеры:

- `Dialog` — shared;
- `CreateRoomDialog` — feature;
- `Avatar` — shared;
- `PersonaAvatar` с правилами отображения персоны — entity;
- `Drawer` — shared;
- `RunDrawer` — widget/entity composition.

Не требуется заранее создавать большую дизайн-систему. Первый набор: `Button`, `IconButton`, `Input`, `TextArea`, `Dialog`, `Drawer`, `Avatar`, `Alert`, `Spinner`, `EmptyState`.

### 8.2 CSS Modules

- component styles хранятся рядом с компонентом в `*.module.css`;
- глобально остаются reset, body/root layout, tokens и действительно глобальная typography;
- условные классы собираются через `clsx` или небольшую локальную функцию;
- CSS variables используются для цветов, spacing, radii, shadows, layers и breakpoints;
- глубокие селекторы по DOM-структуре постепенно устраняются;
- responsive поведение остаётся рядом с соответствующим widget;
- visual migration сверяется с существующим SpecCanvas baseline.

## 9. Контракты данных

До появления общего contracts-пакета frontend хранит DTO рядом с entity API. Нужно различать:

- API DTO;
- frontend domain/view model;
- form model;
- realtime event payload.

После backend-этапа общие wire contracts можно вынести в `shared/contracts` на уровне репозитория. В этот каталог не должны попадать React types, SQLite rows или внутренние Hermes types.

Runtime validation WebSocket events и критичных API responses рекомендуется добавить через TypeBox или Zod отдельным инкрементом.

## 10. Этапы миграции

### PR F1. Каркас приложения и routing — ✅ завершён

Реализовано в commit `97f7431`: добавлен декларативный router, route pages и URL как источник `roomId`; удалены ручные History API handlers. `AppProviders` будет добавлен вместе с первым реальным provider на этапе F5, чтобы не создавать пустую обёртку.

- добавить router;
- создать `app/App.tsx`, `app/router.tsx` и `AppProviders`;
- создать `AppShell`, `RoomPage`, `PersonasPage`, `NotFoundPage`;
- заменить ручные `history`/`popstate` handlers;
- сделать route param единственным источником `roomId`;
- сохранить текущие компоненты временно без глубокого рефакторинга.

Критерии готовности:

- прямое открытие `/rooms/:roomId` работает;
- переходы между комнатами и персонами работают;
- browser back/forward работает;
- refresh сохраняет текущий экран;
- fake gateway остаётся доступен;
- build, typecheck и тесты проходят.

### PR F2. Декомпозиция UI и CSS Modules — ✅ завершён

Завершено серией commits после F1: вынесены `Sidebar`, `RoomHeader`, `ArtifactsDrawer`, `Timeline` с карточками runs, `RunDrawer`, `Composer` и `PersonasScreen`; `AppShell` стал владельцем корневого layout-контейнера, а room dialogs вынесены в feature-модуль. Стили разложены на co-located CSS Modules, общие tokens/reset/globals выделены в `app/styles`, старый `styles.css` удалён. Для безопасного сохранения визуального baseline модули временно используют явно отмеченные `:global(...)` legacy selectors вместе с импортируемым локальным root binding; переход JSX на полностью именованные module classes может выполняться постепенно без нового монолитного CSS-файла.

- извлечь Sidebar, RoomHeader, Timeline, Composer, RunDrawer, ArtifactsDrawer;
- извлечь текущие dialogs;
- перенести стили по модулям без визуальных изменений;
- создать tokens/reset/globals;
- сохранить публичные props максимально узкими.

Критерии готовности:

- `App.tsx` остаётся composition root, а не экраном;
- страницы не содержат реализации больших UI-блоков;
- глобальный stylesheet не содержит component-specific selectors;
- desktop/mobile layout совпадает с baseline.

### PR F3. Shared UI — ✅ завершён

Созданы `Button`, `IconButton`, `Input`, `TextArea`, `Select`, `Avatar`, `Alert`, `Spinner`, `Dialog`, `Drawer` и `EmptyState` с локальными CSS Modules. На shared primitives переведены room dialogs, run/artifacts drawers, каталог персон, composer, timeline, системные состояния sidebar и пустые состояния. Предметные кнопки-карточки, элементы навигации и mention picker намеренно оставлены в своих widgets/features: их поведение и представление не являются универсальным UI-примитивом.

- [x] извлечь повторяющиеся Button/IconButton/Input/TextArea/Select;
- [x] унифицировать Dialog и Drawer;
- [x] извлечь Avatar, Alert, Spinner, EmptyState;
- [x] добавить accessibility-поведение: focus management, Escape, labels, dialog semantics.

Критерии готовности:

- предметные dialogs используют shared primitives;
- shared components не импортируют entities/features;
- нет ухудшения keyboard navigation.

### PR F4. API client и entity API — ✅ завершён

- [x] ввести `ApiError` и общий client;
- [x] вынести rooms/personas/models/runs endpoints;
- [x] удалить прямые `fetch` из компонентов;
- [x] покрыть client и API modules unit-тестами.

Создан `shared/api` с единым JSON transport и нормализованным `ApiError`. Предметные REST endpoints размещены в `entities/room`, `entities/persona`, `entities/model` и `entities/run`; `WorkspaceApp`, каталог персон и HTTP gateway используют typed functions. Прямой `fetch` остался только внутри общего client.

Критерии готовности:

- единый формат ошибок;
- `204`, invalid JSON и network failure обработаны;
- компоненты работают с typed functions/mutations.

### PR F4.1. CSS isolation — ✅ завершён

- [x] удалить `:global(...)` из component CSS Modules;
- [x] подключить локальные классы через `styles.*`, включая динамические `selected`, `open` и run status;
- [x] перенести layout-классы в модуль владельца;
- [x] оставить в глобальных стилях только document-level defaults, reset и accessibility/media policy.

Устранены 208 `:global`-селекторов из app shell, sidebar, room header, personas screen, timeline и composer. Component-specific классы теперь хэшируются CSS Modules и не зависят от порядка подключения widget styles.

### PR F5. Server state — ✅ завершён

- [x] добавить TanStack Query;
- [x] заменить `refreshRooms`, `refreshPersonas` и ручные loading flags;
- [x] определить query keys и invalidation rules;
- [x] сохранить fake fixtures через transport/API adapters или отдельный demo state.

`QueryClientProvider` подключён на app layer. Rooms, room participants, persona catalog/detail и models загружаются через `useQuery` с `AbortSignal`; mutations инвалидируют room/persona prefixes. Fake gateway не записывает fixtures в query cache и использует изолированное локальное demo state.

Критерии готовности:

- mutations обновляют необходимые списки;
- нет дублирующих запросов из конкурирующих effects;
- смена комнаты не показывает данные предыдущей комнаты как актуальные.

### PR F6. Realtime model и transport — ✅ завершён

Введены `RoomEventStream`, `WebSocketRoomEventStream`, `FakeRoomEventStream` и entity hook `useRoomStream`. WebSocket больше не выполняет REST-команды, gateway делегирует transport и command API разным слоям. Realtime types, reducer и initial state перенесены в `entities/room/model`; `domain.ts` временно реэкспортирует их для совместимости до F7. Сохранены buffering до React subscription, StrictMode restart, replay sequence, deduplication, malformed-event isolation и cleanup.

- [x] разделить `RoomEventStream`, WebSocket и fake реализации;
- [x] перенести reducer и event types в room/run models;
- [x] создать `useRoomStream`;
- [x] покрыть transport сценариями reconnect, replay buffering, deduplication и cleanup; room switch проверяется lifecycle hook.

Критерии готовности:

- REST command/WebSocket event схема не изменилась;
- reconnect продолжает поток после `lastSequence`;
- закрытый stream не обновляет React state;
- real/fake выбор не размазан по UI.

### PR F7. Features и entities — ✅ завершён

DTO и frontend-модели распределены по public API сущностей Room, Persona, Message, Run и Model. Mention parsing перенесён в `features/send-message`, а real/fake room orchestration — в `features/room-session`. Удалены временные `domain.ts`, `gateway.ts`, корневой `App.tsx` и старый `app-shell`; workspace и shell теперь являются widgets. Скрипт `npm run lint:boundaries` запрещает production-модулям импортировать верхние FSD-слои.

- [x] разнести Room, Persona, Message и Run;
- [x] выделить room-session и send-message boundaries для команд и composer model;
- [x] удалить старые `domain.ts`, `gateway.ts` и временные compatibility exports;
- [x] добавить module boundary lint rules.

Критерии готовности:

- нет god modules;
- пользовательские сценарии имеют явные entry points;
- направление импортов соблюдается;
- тесты расположены рядом с ответственностью.

### PR F8. Общие contracts и runtime validation

- подключить repository-level wire contracts;
- устранить дублирование frontend/backend DTO;
- валидировать WebSocket envelopes и критичные responses;
- определить политику обработки неизвестной версии/типа события.

Этот этап выполняется совместно с backend contracts migration.

## 11. Тестовая стратегия

На каждом этапе сохраняются существующие тесты и добавляются тесты новой границы.

- unit: mention parsing, reducer, mappers, API client;
- component: Dialog, Composer, RunCard, Persona form;
- integration: RoomPage с mock HTTP и WebSocket stream;
- routing: direct URL, not found, back/forward, room switch;
- realtime: replay, duplicate sequence, reconnect, cleanup;
- smoke/e2e в дальнейшем: создать комнату, добавить персону, отправить сообщение, получить streaming answer, retry/cancel.

Минимальные проверки каждого PR:

```bash
npm test
npm run lint:boundaries
npm run typecheck
npm run build
```

## 12. Что не входит в миграцию

- изменение дизайна;
- изменение REST или WebSocket протокола;
- переход на SSR/Next.js;
- глобальный state manager без подтверждённой необходимости;
- генерация большой дизайн-системы заранее;
- одновременная полная переработка frontend и backend;
- изменение правил runs, retries, selection и conversation history.

## 13. Риски и меры

- **Большой CSS diff:** переносить по одному widget и сравнивать baseline.
- **Двойной источник room state:** сначала внедрить router, затем удалять локальный `roomId`.
- **Потеря событий при смене transport:** зафиксировать replay/reconnect тестами до переноса.
- **Слишком много wrapper-компонентов:** извлекать только компонент с ясной ответственностью.
- **Fake mode расходится с production:** fake должен реализовывать тот же контракт, а сценарии проверяться общими contract tests.
- **Query cache конфликтует с realtime reducer:** не смешивать timeline state с CRUD cache до отдельного проектного решения.

## 14. Итоговые критерии завершения

Frontend migration завершена, когда:

- routing декларативный и URL является источником выбранной страницы/комнаты;
- страницы, widgets, features, entities и shared имеют соблюдаемые границы;
- UI-компоненты используют CSS Modules;
- общие примитивы находятся в `shared/ui`;
- прямые HTTP/WebSocket операции отсутствуют в React presentation components;
- server, realtime и UI state разделены;
- real/fake transports заменяемы;
- нет временных god modules и compatibility exports;
- все проверки проходят, а текущая функциональность и визуальный baseline сохранены.
