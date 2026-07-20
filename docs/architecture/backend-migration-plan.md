# План развития backend

## 1. Состояние документа

План актуализирован по состоянию на 15 июля 2026 года после завершения структурной
миграции B0–B8. Backend уже является модульным монолитом на Fastify и PostgreSQL.

Структурная и operational миграция B0–B9 завершена. Дальнейшие изменения следует
вести как отдельные product/operations capabilities, а не продолжение миграции.

## 2. Цель

Сохранить единое deployable Fastify-приложение, PostgreSQL, REST + WebSocket API и
Hermes Runs API, развивая явные transport, application, persistence и integration
границы без перехода к микросервисам.

Целевые свойства:

- небольшой composition root;
- transport-only routes;
- application services по предметным модулям;
- отдельный Hermes run lifecycle manager;
- предметные repositories и явные транзакции;
- изолированный Hermes adapter;
- версионированные migrations и отдельный seed;
- общие wire contracts без database rows и runtime state;
- единый error mapping и runtime validation;
- unit, integration и contract tests по границам;
- детерминированное восстановление persisted non-terminal runs.

## 3. Текущее состояние

Уже реализовано:

- frontend и backend находятся в `apps/frontend` и `apps/backend`;
- `app/buildApp.ts` регистрирует plugins/routes и lifecycle hooks;
- `app/container.ts` вручную собирает infrastructure, repositories и services;
- rooms, personas, persona groups, messages, runs и room events разделены на модули;
- routes выполняют transport mapping, а сценарии находятся в services/use cases;
- `RunExecutor` и `ActiveRunRegistry` владеют runtime lifecycle;
- единый `Store` удалён, persistence разделён на repositories;
- PostgreSQL использует versioned transactional migrations;
- message, response slots, runs и initial events создаются одной транзакцией;
- durable room events отделены от in-process bus и WebSocket delivery;
- application, validation и unexpected errors обрабатываются централизованно;
- общие wire contracts находятся в `packages/contracts` и используются frontend и backend;
- входящие WebSocket room events проверяются runtime validator из contracts package.
- timeline имеет явную response schema и возвращает immutable harness snapshot,
  восстановленный номер попытки и безопасную Connector lifecycle-проекцию без
  execution ID, epoch, cursor или raw metadata;

Оставшийся технический долг:

- response schemas пока не покрывают run control endpoints;

## 4. Архитектурные принципы

1. Backend остаётся одним Fastify-приложением.
2. Модули строятся вокруг rooms, personas, persona groups, messages, runs и room events.
3. Route отвечает за schema, params/body и HTTP response.
4. Application service отвечает за сценарий и транзакционную координацию.
5. Repository отвечает за persistence и не зависит от Fastify или Hermes.
6. Hermes adapter не знает о Fastify; application зависит от ports.
7. Domain/application код не принимает `FastifyRequest` или `FastifyReply`.
8. Ожидаемые ошибки типизированы и централизованно преобразуются в transport errors.
9. Длительный lifecycle не живёт в route handler.
10. Транзакция определяется атомарностью use case.
11. Общие contracts содержат только внешний wire format.
12. Новая абстракция требует реальной infrastructure или test boundary.

## 5. Актуальная структура

```text
apps/backend/src/
├── app/
│   ├── buildApp.ts
│   ├── config.ts
│   ├── container.ts
│   └── plugins/
├── modules/
│   ├── rooms/
│   ├── personas/
│   ├── persona-groups/
│   ├── messages/
│   ├── runs/
│   └── room-events/
├── infrastructure/
│   ├── database/
│   │   ├── Database.ts
│   │   ├── rowMappers.ts
│   │   ├── seed.ts
│   │   └── migrations/
│   └── realtime/
├── shared/
│   ├── errors/
│   └── validation/
├── integrations/
│   └── connector/
│       ├── HttpConnectorClient.ts
│       └── ConnectorRunAdapter.ts
├── types.ts                  # domain/runtime types
└── index.ts

packages/contracts/
├── package.json
├── tsconfig.json
└── src/index.ts
```

Переход на несколько независимо версионируемых npm packages не требуется.
Workspace используется только для сборки и подключения общего contracts package.

## 6. Ключевые инварианты

### Messages

`CreateMessageRound` должен:

1. проверить room и idempotency key/message ID;
2. разрешить mentions или explicit targets;
3. проверить persona/model availability;
4. получить pre-round conversation snapshot;
5. атомарно создать message, response slots, run snapshots и initial events;
6. опубликовать persisted events только после commit;
7. передать runs исполнителю после commit.

### Runs

`RunExecutor` владеет AbortController, upstream run ID, session mapping, Hermes SSE,
waiting state, terminal guards, background tasks и shutdown.

Terminal transition должна оставаться идемпотентной. Background failure становится
persisted `failed`, а не unhandled rejection.

### Room events

- sequence монотонна отдельно для каждой комнаты;
- изменение run state и соответствующий durable event атомарны;
- bus публикует только persisted event;
- replay после sequence не теряет события;
- WebSocket adapter не меняет domain state и не обращается к Hermes.

### Contracts

`packages/contracts` содержит request/response DTO, error envelope и типизированные
room event payloads. В package не допускаются PostgreSQL rows, `RunContext`,
`AbortController`, Hermes upstream events, repository interfaces или React models.

## 7. Выполненные вехи

### B0. Границы приложений — выполнено

- frontend/backend перенесены в `apps`;
- scripts, Docker, Vite, TypeScript и dev stand paths обновлены.

### B1. Composition root и route plugins — выполнено

- config/container/buildApp выделены;
- health, static frontend и предметные routes зарегистрированы отдельно.

### B2. Error mapping и request schemas — выполнено

- добавлены `AppError`, общий error handler и JSON Schema для params/query/body;
- error envelopes покрыты contract tests.

Response schemas остаются дополнительной задачей B8.2.

### B3. RunExecutor и ActiveRunRegistry — выполнено

- execute/terminal/cancel/approval извлечены из HTTP layer;
- background tasks учитываются при shutdown;
- lifecycle покрыт самостоятельными тестами.

### B4. PostgreSQL infrastructure и migrations — выполнено

- добавлены pool, transaction API и versioned migrations;
- room event sequence стала атомарной;
- повторный startup поддерживается.

Вынос seed в отдельный файл перенесён в B8.2.

### B5. Repositories — выполнено

- единый Store удалён;
- выделены repositories rooms, personas, persona groups, messages, runs, room events
  и session mappings;
- атомарные сценарии передают единый transaction context.

Изоляция row mappers завершается в B8.2.

### B6. Application services — выполнено

- выделены RoomsService, PersonasService, PersonaGroupsService, CreateMessageRound и
  RunsService;
- routes переведены на transport mapping.

### B7. Room event module и WebSocket adapter — выполнено

- durable repository, application service, event bus и WebSocket delivery разделены;
- replay/subscription/unsubscribe semantics покрыты тестами.

Slow-consumer policy остаётся частью B9.

### B8. Общие wire contracts — выполнено

- создан `packages/contracts`;
- общие entity/DTO/event/error types подключены frontend и backend;
- frontend entity types больше не дублируют wire DTO;
- добавлен runtime validator server room events;
- WebSocket client отбрасывает malformed/unknown events;
- текущий snake_case/camelCase wire format сохранён.

## 8. Следующие вехи

### B8.1. Hermes integration boundary — выполнено, затем заменено Connector

- исторически был создан `integrations/hermes`; после Connector-only cutover прямой adapter удалён;
- HTTP adapter, SSE parser, event mapper и upstream types перенесены из корня;
- определены узкие execution и health ports; discovery теперь идёт только через Connector catalog;
- PersonasService, CreateMessageRound, RunExecutor и health plugin переведены на ports;
- upstream SSE events преобразуются внутри adapter и не выходят в application layer;
- Hermes failures представлены общим `UpstreamError` и централизованно отображаются
  в `AppError`;
- adapter, mapper, SSE parser и lifecycle покрыты тестами.

Критерии готовности:

- application modules не импортируют конкретный `HermesClient`;
- Hermes URL, headers, endpoints, SSE и upstream payloads находятся внутри adapter;
- model discovery, stop, approval и unexpected stream end сохраняют поведение;
- tests, typecheck и production build проходят.

### B8.2. Persistence/domain cleanup — выполнено

- database query records преобразуются в domain/wire records через явные функции
  `rowMappers`; прямые `as unknown as` из repositories удалены;
- mapper boundary покрывает personas, persona versions, groups, rooms, messages,
  timeline runs и room events;
- seed вынесен из `Database` в отдельный идемпотентный `seed.ts`;
- response schemas добавлены для rooms, personas, persona groups, models, messages и timeline;
- добавлен migration test перехода с уже применённой `001_initial` на актуальную schema;
- empty/current schema startup и transactional repository scenarios сохранены.

### B9. Recovery и operational hardening — выполнено

- startup reconciliation атомарно и идемпотентно завершает persisted non-terminal
  runs как `failed`, затем best-effort останавливает известный upstream run;
- in-process FIFO ограничивает параллельные Hermes streams через `AGENVYL_RUN_CONCURRENCY`;
- queued run отменяется локально без обращения к Hermes;
- lifecycle logs содержат correlation ID, room ID, local/upstream run IDs и transition,
  но не содержат prompts/messages;
- `/health` является liveness, `/api/v1/health` проверяет PostgreSQL и Hermes и
  возвращает `503`, когда приложение не готово;
- WebSocket slow consumer закрывается кодом `1013` при превышении buffer threshold;
- shutdown прекращает приём runs, терминализирует очередь, abort'ит streams и ждёт
  configurable timeout;
- runtime policies и переменные окружения описаны в `docs/operations/runtime.md`.

## 9. Тестовая стратегия

### Unit

- application services и run lifecycle;
- Hermes event mapper и SSE parser;
- mention routing, error mapping и contract validators;
- row/domain mappers после B8.2.

### PostgreSQL integration

- transactions, constraints и deletion dependencies;
- create message round atomicity;
- per-room sequence;
- migrations с empty, current и historical schema versions;
- persisted orphan reconciliation после B9.

### HTTP/WebSocket contracts

- endpoint status/body compatibility;
- validation и error envelopes;
- WebSocket validation, replay, subscription и unsubscribe;
- REST command приводит к ожидаемым room events;
- Hermes заменяется fake adapter через ports.

Минимальные проверки каждой вехи:

```bash
npm test
npm run typecheck
npm run build
```

## 10. Не входит в план

- микросервисы или отдельный WebSocket gateway;
- Redis/event broker;
- ORM или замена PostgreSQL;
- новая auth/permissions модель;
- смена REST/WebSocket semantics;
- одновременное переименование wire fields.

## 11. Итоговые критерии

Backend migration завершена после B9, когда:

- routes остаются transport-only;
- application services зависят от ports, а не concrete Hermes adapter;
- repositories не возвращают необозначенные PostgreSQL rows;
- migrations, seed и recovery имеют явные lifecycle boundaries;
- общие contracts используются обеими сторонами и валидируются на runtime boundary;
- non-terminal runs после restart получают детерминированный результат;
- tests, typecheck и production build проходят.
