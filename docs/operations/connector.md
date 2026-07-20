# Host-side Agenvyl Connector

Connector запускается отдельным host-процессом рядом с установленными harness, их CLI и credential stores. Он не входит в Core container, не зависит от dev stand и не получает секреты из YAML.

## Текущий инкремент

Реализованы безопасный shell, Connector-owned execution registry, Hermes/OpenCode adapters и Linux host-side Antigravity adapter:

- versioned HTTP boundary `/v1`;
- обязательный Bearer token для каждого endpoint;
- YAML config version 1 с loopback bind по умолчанию;
- discovery configured instances и независимый health status;
- ephemeral `connectorEpoch` на каждый запуск;
- идемпотентный запуск по `executionId`, inspect и stop;
- ordered SSE с Connector cursor, bounded replay и явным `replay_unavailable`;
- единое терминальное состояние, которое поздний vendor event уже не может переписать;
- внутренний adapter port `start / inspect / events / stop`;
- room-to-workspace policy с canonical path enforcement;
- Hermes create/inspect/events/stop, approval lifecycle и нормализация text, tool, request, usage и terminal events;
- OpenCode provider/model и primary-agent catalog, fresh session, async prompt, text/tool streaming, manual approvals, одиночные clarifications, token usage, active/waiting abort и terminal normalization через pinned `@opencode-ai/sdk@1.17.15`;
- Antigravity `agy >= 1.1.3`: exact model catalog, `plan`/`accept-edits` modes, fresh subprocess на attempt, final text, process-group cancel и terminal errors без недоступных CLI events;
- единый adapter-wide redaction и safe-error boundary перед snapshot/SSE;
- общий contract package с runtime validation и fixtures для health, discovery, catalog, execution snapshot и events.
- внутренний Core client для health/inspect и startup reconciliation по `connectorEpoch`.
- Hermes model catalog, Connector per-instance catalog и агрегированный Core endpoint `GET /api/v1/harnesses`.
- полный внутренний Core client для typed start/inspect/stop/resolve и SSE replay;
- единственный Core execution bridge с durable `connectorExecutionId`, epoch и cursor; прямой Hermes transport из Core удалён.
- restart-safe Core reattach с атомарным принятием cursor и room events, terminal catch-up и восстановлением controls.

Канонический workspace передаётся адаптеру как обязательная working-directory граница. Hermes и OpenCode рекламируют capability `approvals`, а OpenCode также `clarifications`: upstream-запрос получает локальный стабильный ID, попадает в execution snapshot и разрешается через `POST /v1/executions/:id/requests/:requestId/resolve`. Повтор того же resolution идемпотентен, а отличающийся повтор отвечает `409 request_resolution_conflict`. Обычный upstream `ask` ждёт явного `once`, `always` или `deny`, но OpenCode `external_directory` автоматически получает `reject` внутри адаптера и не публикуется пользователю: Agenvyl не позволяет исполнению расширять каноническую границу комнаты. Один single-select/custom OpenCode question преобразуется в `request.opened(kind=clarification)` и ждёт явного текста через Core `POST /api/v1/runs/:runId/request`; choices являются подсказками, а не ограничением custom-ответа. Пакетные, malformed и multi-select questions fail closed с `unsupported_interaction`, без автоответа. Core требует `AGENVYL_CONNECTOR_URL` и тот же Bearer token в `AGENVYL_CONNECTOR_TOKEN`; отсутствие пары завершает startup ошибкой. Прямого Core-to-harness пути и автоматического fallback нет.

Inline-изображения являются workspace-only инвариантом. Core явно требует от агента скачать изображение сразу во временное имя внутри workspace, не использовать `/tmp`, `sudo` или другой внешний каталог, проверить HTTP-результат, ненулевой размер и фактический формат, атомарно переименовать файл внутри workspace и только затем использовать `![caption](workspace:path)`. Обычные внешние ссылки разрешены, но внешний Markdown hotlink `![](http(s)://...)` fail-closed завершает run с `external_image_not_persisted`. Это не позволяет выдуманному или исчезнувшему URL стать успешно опубликованным ответом и сохраняет versioned snapshot для каждого показанного изображения.

## Конфигурация и запуск

```bash
cp connector.example.yaml connector.yaml
export AGENVYL_CONNECTOR_CONFIG=./connector.yaml
export AGENVYL_CONNECTOR_TOKEN="$(openssl rand -hex 32)"
export AGENVYL_CONNECTOR_HERMES_URL="http://127.0.0.1:8642"
# Optional: export AGENVYL_CONNECTOR_HERMES_TOKEN="<hermes-secret>"
npm run dev:connector
```

OpenCode запускается отдельно и остаётся самостоятельным host-side harness:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
# In another shell:
export AGENVYL_CONNECTOR_OPENCODE_URL="http://127.0.0.1:4096"
# Set local-opencode.enabled: true in connector.yaml.
npm run dev:connector
```

Если OpenCode server защищён через `OPENCODE_SERVER_PASSWORD`, передайте пароль только через `AGENVYL_CONNECTOR_OPENCODE_PASSWORD`; username по умолчанию `opencode` и переопределяется `AGENVYL_CONNECTOR_OPENCODE_USERNAME`. `AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY` необязателен и задаёт project context только для catalog discovery. Execution всегда использует канонический room workspace от Connector.

Production-like запуск после общей сборки:

```bash
npm run build
AGENVYL_CONNECTOR_CONFIG=./connector.yaml \
AGENVYL_CONNECTOR_TOKEN="<secret-at-least-32-characters>" \
AGENVYL_CONNECTOR_HERMES_URL="http://127.0.0.1:8642" \
npm run start:connector
```

Проверка:

```bash
curl -fsS \
  -H "Authorization: Bearer $AGENVYL_CONNECTOR_TOKEN" \
  http://127.0.0.1:4310/v1/health
```

`connector.yaml` содержит только публичную структуру instances и разрешённые workspace roots. Поля вне v1-схемы отклоняются; попытка положить туда token также отклоняется. Disabled instances не публикуются discovery. Enabled Hermes/OpenCode instance становится `healthy`, только если задан соответствующий `AGENVYL_CONNECTOR_*_URL`. Enabled Antigravity instance загружается только при точном `AGENVYL_CONNECTOR_AGY_DANGEROUSLY_SKIP_PERMISSIONS=true`; иначе он остаётся `unavailable`, а Connector health — `degraded`. Команды, URL и credentials читаются только из environment.

## Antigravity / AGY

Antigravity adapter предназначен для Connector, запущенного непосредственно на POSIX host рядом с пользовательским `agy`, OAuth state и trusted workspace. Контейнеру нельзя монтировать `~/.gemini`, OAuth token или host binary. Минимальная проверенная версия — `1.1.3`; adapter перед catalog параллельно проверяет `agy --version` и получает exact display-name models через `agy models`, а успешную проверку версии кэширует на время жизни процесса. Более старые версии fail closed. Во всех дочерних процессах задаётся `AGY_CLI_DISABLE_AUTO_UPDATE=true`.

```bash
agy                         # один раз пройти OAuth и trust текущего workspace root
export AGENVYL_CONNECTOR_AGY_COMMAND="$HOME/.local/bin/agy"
export AGENVYL_CONNECTOR_AGY_DANGEROUSLY_SKIP_PERMISSIONS=true
export AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS=1800000
```

Затем включите instance `type: antigravity` в Connector YAML. Опасный env-флаг является обязательным операторским opt-in и приводит к передаче `--dangerously-skip-permissions` каждому run. `AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS` должен быть больше `AGENVYL_RUN_TIMEOUT_MS`, чтобы обычным deadline владел Core.

`agy --print` не предоставляет документированный JSON/SSE protocol, отдельный system channel, approvals или usage counters. Поэтому adapter:

- передаёт system prompt, canonical history, current message и workspace rule одним JSON-размеченным prompt;
- ограничивает prompt 120 KiB UTF-8 и передаёт его отдельным argv без shell;
- публикует stdout одним `output.text.delta` только после exit;
- рекламирует только `model_catalog` и `mode_catalog`;
- ограничивает stdout 1 MiB и stderr 64 KiB, очищая terminal diagnostics через общий redaction;
- останавливает POSIX process group через `SIGTERM`, затем `SIGKILL`.

Ограничения первого рубежа: flattened instruction hierarchy слабее нативного system channel, prompt кратковременно виден другим локальным пользователям с доступом к process list, промежуточный tool progress отсутствует, а произвольные действия уже нельзя согласовать через UI. Каждый attempt является свежей AGY conversation; `--continue` и `--conversation` не используются.

`GET /v1/instances` публикует status и capabilities каждого instance, а `GET /v1/instances/:id/catalog` отдаёт его нормализованные models/modes. Hermes рекламирует `model_catalog` и `usage`, получает модели из своего `/v1/models`; modes пока пусты. OpenCode рекламирует полный catalog/stream/tool/request/usage набор. Antigravity рекламирует только `model_catalog` и `mode_catalog`: модели берутся из `agy models`, modes фиксированы как `plan` и `accept-edits`. Core агрегирует эти ответы в `GET /api/v1/harnesses` и отклоняет результат, если epoch или instance identity изменились между discovery и catalog. Удалённый Core endpoint `GET /api/v1/models` возвращает `404`; frontend использует только harness catalog.

Persona create/update использует тот же агрегированный catalog как единственную границу валидации. Wire-поля `harness_instance_id`, `model_id` и nullable `mode_id` сохраняются вместе с выведенным из discovery `harness_type` в новую immutable persona version. `requested_model` временно дублирует `model_id` для старого UI; переданный клиентом `harness_type` игнорируется. Если discovery недоступен или меняет epoch/identity, изменение routing-настроек персоны завершается fail closed без записи.

OpenCode adapter подписывается на native SSE до `prompt_async`, чтобы не потерять быстрые deltas/terminal event, и фильтрует поток по fresh session ID. `systemPrompt`, workspace rule и JSON canonical history передаются в upstream `system`, а текущее сообщение остаётся отдельной text part. Это сохраняет instruction hierarchy и роли истории без vendor session continuation. Native `message.part.updated` преобразуется в безопасные `tool.started/updated/completed` без raw input/output/metadata/error. Обычные `permission.asked` и `permission.v2.asked` получают стабильный Connector request ID; `once/always/deny` передаются через соответствующий SDK reply (`deny` становится `reject`). Запрос `external_directory` всегда получает `reject` непосредственно в адаптере и не открывает пользовательский approval. Legacy/v2 `question.asked` с одним single-select/custom question получает отдельный стабильный request ID; ответ переводится в SDK `answers: [[text]]`. Batch, malformed и multi-select question abort-ит session и завершает execution кодом `unsupported_interaction`.

Usage является отдельным необязательным immutable-срезом execution, а не lifecycle transition. OpenCode adapter принимает только assistant `message.updated` для своей session, заменяет накопительный snapshot по `messageID`, подавляет дубли и суммирует сообщения. Hermes adapter берёт `input_tokens`, `output_tokens` и `total_tokens` из terminal `run.completed`. Все значения должны быть неотрицательными safe integers. Нативный `totalTokens` публикуется только когда его передал harness для всех агрегируемых сообщений; отсутствующее значение не вычисляется. Connector не принимает и не рассчитывает стоимость. Core сохраняет `run.usage` в той же транзакции, что cursor и room event, поэтому replay/reload и `RunDrawer` показывают счётчики именно выбранной попытки.

После успешного `adapter.start` Connector core публикует нормальное `execution.upstream_status(waiting_upstream, awaiting_response)` и держит его в snapshot до первого подтверждения живого upstream. Native OpenCode `session.status(type=retry)` нормализуется adapter-ом в общий `execution.upstream_status(retrying)` с allowlisted reason и только типизированными `attempt`/`next` из pinned SDK. Raw `message`, `action`, response body, provider ID и links не покидают adapter. `session.status(type=busy)` означает только начало или продолжение попытки и не восстанавливает состояние. Общий Connector core даёт ordered `recovered` непосредственно перед первым text/reasoning delta, tool signal или `request.opened`; повторные успешные сигналы его не дублируют. Terminal event очищает активное ожидание без fabricated recovery. Это состояние ортогонально execution lifecycle: retry не создаёт `execution.failed`, не меняет instance health и не делает другие модели harness недоступными. Поэтому тот же waiting/recovery lifecycle действует для Hermes и будущих adapters без vendor-specific логики.

```yaml
workspaces:
  roots:
    - /srv/agenvyl/room-workspaces
```

Каждый root должен быть абсолютным путём к существующему каталогу. Для execution с `roomId: room-1` Connector ищет ровно один `<root>/room-1`, канонизирует его вместе с запрошенным `relativePath` и только после этого передаёт adapter абсолютный путь. Отвергаются parent traversal, absolute request paths, symlink escape, отсутствующие и неоднозначные room directories, а также targets, которые не являются каталогами. Абсолютные host paths не включаются в HTTP errors.

Event stream открывается через `GET /v1/executions/:id/events?after=<cursor>`. Cursor принадлежит Connector, а не upstream harness. Если запрошенный cursor старше bounded replay window, Connector отвечает `409 replay_unavailable` вместо продолжения с потерянными событиями.

Внутренний Core client валидирует каждый command wrapper и execution snapshot через общий runtime contract. Для SSE он требует `text/event-stream`, совпадение ожидаемых execution ID и `connectorEpoch`, соответствие SSE `id/event` полям envelope и строго непрерывный cursor начиная с `after + 1`. Разрыв, дубликат, смена epoch или malformed payload завершают stream ошибкой `connector_invalid_response`; `409 replay_unavailable` нормализуется отдельно. Opt-in bridge преобразует эти события в существующие Core room events и принимает durable cursor вместе с проекциями событий в одной транзакции. Cursor из control-response не перескакивает через ещё не применённые stream events. После рестарта Core same-epoch execution reattach-ится с сохранённого cursor; terminal snapshot закрывает узкое окно между checkpoint и Core terminal projection.

Timeline и frontend не получают внутренний checkpoint целиком. Core выводит из
persisted run только безопасную проекцию `connector: { state, checkpointed }`, где
`state` принимает `active`, `degraded`, `terminal`, `unavailable` или `lost`.
Transient provider retry даёт `degraded`, terminal Core status остаётся
каноническим, а ошибки restart/replay/lost execution отображаются как потерянное
выполнение. Execution ID, epoch, cursor, `upstream_metadata` и vendor payload в
публичный API не входят. Timeline также восстанавливает attempt number из runs
одного response slot и возвращает immutable instance/type/model/mode snapshot,
не сверяясь с текущим catalog.

Pending approval или clarification виден одновременно в `execution.pendingRequests` и как ordered SSE-пара `request.opened` / `execution.status(waiting_for_user)`. Успешный resolve возвращает resolved request snapshot и добавляет `request.resolved` / `execution.status(running)`. Core сохраняет request choices в room event/timeline, восстанавливает control после same-epoch restart и принимает ответ через общий request route; Connector обеспечивает идемпотентность одинакового повтора. Stop или terminal закрывают оставшиеся запросы явным `request.resolved`, поэтому reconnect не восстанавливает устаревший prompt.

Все adapter-controlled tool summaries, request prompts/choices и terminal errors повторно очищаются в registry перед сохранением или выдачей по SSE. Из них удаляются control characters, типовые bearer/API/OAuth credentials, URL credentials и абсолютные host paths; summaries и prompts ограничены 2000 символами, errors — 500. Неизвестные Hermes events и их raw payloads не сохраняются. Канонические user input и assistant `output.text.delta` остаются продуктовым содержимым и не считаются diagnostic summaries; Connector не пишет их в собственные логи. Redaction является защитным egress-слоем, а не заменой корректной изоляции адаптера и минимизации upstream payloads.

## Supervisor boundary

Выбор supervisor не является частью Agenvyl: процесс можно запускать через systemd, launchd, Docker Compose sidecar или вручную. Product repository определяет только host-команду, config/env contract и HTTP health boundary. Конкретные VPS units и dev-stand overlays сюда не входят.

## Black-box Hermes E2E gate

Детерминированный gate поднимает на случайных loopback-портах настоящий Core HTTP server, настоящий Connector HTTP/SSE server и protocol-faithful Hermes fixture server. Внутренние ports и `fetch` не подменяются. Проверяются text/tool completion, normalized usage, явный approval, stop/cancel, единственное терминальное состояние и reattach Core после рестарта без дублей по Connector cursor.

```bash
# Используется стандартный PostgreSQL из compose.yaml.
docker compose up -d postgres
npm run test:e2e:hermes
```

Для другой тестовой БД задайте отдельный URL. Gate создаёт уникальную PostgreSQL schema и временный workspace, затем удаляет оба ресурса:

```bash
AGENVYL_E2E_DATABASE_URL='postgres://user:password@127.0.0.1:5432/database' \
  npm run test:e2e:hermes
```

Fixture не требует LLM credentials и предназначен для обязательного локального/CI gate. Проверка совместимости с установленным Hermes и реальной моделью остаётся отдельным opt-in live smoke и не делает основной test suite недетерминированным.

## Antigravity live smoke

Opt-in gate поднимает настоящий Core и Connector на случайных loopback-портах, использует установленный host-side `agy`, отдельную PostgreSQL schema и временный room workspace. Он проверяет catalog, `plan` text, `accept-edits` file mutation, immutable route snapshot и cancel.

```bash
AGENVYL_CONNECTOR_AGY_COMMAND="$HOME/.local/bin/agy" \
AGENVYL_E2E_DATABASE_URL='postgres://user:password@127.0.0.1:5432/database' \
  npm run smoke:antigravity:live
```

## OpenCode black-box E2E

Отдельный OpenCode-compatible fixture проходит через настоящий SDK HTTP/SSE client и полный Core → Connector lifecycle. Gate проверяет normalized usage и его durable timeline projection, cancel активной session, cancel во время pending permission, очистку request, ровно один terminal event и durable Core timeout с единственным SDK abort. Same-epoch restart Core продолжает execution с durable cursor без повторных text/tool/request/terminal events и восстанавливает pending approval control. Retry отменённого run сохраняет immutable instance/model/mode snapshot, но создаёт новую OpenCode session и собственное единственное terminal state.

```bash
npm run test:e2e:opencode
```

Fixture использует изолированные PostgreSQL schema и workspace, не требует LLM credentials и не входит в обычный `npm test`.

## Live Hermes smoke

Live smoke поднимает настоящие Core и Connector на случайных loopback-портах и подключает их к уже установленному Hermes. Он проверяет нормализованный catalog, простой text run, запись файла в изолированный workspace через tool, отдельный явный approval и stop длительного запуска. Ответы модели, tool summaries, workspace и credentials runner не печатает. Для воспроизводимости Hermes должен работать с `approvals.mode: manual`; модель по умолчанию — `sol`, её можно заменить через `AGENVYL_LIVE_HERMES_MODEL`.

Тест запускается только вручную: URL, Hermes credential и отдельная PostgreSQL database передаются через environment и не имеют repository defaults.

```bash
AGENVYL_CONNECTOR_HERMES_URL='http://127.0.0.1:8642' \
AGENVYL_CONNECTOR_HERMES_TOKEN='<hermes-api-key>' \
AGENVYL_E2E_DATABASE_URL='postgres://user:password@127.0.0.1:5432/database' \
  npm run smoke:hermes:live
```

Runner создаёт уникальную PostgreSQL schema и временный workspace, затем удаляет оба ресурса. Он намеренно завершается ошибкой при отсутствующих environment variables, несовместимом model catalog, отсутствии approval или любом незавершённом lifecycle-переходе. Credential нельзя помещать в shell history в общем окружении; предпочтителен локальный secret manager или временная environment-инъекция supervisor-а.

## Live OpenCode smoke

OpenCode smoke подключается напрямую к уже запущенному `opencode serve`, создаёт временный workspace и локальный `opencode.json`, который оставляет edit без approval, но переводит bash в `ask`. Последовательно проверяются catalog/text, реальный workspace tool, ручной permission round-trip и физический abort разрешённого `sleep 60`; временные файлы удаляются после теста. Это opt-in проверка и она исключена из обычного `npm test`.

```bash
AGENVYL_CONNECTOR_OPENCODE_URL='http://127.0.0.1:4096' \
AGENVYL_LIVE_OPENCODE_MODEL='provider/model' \
  npm run smoke:opencode:live
```

Если server защищён паролем, дополнительно задаются `AGENVYL_CONNECTOR_OPENCODE_USERNAME` и `AGENVYL_CONNECTOR_OPENCODE_PASSWORD`. Smoke требует видимый primary/all agent `build`, реальную модель с tool calling и рабочую project permission-конфигурацию.
