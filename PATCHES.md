# Локальные патчи smart-title

Локальная копия форка `@hyakt/opencode-smart-title` 0.1.10
(форк `Tarquinen/opencode-smart-title`), подключена через
`file://` в `~/.config/opencode/opencode.json`.

## Почему не оригинал
`@tarquinen/opencode-smart-title` зовёт LLM напрямую через `ai@5` (spec v2),
а opencode 1.18.33 отдаёт модели spec v4 → `Unsupported model version v4`
на любом провайдере. Форк hyakt делает запрос через subagent-сессию
самого opencode (`client.session.create` + `session.prompt`) и работает.

## Что пропатчено (2026-09-29)

### 1. `dist/prompt.js` — язык заголовка
Оригинальный промпт жёстко требовал английский (`-ing verbs`), поэтому все
заголовки были на английском. Добавлен блок `<language>`: заголовок пишется
на языке разговора, технические термины не переводятся, добавлены примеры
ru/en.

### 2. `dist/index.js` — определение языка
Правило «отвечай на языке пользователя» модель соблюдала не всегда
(на английский запрос отвечала по-русски). Поэтому язык определяется
локально по наличию кириллицы и передаётся явной меткой:

```js
const detectedLanguage = /[\u0400-\u04FF]/.test(context) ? 'ru' : 'en';
// → <detected_language>ru|en</detected_language> в теле промпта
```

### 3. `dist/index.js` — модель из текущей сессии + таймаут (16.10.2026)

Прецедент: в `smart-title.jsonc` была жёстко указана `opencode/big-pickle`.
Модель стала отвечать `AI_APICallError: Rate limit exceeded`, причём промпт
**зависал навсегда** (`session.prompt` не возвращался) → `finally` с очисткой
не выполнялся → копились сессии-мусора «smart-title» (104 шт.), заголовки
не обновлялись.

Правки:
* `parseModel` — деление по ПЕРВОМУ слэшу (работают модели с `/` в ID,
  напр. `openrouter/anthropic/claude-sonnet-4`).
* `resolveModelCandidates` — упорядоченный список моделей-кандидатов:
  1) явный `model` из конфига (если задан), 2) **модель текущей сессии**
  (`session.model` — работает с любой моделью чата), 3) default (без model).
  Перебор по кругу: пустой ответ/ошибка/таймаут → следующий кандидат.
* `withTimeout` (45 с) на `session.prompt` + `session.abort` при зависании —
  застрявший запрос больше не «съедает» очистку дочерних сессий.
* защита от параллельных обновлений одного заголовка (`titleUpdatesInFlight`) —
  дубли idle-событий не плодят параллельные дочерние сессии.

Конфиг: `"model": "current"` (или ключ убрать) — заголовки идут моделью
текущей сессии; пиннинг конкретной модели по-прежнему поддерживается.

Проверено 16.10.2026 на opencode 1.19.0: заголовок обновлён моделью сессии
`opencode-go/mimo-v2.6-pro`, дочерняя сессия удалена.

## Настройка
`~/.config/opencode/smart-title.jsonc`:
* `model` — `"current"` (или не задавать): генерация идёт моделью текущей
  сессии, при сбое — следующий кандидат (default). Пиннинг вида
  `provider/model` допустим, но не обязателен. Модели `google/gemini-*` в
  дочерней сессии падают на схеме MCP-инструментов — их не пиннить.
* `updateThreshold` — 1 (обновлять заголовок на каждой паузе).
* `debug` — включать для диагностики: `~/.config/opencode/logs/smart-title/`.

Встроенный `title`-агент opencode отключён в `opencode.json`
(`agent.title.disable: true`) — он сыпал `Insufficient account funds`
(Zen, `gpt-5.4-nano`).

## Обновление
`npm pack @hyakt/opencode-smart-title`, распаковать `dist/` в эту папку и
заново применить оба патча выше.
